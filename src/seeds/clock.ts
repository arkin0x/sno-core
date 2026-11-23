/**
 * The clock (§4.1), growing between generations (§4.7), and the planted-height
 * clamp with its settling (§4.2). Header times come from the caller, so the
 * same code runs against a full node, a header cache or a test fixture.
 */
import { BLOCKS_PER_GENERATION, CLAMP_MARGIN, CLOCK_DEPTH, GENESIS_TIME } from './constants.js'

/** A block's header time (its header's `time` field) by height; undefined when the reader lacks it. */
export type HeaderTimeSource = (height: number) => number | undefined

/** A header the clamp needs and the reader does not have. Not a gap to step over (§4.2). */
export class MissingHeaderError extends Error {
  constructor(readonly height: number) {
    super('missing header ' + height)
    this.name = 'MissingHeaderError'
  }
}

/** The clock height: the best tip minus 6 (§4.1). */
export function clockHeight(tipHeight: number): number {
  return tipHeight - CLOCK_DEPTH
}

/** The bloom's generation at an age in blocks: `min(floor(age / 144), cap)`, 0 before planting (§4.1). */
export function generationAt(age: number, generationCap: number): number {
  return age < 0 ? 0 : Math.min(Math.floor(age / BLOCKS_PER_GENERATION), generationCap)
}

/**
 * `f(b)` of §4.7: how far, out of 144, a symbol born in generation `birth` has
 * grown at `age`. Axiom symbols (birth 0) are always fully grown.
 */
export function grownFraction(birth: number, age: number): number {
  const N = BLOCKS_PER_GENERATION
  const f = birth === 0 ? N : Math.max(0, age) - birth * N
  return f < 0 ? 0 : f > N ? N : f
}

const need = (h: number, time: HeaderTimeSource): number => {
  const t = time(h)
  if (t === undefined) throw new MissingHeaderError(h)
  return t
}

/** Median time past of block `h`: the median header time of blocks `h - 10` to `h` (BIP-113). */
export function medianTimePast(h: number, time: HeaderTimeSource): number {
  const ts: number[] = []
  for (let k = h - 10; k <= h; k++) ts.push(need(k, time))
  return ts.sort((a, b) => a - b)[5]
}

/** True once `MTP(clock) > createdAt + 7200`: E and F are then the same for every reader (§4.2). */
export function isSettled(createdAt: number, clock: number, time: HeaderTimeSource): boolean {
  return medianTimePast(clock, time) > createdAt + CLAMP_MARGIN
}

/**
 * The highest height at or below `clock` whose header time is at most `t`, or
 * -1 if no block's is. Header times are not monotonic, so this finds the
 * highest `h*` with `MTP(h*) < t` (MTP never decreases) and looks at
 * `h* + 1` down to `h* - 10`, as §4.2 describes.
 *
 * `h*` is found by galloping down from the clock, never below height 10 (the
 * lowest with an MTP), and then bisecting, which reads headers near the answer
 * only. The reference walks down one block at a time; the result is the same
 * on any chain whose MTP never decreases, which Bitcoin's consensus rules
 * guarantee. A header store may hold only recent blocks, so when the gallop or
 * the bisection reaches a header the reader lacks, this falls back to the
 * reference's walk from the lowest height already known to be too late, and
 * so never needs a header the reference does not.
 */
export function highestAtOrBelow(t: number, time: HeaderTimeSource, clock: number): number {
  if (t < GENESIS_TIME) return -1
  let hs: number
  if (medianTimePast(clock, time) < t) hs = clock
  else {
    let hi = clock // MTP(hi) >= t throughout
    try {
      let step = 1
      let lo = Math.max(MTP_FLOOR, clock - step)
      for (;;) {
        if (lo >= hi) return lowestBlocks(t, time, Math.min(clock, MTP_FLOOR)) // MTP(10) >= t
        if (medianTimePast(lo, time) < t) break
        hi = lo
        step *= 2
        lo = Math.max(MTP_FLOOR, clock - step)
      }
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2)
        if (medianTimePast(mid, time) < t) lo = mid; else hi = mid
      }
      hs = lo
    } catch (e) {
      if (!(e instanceof MissingHeaderError)) throw e
      hs = hi - 1
      while (medianTimePast(hs, time) >= t) hs--
    }
  }
  for (let h = Math.min(clock, hs + 1); h >= hs - 10; h--) if (need(h, time) <= t) return h
  throw new Error('unreachable: MTP(h*) < t but no block of h*-10..h* is at or below t')
}

/** The lowest height with a median time past: blocks 0 to 10. */
const MTP_FLOOR = 10

/**
 * When even MTP(10) is at or after `t`, no block above 10 can be at or before
 * it (each header time exceeds the MTP before it), so the answer is among
 * blocks 0 to 10.
 */
function lowestBlocks(t: number, time: HeaderTimeSource, top: number): number {
  for (let h = top; h >= 0; h--) if (need(h, time) <= t) return h
  return -1
}

/**
 * The effective planted height of a seed, or the commit height of a mix
 * (§4.2, §6.2), at a reader's clock height.
 *
 * - `pending`: not settled yet, or a header it needs is missing. Draw the seed
 *   at generation 0; a mix is pending.
 * - `cannot-grow`: no block's header time is at most `createdAt + 7200`. The
 *   seed cannot grow; a mixed DNA is invalid.
 * - `settled`: `height = min(max(stated, E), F)`. `E` is null when no block
 *   qualifies for it, and then does not raise the height.
 */
export type PlantedHeight =
  | { state: 'pending'; missingHeader?: number }
  | { state: 'cannot-grow'; E: null; F: null }
  | { state: 'settled'; height: number; E: number | null; F: number }

export function effectivePlantedHeight(stated: number, createdAt: number, clock: number, time: HeaderTimeSource): PlantedHeight {
  try {
    if (!isSettled(createdAt, clock, time)) return { state: 'pending' }
    const F = highestAtOrBelow(createdAt + CLAMP_MARGIN, time, clock)
    if (F < 0) return { state: 'cannot-grow', E: null, F: null }
    const E = highestAtOrBelow(createdAt - CLAMP_MARGIN, time, clock)
    return { state: 'settled', height: Math.min(Math.max(stated, E), F), E: E < 0 ? null : E, F }
  } catch (e) {
    if (e instanceof MissingHeaderError) return { state: 'pending', missingHeader: e.height }
    throw e
  }
}
