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
import { type ShardModel } from './shards.js';
/** The farthest any tick distance in an object reaches: 64 units, the §1.8 position bound. */
export declare const GLOW_REACH: number;
/** The two glow styles. `light` adds its color to what is behind it; `fog` lays its color over it. */
export declare const GLOW_STYLES: readonly ["light", "fog"];
export type GlowStyle = (typeof GLOW_STYLES)[number];
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
    style: GlowStyle;
    radius: number;
    strength: number;
}
/** The wire form of a glow: `[style, radius, strength]`. */
export type GlowWire = [GlowStyle, number, number];
/**
 * A `pointsize` value read as §1.15 reads it: a JSON integer from 0 to 7680
 * ticks, or undefined, which means the reader's own size. 0 is valid and
 * means no points are drawn. `-0` is the integer 0.
 */
export declare function readPointSize(raw: unknown): number | undefined;
/**
 * A `glow` value read as §1.16 reads it, or undefined for no glow: exactly
 * three elements, the word `"light"` or `"fog"` (lowercase and exact), a
 * radius that is a JSON integer from 1 to 7680, and a strength that is a JSON
 * integer from 1 to 100. Anything else, null included, is no glow.
 */
export declare function readGlow(raw: unknown): Glow | undefined;
/** A glow in its wire form, for `extra.glow`. */
export declare function glowWire(g: Glow): GlowWire;
/**
 * Who is drawing: an avatar ignores both fields (§3.3), in its own payload and
 * in every object it places, so a caller drawing an avatar's parts passes
 * `{ avatar: true }` for each of them too.
 */
export interface LookContext {
    avatar?: boolean;
}
type Looked = Pick<ShardModel, 'mode'> & Partial<Pick<ShardModel, 'extra'>>;
/**
 * The point size to draw `s` at, in ticks of its own lattice, or undefined for
 * the reader's own size: undefined outside `points` mode (the field is kept,
 * not drawn) and for an avatar. A placed object's comes from its own model,
 * never its parent's (§1.10).
 */
export declare function drawnPointSize(s: Looked, ctx?: LookContext): number | undefined;
/**
 * The glow to draw around `s`'s points, or undefined for none: none outside
 * `points` mode (kept, not drawn) and none for an avatar. Independent of the
 * object's opacity: an object at 0 percent draws no point and still glows.
 */
export declare function drawnGlow(s: Looked, ctx?: LookContext): Glow | undefined;
/**
 * `s` with its point size set, in ticks, or removed when `ticks` is undefined
 * (the reader's own size). A value that is not a valid point size removes the
 * field, so a publisher never writes a malformed one: a caller rounds a
 * slider's value to whole ticks first, or a fractional value clears the size. The mode is not touched:
 * the field is kept in every mode and drawn in `points`.
 */
export declare function withPointSize<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, ticks: number | undefined): T;
/** `s` with its glow set, or removed when `glow` is undefined or not a valid glow (round radius and strength first). */
export declare function withGlow<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, glow: Glow | undefined): T;
/**
 * The style an editor suggests for a color, as the owner described it: a
 * bright color is a light, a dark one a fog. `rgb` is 0..1 per channel, in
 * sRGB as the palette gives it. The line is a relative luminance of 0.18,
 * mid grey (L* about 50). It is only a suggestion: the payload says the
 * style, and the author can flip it (DECK-0003 §1.16).
 */
export declare function suggestGlowStyle(rgb: readonly [number, number, number]): GlowStyle;
export {};
//# sourceMappingURL=glow.d.ts.map