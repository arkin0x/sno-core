/**
 * Point size and glow (DECK-0003 §1.15 and §1.16): how wide an object's points
 * are drawn in `points` mode, and the light or fog around each of them.
 *
 * Both are object-level settings carried in the payload as `pointsize` and
 * `glow`. This library does not lift them onto the model: they travel in
 * `ShardModel.extra` exactly as `anim`, `constrain` and `bounce` do, so a
 * model read by an older version of this library keeps them through every
 * edit, and every reader here reads them from the same place.
 *
 * Both are read, never validated: a malformed value means what every reader
 * that predates the field draws (the reader's own point size, no glow), and is
 * never a reason to refuse the object. Both are read only in `points` mode,
 * and an avatar ignores both (§3.3); `drawnPointSize` and `drawnGlow` apply
 * both rules, `readPointSize` and `readGlow` read the bare value.
 */

import { TICKS_PER_UNIT, type ShardModel } from './shards.js'

/** The farthest any tick distance in an object reaches: 64 units, the §1.8 position bound. */
export const GLOW_REACH = 64 * TICKS_PER_UNIT

/** The two glow styles. `light` adds its color to what is behind it; `fog` lays its color over it. */
export const GLOW_STYLES = ['light', 'fog'] as const
export type GlowStyle = (typeof GLOW_STYLES)[number]

/**
 * One object's glow, as read.
 *
 * `radius` is in ticks of the object's own lattice, 1 to 7680, from each
 * point's centre to where the glow fades to nothing. `strength` is a whole
 * percent, 1 to 100: how strong the glow is at the point's centre. It is the
 * glow's own and the object's `opacity` never multiplies it (owner, 2026-11-15:
 * an object can cast a glow or a fog without drawing a point).
 */
export interface Glow {
  style: GlowStyle
  radius: number
  strength: number
}

/** The wire form of a glow: `[style, radius, strength]`. */
export type GlowWire = [GlowStyle, number, number]

const isInt = (n: unknown): n is number => Number.isInteger(n)

/**
 * A `pointsize` value read as §1.15 reads it: a JSON integer from 0 to 7680
 * ticks, or undefined, which means the reader's own size. 0 is valid and
 * means no points are drawn. `-0` is the integer 0.
 */
export function readPointSize(raw: unknown): number | undefined {
  return isInt(raw) && raw >= 0 && raw <= GLOW_REACH ? raw + 0 : undefined
}

/**
 * A `glow` value read as §1.16 reads it, or undefined for no glow: exactly
 * three elements, the word `"light"` or `"fog"` (lowercase and exact), a
 * radius that is a JSON integer from 1 to 7680, and a strength that is a JSON
 * integer from 1 to 100. Anything else, null included, is no glow.
 */
export function readGlow(raw: unknown): Glow | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const [style, radius, strength] = raw as unknown[]
  if (style !== 'light' && style !== 'fog') return undefined
  if (!isInt(radius) || radius < 1 || radius > GLOW_REACH) return undefined
  if (!isInt(strength) || strength < 1 || strength > 100) return undefined
  return { style, radius, strength }
}

/** A glow in its wire form, for `extra.glow`. */
export function glowWire(g: Glow): GlowWire {
  return [g.style, g.radius, g.strength]
}

/** Who is drawing: an avatar ignores both fields (§3.3). */
export interface LookContext {
  avatar?: boolean
}

type Looked = Pick<ShardModel, 'mode'> & Partial<Pick<ShardModel, 'extra'>>

/**
 * The point size to draw `s` at, in ticks of its own lattice, or undefined for
 * the reader's own size: undefined outside `points` mode (the field is kept,
 * not drawn) and for an avatar. A placed object's comes from its own model,
 * never its parent's (§1.10).
 */
export function drawnPointSize(s: Looked, ctx: LookContext = {}): number | undefined {
  if (ctx.avatar || s.mode !== 'points') return undefined
  return readPointSize(s.extra?.pointsize)
}

/**
 * The glow to draw around `s`'s points, or undefined for none: none outside
 * `points` mode (kept, not drawn) and none for an avatar. Independent of the
 * object's opacity: an object at 0 percent draws no point and still glows.
 */
export function drawnGlow(s: Looked, ctx: LookContext = {}): Glow | undefined {
  if (ctx.avatar || s.mode !== 'points') return undefined
  return readGlow(s.extra?.glow)
}

/** `extra` with `key` set to `value`, or removed when `value` is undefined; undefined when nothing is left. */
function setExtra(extra: Record<string, unknown> | undefined, key: string, value: unknown): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(extra ?? {}) }
  if (value === undefined) delete next[key]
  else next[key] = value
  return Object.keys(next).length ? next : undefined
}

function withExtra<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, extra: Record<string, unknown> | undefined): T {
  const { extra: _old, ...bare } = s
  return (extra ? { ...bare, extra } : bare) as T
}

/**
 * `s` with its point size set, in ticks, or removed when `ticks` is undefined
 * (the reader's own size). A value that is not a valid point size removes the
 * field, so a publisher never writes a malformed one. The mode is not touched:
 * the field is kept in every mode and drawn in `points`.
 */
export function withPointSize<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, ticks: number | undefined): T {
  const v = readPointSize(ticks)
  return withExtra(s, setExtra(s.extra, 'pointsize', v))
}

/** `s` with its glow set, or removed when `glow` is undefined or not a valid glow. */
export function withGlow<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, glow: Glow | undefined): T {
  const v = glow ? readGlow(glowWire(glow)) : undefined
  return withExtra(s, setExtra(s.extra, 'glow', v ? glowWire(v) : undefined))
}

/**
 * The style an editor suggests for a color, as the owner described it: a
 * bright color is a light, a dark one a fog. `rgb` is 0..1 per channel, in
 * sRGB as the palette gives it. The line is a relative luminance of 0.18,
 * mid grey (L* about 50). It is only a suggestion: the payload says the
 * style, and the author can flip it (DECK-0003 §1.16).
 */
export function suggestGlowStyle(rgb: readonly [number, number, number]): GlowStyle {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  return y >= 0.18 ? 'light' : 'fog'
}
