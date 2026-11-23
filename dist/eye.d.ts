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
 * The frame. An eye is in the payload's own frame, version 2's: +Z toward the
 * viewer. That is NOT the frame a ShardModel's vertices and `parts` are held
 * in (shards.ts negates Z on the way in), so an eye and a vertex at the same
 * wire point differ in the sign of Z here. `eyeModelTicks` gives the eye in
 * the model's own frame, beside `ticksOf(vertex)`; the payload frame times
 * 1/120 is already the render frame (`toRender` of model coordinates), so a
 * renderer uses `drawnEye` as it is and never passes it through `toRender`.
 *
 * The eye is not held to the avatar's shape: it may sit anywhere within the
 * position bound (EYE_REACH), so an eye behind and above the avatar gives a view from
 * behind. A client keeps the camera short of walls; that is the client's.
 */
import { type ShardModel } from './shards.js';
/** The payload field. */
export declare const EYE_FIELD = "eye";
/** The farthest an eye coordinate reaches, in ticks: the position bound of §1.8 (TICK_REACH). */
export declare const EYE_REACH: number;
/** An eye in ticks: X, Y, Z in the payload's frame (version 2: +Z toward the viewer). */
export type Eye = [number, number, number];
/**
 * An `eye` value as §1.17 reads it: exactly three JSON integers, each from
 * -EYE_REACH to EYE_REACH, or undefined, which means the automatic eye. Null, a
 * fraction, two or four elements, a string, a boolean, an object or a number
 * out of range is undefined. `-0` is the integer 0. A JavaScript parser
 * cannot tell `159.0` from `159`, so such a value reads as `159`, which §1.17
 * allows (the reference, in Python, reads it as absent; a publisher never
 * writes one).
 */
export declare function readEye(raw: unknown): Eye | undefined;
/**
 * The automatic eye, in ticks: `top - floor((top - bottom) / 8)` on Y, over
 * the lowest and highest Y of the object's own vertices, and 0 on X and Z.
 * At the origin for an object with no vertices of its own (only placements).
 */
export declare function autoEye(s: Pick<ShardModel, 'vertices'>): Eye;
/**
 * The eye a viewer wearing `s` looks from, in the model's own frame (Z
 * negated from the payload's), in ticks: the frame `ticksOf(vertex)` and
 * `parts` use, for an editor that puts the eye beside a vertex or turns it
 * with `posed`.
 */
export declare function eyeModelTicks(s: Pick<ShardModel, 'vertices'> & Partial<Pick<ShardModel, 'extra'>>): Eye;
/** The eye a viewer wearing `s` looks from, in ticks: its own `eye` when well formed, else the automatic eye. */
export declare function drawnEye(s: Pick<ShardModel, 'vertices'> & Partial<Pick<ShardModel, 'extra'>>): Eye;
/** Whether `s` carries an eye its author chose (CHOSEN), rather than the automatic one (AUTO). */
export declare function eyeChosen(s: Partial<Pick<ShardModel, 'extra'>>): boolean;
/**
 * `s` with its eye set, in ticks, or removed when `eye` is undefined (AUTO,
 * which follows the shape as it is edited). A value that is not a valid eye
 * removes the field, so a publisher never writes a malformed one: a caller
 * rounds to whole ticks first. `[0, 0, 0]` is written: the origin, chosen.
 */
export declare function withEye<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, eye: Eye | undefined): T;
//# sourceMappingURL=eye.d.ts.map