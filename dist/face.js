/** The payload field. */
export const FACE_FIELD = 'face';
/** The ways of turning this version of the format names, in the order an editor offers them. */
export const FACE_MODES = ['path', 'upright'];
/** The default, and what an absent, malformed or unknown `face` means. */
export const DEFAULT_FACE = 'path';
/**
 * A `face` value as §1.18 reads it: exactly `"path"` or `"upright"`, or
 * undefined, which means "path". Another case, an empty string, a name this
 * version does not know, a number, a boolean, an array, an object or null is
 * undefined.
 */
export function readFace(raw) {
    return typeof raw === 'string' && FACE_MODES.includes(raw) ? raw : undefined;
}
/** How a worn `s` turns as it moves: its own `face` when it names a mode this version knows, else "path". */
export function drawnFace(s) {
    return readFace(s.extra?.[FACE_FIELD]) ?? DEFAULT_FACE;
}
/**
 * `s` with its facing set. "path", the default, removes the field (a
 * publisher leaves it out, as it leaves `opacity` out at 100); so does any
 * value that is not a mode, so a publisher never writes a malformed one.
 */
export function withFace(s, face) {
    const v = readFace(face);
    const next = { ...(s.extra ?? {}) };
    if (v === undefined || v === DEFAULT_FACE)
        delete next[FACE_FIELD];
    else
        next[FACE_FIELD] = v;
    const { extra: _old, ...bare } = s;
    return (Object.keys(next).length ? { ...bare, extra: next } : bare);
}
//# sourceMappingURL=face.js.map