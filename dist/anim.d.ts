/**
 * anim.ts: an object's perpetual motion on the reader's clock (DECK-0003
 * §1.14 `anim`, cyberspace #107, merged 2026-11-14).
 *
 * `anim` is an optional payload field: a list of motions, each one JSON
 * array, a word and then integers (and an axis letter). Every motion ends in
 * the same three integers, `c` cycles every `b` seconds with a phase offset
 * of `φ` whole degrees, so its phase at Unix time t (seconds, as the reader's
 * clock reads it; animClock.ts has the correction rules) is
 *
 *   u = frac(c × t / b + φ / 360)
 *
 * and its pose is a pure function of u. The motions compose in the order
 * written, the first innermost, about the object's own origin, in its own
 * model frame as DECK-0003 §2 defines it (Y up, +Z toward the viewer: the
 * published, version 2 frame), in ticks. That is NOT this package's
 * in-memory frame, which keeps cyberspace axes (Z negated from the wire); it
 * IS the render frame times 120 (shards.ts toRender), so a motion's matrix
 * sits directly above a mesh drawn in the render frame.
 *
 * THE MOTION TABLE (MOTIONS below) is the only place a motion is defined:
 * its word, how its parameters are read, and its pose at a phase. The words
 * and shapes are DECK-0003 §1.14's. Friendly names (SPIN, ELEVATOR) live only
 * in an editor (animEdit.ts), never in the data.
 *
 * Reader rules kept here (§1.9 rule 17, §1.14): only the first four entries
 * are read; an entry that is malformed, has an unknown word, has an integer
 * out of its range, or is faster than two cycles a second is ignored (held
 * still) and the rest still apply; the payload is never rejected for `anim`.
 * A writer writes c/b in lowest terms, a positive c for a swing or a slide,
 * and a path's weights with no common factor (writeMotion, withAnim).
 *
 * Where the field lives. Like `constrain`, `anim` rides in the model's
 * `extra` (fromPayload carries it there, toPayload writes it back), so a
 * model from any version of this package keeps it through an edit, and a
 * client that already reads it from `extra` keeps working. `animOf` reads a
 * top-level `anim` first, then `extra.anim`; `withAnim` writes `extra.anim`.
 * This is ONOSENDAI's lib/anim.ts (ONOSENDAI #735), moved here so both
 * clients read one copy.
 */
import type { ShardModel } from './shards.js';
/** The payload field. */
export declare const ANIM_FIELD = "anim";
/** Motions read per object; entries past this are ignored (§1.14). */
export declare const MAX_MOTIONS = 4;
/**
 * Fastest rate a motion may have, cycles a second: |c| ≤ 2 b. A faster entry
 * is ignored (a strobe, DECK-0003 §1.14).
 */
export declare const MAX_PER_SECOND = 2;
/** Largest `b`, seconds: a year of 365 days (§1.14). */
export declare const MAX_SECONDS = 31536000;
/** Largest distance in ticks (the 64-unit position bound of §1.8). */
export declare const REACH: number;
/** Largest path leg weight. */
export declare const MAX_WEIGHT = 1000;
/** Waypoints a `path` may have (§1.14). */
export declare const PATH_MIN = 2;
export declare const PATH_MAX = 32;
export type Axis = 'x' | 'y' | 'z';
/** The shared rate and phase of every motion. */
export interface Rate {
    /** Cycles every `b` seconds; negative runs the cycle backward. */
    c: number;
    /** Seconds, at least 1. */
    b: number;
    /** Phase offset, whole degrees 0..359. */
    phi: number;
}
/** One motion as read: its word, its rate, and its own parameters (numbers only, so a pose allocates nothing). */
export interface Motion extends Rate {
    word: string;
    /** Axis index 0..2, for the motions that have one; -1 otherwise. */
    axis: number;
    /** The motion's own integers, in the order written after the axis (reach, radius, travel, dwell...). */
    p: number[];
    /** A path's waypoints, four integers each [x, y, z, w]; empty otherwise. */
    pts: number[];
}
/**
 * Where a motion moves a point, in the model frame: a turn of `angle`
 * radians about axis `axis` (right-handed; -1 for no turn), then a
 * translation `t` in ticks. Written in place.
 */
export interface MotionPose {
    axis: number;
    angle: number;
    t: [number, number, number];
}
/** `ease(x) = 3x² − 2x³` (§1.14). */
export declare function smoothstep(x: number): number;
/** A motion's definition: how an entry is read, and its pose at a phase. */
interface MotionDef {
    /** The entry after its word, read into a motion, or null when malformed. */
    read(rest: readonly unknown[]): Omit<Motion, 'word'> | null;
    /** The pose at phase `u` (0..1), written into `out`. */
    pose(m: Motion, u: number, out: MotionPose): void;
}
/**
 * THE MOTION TABLE. Word -> parameters -> pose. The only place a motion is
 * defined (see the header).
 */
export declare const MOTIONS: Readonly<Record<string, MotionDef>>;
/** Whether a word names a motion this reader knows. */
export declare function knownMotion(word: string): boolean;
/** One entry read, or null: malformed, or a word this reader does not know. */
export declare function readMotion(raw: unknown): Motion | null;
/** A payload's `anim`, as a reader keeps it: the first four entries, each read or ignored (§1.14). Never throws. */
export declare function readAnim(raw: unknown): Motion[];
/** A model's motions, read once per model object. */
export declare function animOf(s: Pick<ShardModel, 'extra'>): readonly Motion[];
/** Whether a model moves at all (any motion it can read). */
export declare function hasAnim(s: Pick<ShardModel, 'extra'>): boolean;
/**
 * u = frac(c × t / b + φ / 360), in [0, 1), t in Unix seconds. t's whole part
 * is reduced modulo b first, with exact integer arithmetic, so the phase
 * keeps its precision at any time (about 1.8 billion seconds today).
 */
export declare function phaseAt(r: Rate, t: number): number;
/** A motion's pose at phase u, written into `out`. */
export declare function motionPose(m: Motion, u: number, out: MotionPose): MotionPose;
export declare function newPose(): MotionPose;
/**
 * Compose motion poses, in order, into a 4x4 in the RENDER frame (three's
 * column-major elements, model units): every motion is applied in the
 * DECK-0003 §2 model frame, in ticks, first innermost. That frame is the
 * render frame times 120, so the result sits directly above a mesh drawn
 * there. `out` is written in place.
 *
 * It is the object's own motion, applied before anything poses the object.
 * A client that draws a mesh already turned by a §1.7 pose (flatten(s, pose))
 * puts G · A · Gᵀ above it, G the pose's turn, as ONOSENDAI's
 * scene/animMotion.ts does, so the motion still comes first and the pose
 * after (§1.14, Parts).
 */
export declare function composeRender(poses: readonly MotionPose[], count: number, out: Float64Array | number[]): void;
/** Greatest common divisor of two nonnegative integers. */
export declare function gcd(a: number, b: number): number;
/**
 * The canonical entry for a motion, as a writer writes it (§1.14): integers
 * only, nothing omitted, c and b in lowest terms, a positive c for a swing or
 * a slide (a negative c draws exactly what a positive c with the phase
 * (180 − φ) mod 360 draws), a path's leg weights with no common factor.
 */
export declare function writeMotion(m: Motion): unknown[];
/**
 * `s` with `anim` set to `raw`, read as a reader would and written back
 * canonically; an empty result removes the field. The same object when it
 * already says exactly that. Returns the motions kept too, so a caller can
 * say how many entries were ignored.
 */
export declare function withAnim<T extends ShardModel>(s: T, raw: unknown): {
    shard: T;
    kept: Motion[];
};
/** A model's `anim` as text for an editor: its raw field as JSON, or empty. */
export declare function animText(s: Pick<ShardModel, 'extra'>): string;
export {};
//# sourceMappingURL=anim.d.ts.map