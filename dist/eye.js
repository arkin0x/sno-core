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
import { TICK_REACH, ticksOf } from './shards.js';
/** The payload field. */
export const EYE_FIELD = 'eye';
/** The farthest an eye coordinate reaches, in ticks: the position bound of §1.8 (TICK_REACH). */
export const EYE_REACH = TICK_REACH;
const isInt = (n) => Number.isInteger(n);
/**
 * An `eye` value as §1.17 reads it: exactly three JSON integers, each from
 * -EYE_REACH to EYE_REACH, or undefined, which means the automatic eye. Null, a
 * fraction, two or four elements, a string, a boolean, an object or a number
 * out of range is undefined. `-0` is the integer 0. A JavaScript parser
 * cannot tell `159.0` from `159`, so such a value reads as `159`, which §1.17
 * allows (the reference, in Python, reads it as absent; a publisher never
 * writes one).
 */
export function readEye(raw) {
    if (!Array.isArray(raw) || raw.length !== 3)
        return undefined;
    const out = [];
    for (const c of raw) {
        if (!isInt(c) || c < -EYE_REACH || c > EYE_REACH)
            return undefined;
        out.push(c + 0);
    }
    return out;
}
/**
 * The automatic eye, in ticks: `top - floor((top - bottom) / 8)` on Y, over
 * the lowest and highest Y of the object's own vertices, and 0 on X and Z.
 * At the origin for an object with no vertices of its own (only placements).
 */
export function autoEye(s) {
    if (s.vertices.length === 0)
        return [0, 0, 0];
    let top = -Infinity;
    let bottom = Infinity;
    for (const v of s.vertices) {
        const y = ticksOf(v)[1];
        if (y > top)
            top = y;
        if (y < bottom)
            bottom = y;
    }
    return [0, top - Math.floor((top - bottom) / 8) + 0, 0];
}
/**
 * The eye a viewer wearing `s` looks from, in the model's own frame (Z
 * negated from the payload's), in ticks: the frame `ticksOf(vertex)` and
 * `parts` use, for an editor that puts the eye beside a vertex or turns it
 * with `posed`.
 */
export function eyeModelTicks(s) {
    const e = drawnEye(s);
    return [e[0], e[1], -e[2] + 0];
}
/** The eye a viewer wearing `s` looks from, in ticks: its own `eye` when well formed, else the automatic eye. */
export function drawnEye(s) {
    return readEye(s.extra?.[EYE_FIELD]) ?? autoEye(s);
}
/** Whether `s` carries an eye its author chose (CHOSEN), rather than the automatic one (AUTO). */
export function eyeChosen(s) {
    return readEye(s.extra?.[EYE_FIELD]) !== undefined;
}
/**
 * `s` with its eye set, in ticks, or removed when `eye` is undefined (AUTO,
 * which follows the shape as it is edited). A value that is not a valid eye
 * removes the field, so a publisher never writes a malformed one: a caller
 * rounds to whole ticks first. `[0, 0, 0]` is written: the origin, chosen.
 */
export function withEye(s, eye) {
    const v = eye === undefined ? undefined : readEye(eye);
    const next = { ...(s.extra ?? {}) };
    if (v === undefined)
        delete next[EYE_FIELD];
    else
        next[EYE_FIELD] = v;
    const { extra: _old, ...bare } = s;
    return (Object.keys(next).length ? { ...bare, extra: next } : bare);
}
//# sourceMappingURL=eye.js.map