/**
 * Facing (DECK-0003 §1.18): how a worn avatar turns as it moves.
 *
 * An object-level setting carried in the payload as `face`: the name of a way
 * of turning. Like `eye`, `glow` and `anim` it travels in `ShardModel.extra`,
 * so a model read by an older version of this library keeps it through every
 * edit.
 *
 *   "path"     the default, and what every client did before the field: the
 *              front points along the last move and tilts with it.
 *   "upright"  the top stays on the viewer's up (the up of the world as that
 *              viewer has turned it, not a Cyberspace axis) and the avatar
 *              turns about it only, toward the move's part across it. A move
 *              straight up or down keeps the heading.
 *
 * Read, never validated: anything but exactly one of those two names, a name
 * a later revision adds included, means "path", and is never a reason to
 * refuse the object. An avatar's front is its -Z in the payload's frame
 * (version 2), its top +Y; the turning itself is the client's (it knows its
 * viewer's up), so this module only names the mode.
 */
import type { ShardModel } from './shards.js';
/** The payload field. */
export declare const FACE_FIELD = "face";
/** The ways of turning this version of the format names, in the order an editor offers them. */
export declare const FACE_MODES: readonly ["path", "upright"];
/** A way of turning (§1.18). */
export type FaceMode = (typeof FACE_MODES)[number];
/** The default, and what an absent, malformed or unknown `face` means. */
export declare const DEFAULT_FACE: FaceMode;
/**
 * A `face` value as §1.18 reads it: exactly `"path"` or `"upright"`, or
 * undefined, which means "path". Another case, an empty string, a name this
 * version does not know, a number, a boolean, an array, an object or null is
 * undefined.
 */
export declare function readFace(raw: unknown): FaceMode | undefined;
/** How a worn `s` turns as it moves: its own `face` when it names a mode this version knows, else "path". */
export declare function drawnFace(s: Partial<Pick<ShardModel, 'extra'>>): FaceMode;
/**
 * `s` with its facing set. "path", the default, removes the field (a
 * publisher leaves it out, as it leaves `opacity` out at 100); so does any
 * value that is not a mode, so a publisher never writes a malformed one.
 */
export declare function withFace<T extends Partial<Pick<ShardModel, 'extra'>>>(s: T, face: FaceMode | undefined): T;
//# sourceMappingURL=face.d.ts.map