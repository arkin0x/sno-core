/**
 * The position bound (DECK-0003 §1.8), and what depends on it. It was 64 units
 * until 2026-10-31. These hold the new number to its derivation, keep models
 * stored under the old one reading exactly as they did, and keep a larger model
 * from being read as ticks on reload.
 */
import { describe, expect, it } from 'vitest'
import { GRID_HALF, MAX_EXTENT, MIN_EXTENT, PART_REACH, TICKS_PER_UNIT, fromPayload, neededExtent, newShard, normalizeStored, ticksOf, toPayload, validPoint, type ShardModel, type ShardVertex } from './shards.js'
import { importFitFor } from './meshToShard.js'

const WHITE: [number, number, number] = [1, 1, 1]
const at = (p: [number, number, number]): ShardVertex => ({ p, c: WHITE })
const shard = (vertices: ShardVertex[], extent: number): ShardModel => ({ ...newShard('m'), vertices, extent })
/** A minimal payload with one vertex, as a reader gets it off the wire. */
const wire = (vertex: [number, number, number], extent?: unknown): unknown => ({
  v: 2, name: 'w', unit: 0, mode: 'lines', vertices: [vertex], faces: [], colors: [225], ...(extent === undefined ? {} : { extent }),
})

/** The rule as it stood at 64, kept verbatim: what every stored model of that time was read by. */
const oldInTicks = (m: ShardModel): boolean => m.vertices.some((v) => v.t === undefined && v.p.some((c) => Math.abs(c) > 64))

describe('why 2^16 units', () => {
  it('draws every tick within a quarter of a tick, in the 32-bit floats a GPU draws in', () => {
    const tick = 1 / TICKS_PER_UNIT
    let worst = 0
    for (let k = 1; k <= 2400; k++) {
      const exact = MAX_EXTENT - k * tick
      worst = Math.max(worst, Math.abs(Math.fround(exact) - exact))
    }
    expect(worst).toBeLessThanOrEqual(1 / 512)
    expect(worst).toBeLessThan(tick / 4)
  })

  it('keeps neighbouring ticks at least two float steps apart when drawn; four times the bound would not', () => {
    const apart = (reach: number): number => {
      let least = Infinity
      for (let k = 1; k <= 2400; k++) least = Math.min(least, Math.fround(reach - (k - 1) / TICKS_PER_UNIT) - Math.fround(reach - k / TICKS_PER_UNIT))
      return least
    }
    expect(apart(MAX_EXTENT)).toBeGreaterThanOrEqual(2 / 256)
    expect(apart(MAX_EXTENT * 4)).toBeLessThan(2 / 256)
  })

  it('is a whole power of two, and fits the safe integers by a very long way', () => {
    expect(Math.log2(MAX_EXTENT) % 1).toBe(0)
    expect(MAX_EXTENT * TICKS_PER_UNIT).toBeLessThan(Number.MAX_SAFE_INTEGER / 1e6)
    expect(PART_REACH).toBe(MAX_EXTENT * TICKS_PER_UNIT)
  })
})

describe('the bound on a grid', () => {
  it('holds a point at the bound and refuses one past it, in ticks', () => {
    const b = MAX_EXTENT * TICKS_PER_UNIT
    expect(validPoint([b, -b, b], MAX_EXTENT)).toBe(true)
    expect(validPoint([b + 1, 0, 0], MAX_EXTENT)).toBe(false)
  })

  it('reads an extent anywhere in range as written, and repairs one outside it to 8', () => {
    expect(fromPayload(wire([0, 0, 0], 100), 'x')?.extent).toBe(100)
    expect(fromPayload(wire([0, 0, 0], MAX_EXTENT), 'x')?.extent).toBe(MAX_EXTENT)
    expect(fromPayload(wire([0, 0, 0], MAX_EXTENT + 1), 'x')?.extent).toBe(GRID_HALF)
    expect(fromPayload(wire([0, 0, 0], MIN_EXTENT - 1), 'x')?.extent).toBe(GRID_HALF)
  })

  it('still grows the extent to hold the data, within the bound and past it', () => {
    expect(fromPayload(wire([1000, 0, 0]), 'x')?.extent).toBe(1000)
    // A reader repairs rather than refuses (§1.8): a publisher past the bound is the publisher's fault.
    expect(fromPayload(wire([MAX_EXTENT + 5, 0, 0]), 'x')?.extent).toBe(MAX_EXTENT + 5)
  })

  it('writes a large model and reads it back the same', () => {
    const m = shard([at([1000, -70, 65536]), { p: [65, 0, 0], t: [7, 0, 0], c: WHITE }], 65536)
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(m))), 'x')!
    expect(back.extent).toBe(65536)
    expect(back.vertices.map(ticksOf)).toEqual(m.vertices.map(ticksOf))
  })

  it('brings an import in at half the grid, whatever the grid', () => {
    expect(importFitFor(8)).toBe(4 * TICKS_PER_UNIT)
    expect(importFitFor(1000)).toBe(500 * TICKS_PER_UNIT)
    expect(importFitFor(MAX_EXTENT * 2)).toBe((MAX_EXTENT / 2) * TICKS_PER_UNIT)
  })
})

describe('a placement past the old 64 units', () => {
  const placed = (x: number): unknown => ({
    v: 2, name: 'p', unit: 0, mode: 'lines', vertices: [], faces: [], colors: [],
    refs: [['a', `33331:${'a'.repeat(64)}:d`]], parts: [[0, x, 0, 0, 0, 0, 0, 0]],
  })
  it('reads up to the bound, and its grid grows to where it stands', () => {
    expect(fromPayload(placed(7681), 'x')?.parts?.[0].at[0]).toBe(7681)
    expect(fromPayload(placed(7681), 'x')?.extent).toBe(65)
    expect(fromPayload(placed(PART_REACH), 'x')?.parts?.[0].at[0]).toBe(PART_REACH)
  })
  it('refuses the object past the bound, as rule 12 says', () => {
    expect(fromPayload(placed(PART_REACH + 1), 'x')).toBeNull()
  })
})

describe('normalizeStored', () => {
  it('leaves a larger model in units alone across a reload: 100 stays 100 units, not 100 ticks', () => {
    const m = shard([at([100, 0, -100]), at([0, 65536, 0])], 65536)
    const stored = JSON.parse(JSON.stringify(m)) as ShardModel
    expect(normalizeStored(stored).vertices).toEqual(m.vertices)
    expect(neededExtent(normalizeStored(stored))).toBe(65536)
  })

  it('still reads a model from the ticks days as ticks, on any grid of that time', () => {
    for (const extent of [1, 8, 64]) {
      const interim = shard([at([360, 40, -240])], extent)
      expect(normalizeStored(interim).vertices[0]).toEqual({ p: [3, 0, -2], t: [0, 40, 0], c: WHITE })
    }
  })

  it('reads one with no extent at all as it always did', () => {
    const { extent: _gone, ...ancient } = shard([at([360, 40, -240])], 8)
    expect(normalizeStored(ancient as ShardModel).vertices[0]).toEqual({ p: [3, 0, -2], t: [0, 40, 0], c: WHITE })
  })

  it('answers exactly as the rule at 64 did for every model an old build could have stored', () => {
    let seed = 20261031
    const rand = (n: number): number => { seed = (seed * 48271) % 2147483647; return seed % n }
    let inTicks = 0
    for (let k = 0; k < 4000; k++) {
      const extent = 1 + rand(64)
      const reach = rand(2) ? 64 : 1000
      const vertices = Array.from({ length: 1 + rand(6) }, () => {
        const c = (): number => rand(2 * reach + 1) - reach
        const p: [number, number, number] = [c(), c(), c()]
        return rand(5) === 0 ? { p, t: [rand(120), 0, 0] as [number, number, number], c: WHITE } : at(p)
      })
      const m = shard(vertices, extent)
      const old = oldInTicks(m)
      if (old) inTicks++
      expect(normalizeStored(m).vertices === m.vertices, `extent ${extent}`).toBe(!old)
    }
    expect(inTicks).toBeGreaterThan(500)
    expect(inTicks).toBeLessThan(3900)
  })
})
