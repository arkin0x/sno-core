/**
 * Eye (DECK-0003 §1.17): where a viewer looks from when it wears an object as
 * an avatar and sees the world in first person from inside it.
 *
 * An object-level setting carried in the payload as `eye`: three whole
 * numbers of ticks of the object's own lattice, in the payload's frame, the
 * frame its positions are written in. Like `glow` and `anim` it travels in
 * `ShardModel.extra`, so a model read by an older version of this library
 * keeps it through every edit.
 *
 * Read, never validated: a malformed value means the automatic eye, one
 * eighth of the avatar's height below its top, straight above the origin,
 * worked out in integers so every reader puts it in the same place. It is
 * never a reason to refuse the object. `[0, 0, 0]` is a choice, not a
 * spelling of absent: the old eye at the origin, on purpose.
 *
 * The eye is not held to the avatar's shape: it may sit anywhere within the
 * 64-unit bound, so an eye behind and above the avatar gives a view from
 * behind. A client keeps the camera short of walls; that is the client's.
 */
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from './shards.js'

/** The payload field. */
export const EYE_FIELD = 'eye'

/** The farthest an eye coordinate reaches, in ticks: the 64-unit position bound of §1.8. */
export const EYE_REACH = 64 * TICKS_PER_UNIT

/** An eye in ticks: X, Y, Z in the payload's frame (version 2: +Z toward the viewer). */
export type Eye = [number, number, number]

const isInt = (n: unknown): n is number => Number.isInteger(n)

/**
 * An `eye` value as §1.17 reads it: exactly three JSON integers, each from
 * -7680 to 7680, or undefined, which means the automatic eye. Null, a
 * fraction, two or four elements, a string, an object or a number out of
 * range is undefined. `-0` is the integer 0.
 */
export function readEye(raw: unknown): Eye | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const out: number[] = []
  for (const c of raw as unknown[]) {
    if (!isInt(c) || c < -EYE_REACH || c > EYE_REACH) return undefined
    out.push(c + 0)
  }
  return out as Eye
}

/**
 * The automatic eye, in ticks: `top - floor((top - bottom) / 8)` on Y, over
 * the lowest and highest Y of the object's own vertices, and 0 on X and Z.
 * At the origin for an object with no vertices of its own (only placements).
 */
export function autoEye(s: Pick<ShardModel, 'vertices'>): Eye {
  if (s.vertices.length === 0) return [0, 0, 0]
  let top = -Infinity
  let bottom = Infinity
  for (const v of s.vertices) {
    const y = ticksOf(v)[1]
    if (y > top) top = y
    if (y < bottom) bottom = y
  }
  return [0, top - Math.floor((top - bottom) / 8) + 0, 0]
}

/** The eye a viewer wearing `s` looks from, in ticks: its own `eye` when well formed, else the automatic eye. */
export function drawnEye(s: Pick<ShardModel, 'vertices'> & Partial<Pick<ShardModel, 'extra'>>): Eye {
  return readEye(s.extra?.[EYE_FIELD]) ?? autoEye(s)
}

/** Whether `s` carries an eye its author chose (CHOSEN), rather than the automatic one (AUTO). */
export function eyeChosen(s: Partial<Pick<ShardModel, 'extra'>>): boolean {
  return readEye(s.extra?.[EYE_FIELD]) !== undefined
}

/**
 * `s` with its eye set, in ticks, or removed when `eye` is undefined (AUTO,
 * which follows the shape as it is edited). A value that is not a valid eye
 * removes the field, so a publisher never writes a malformed one: a caller
 * rounds to whole ticks first. `[0, 0, 0]` is written: the origin, chosen.
 */
export function withEye<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, eye: Eye | undefined): T {
  const v = eye === undefined ? undefined : readEye(eye)
  const next: Record<string, unknown> = { ...(s.extra ?? {}) }
  if (v === undefined) delete next[EYE_FIELD]
  else next[EYE_FIELD] = v
  const { extra: _old, ...bare } = s
  return (Object.keys(next).length ? { ...bare, extra: next } : bare) as T
}
