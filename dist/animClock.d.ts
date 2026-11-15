/**
 * animClock.ts: the clock rules of DECK-0003 §1.14 ("The reader's clock"),
 * as arithmetic. No timers, no network and no DOM: a client measures, keeps
 * its own state, and asks these functions what to do with it.
 *
 * Two jobs.
 *
 * 1. Correcting `t`. A reader uses its device clock, plus an offset it
 *    measures against a time source it trusts, and applies that offset only
 *    when it is more than 2 seconds (MIN_CORRECTION_MS); below that the
 *    device is usually the better clock. Once applied, the offset is kept up
 *    to date and dropped when a later measurement falls to 2 seconds or less
 *    (correctionFor). A sample is one request: the device time it was sent,
 *    the device time the answer came, and the server's time in the answer
 *    (serverTimeOf reads it from response headers). The server's moment is
 *    taken as the midpoint of the round trip, and a time in whole seconds,
 *    which is cut down rather than rounded, gets half a second added
 *    (offsetFrom). Of a few samples the median is taken.
 *
 * 2. Catching up without a jump. When the correction changes, each motion
 *    eases from the phase it is drawn at to its true phase, the shorter way
 *    round, over L = min(3, max(0.5, |e| × P)) seconds (stepPhases). Under
 *    reduced motion the object is drawn as written, its rest pose, unless the
 *    viewer chose the time by hand (an editor's scrub): stepPhases sets
 *    `held`, and the caller then draws no motion at all. Phase 0 is not the
 *    rest pose for every motion (an orbit sits at its radius, a path at its
 *    last waypoint), so a caller MUST NOT compose `shown` while `held`.
 *
 * ONOSENDAI's lib/worldClock.ts and scene/animMotion.ts (ONOSENDAI #735) hold
 * the same rules with the timers and the scene around them.
 */
import { type Motion } from './anim.js';
/** What a frame reads: the moment, and enough to know when to ease. */
export interface ClockReading {
    /** Unix seconds now, corrected: what every motion's phase is worked from. */
    t: number;
    /** Rises whenever the correction changes, so motions ease into the new time rather than jump. */
    version: number;
    /** Steady seconds (performance.now / 1000, which never steps): what an ease is timed by. */
    nowS: number;
    /** A time the viewer chose by hand (an editor's scrub): drawn even under reduced motion, never eased. */
    chosen: boolean;
}
/** Corrections of this or less are left to the device clock (§1.14: "more than 2 seconds"). */
export declare const MIN_CORRECTION_MS = 2000;
/** An offset this large is no clock error but a broken source (a stale cached response): ignored. */
export declare const SANE_OFFSET_MS: number;
/** The server time header a source may send, Unix milliseconds. */
export declare const SERVER_TIME_HEADER = "x-server-time";
/** One request's times: sent and answered (device ms), and the server's time with its resolution (ms). */
export interface ClockSample {
    sentMs: number;
    gotMs: number;
    serverMs: number;
    resolutionMs: number;
}
/**
 * The offset the samples show, and how sure it is: the median over the
 * usable samples of server + resolution / 2 − midpoint, and the median of
 * RTT / 2 + resolution / 2. Null without a usable sample.
 */
export declare function offsetFrom(samples: readonly ClockSample[]): {
    offsetMs: number;
    uncertaintyMs: number;
} | null;
/**
 * The correction to use after a measurement, against the one in force (ms):
 * - none (0), when the measured offset is 2 seconds or less: the device is
 *   the better clock, and a correction in force is dropped;
 * - kept, when one is in force and the new measurement agrees with it
 *   within the measurement's own doubt: noise, so nothing wobbles;
 * - the measured offset otherwise (kept up to date).
 * Nothing usable, or an offset past SANE_OFFSET_MS, keeps `current`.
 */
export declare function correctionFor(samples: readonly ClockSample[], current: number): number;
/**
 * A server time from a response's headers: `X-Server-Time` (ms) if present,
 * else `Date` (whole seconds) plus any `Age` (a cache in between that kept
 * the upstream Date says how long it held the response); null for neither.
 * A browser reads either cross-origin only when the source names it in
 * `Access-Control-Expose-Headers`; a same-origin `Date` is always readable.
 */
export declare function serverTimeOf(headers: {
    get(name: string): string | null;
}): {
    serverMs: number;
    resolutionMs: number;
} | null;
/** One object's phase state, allocated once per drawn object, for exactly as many motions as it draws. */
export interface PhaseState {
    /** The phase each motion is drawn at this frame, in [0, 1). */
    shown: Float64Array;
    err: Float64Array;
    start: Float64Array;
    len: Float64Array;
    /** The clock version the phases were last worked from; -1 before the first frame. */
    version: number;
    /** Reduced motion holds the object at rest: draw it as written (no motion matrix at all), never at `shown`. */
    held: boolean;
}
export declare function newPhaseState(n: number): PhaseState;
/** A phase error wrapped into [−1/2, 1/2): the shorter way round a cycle. */
export declare function wrapHalf(e: number): number;
/** How long an ease of `err` cycles takes on a cycle of `period` seconds: min(3, max(0.5, |e| × P)). */
export declare function easeSeconds(err: number, period: number): number;
/**
 * The phase each motion is drawn at, written into `st.shown`. Pure but for
 * `st`, where the eases live. Allocates nothing.
 *
 * - Reduced motion: `st.held`, and the caller draws the object as written
 *   (§1.14) rather than at `shown`, unless the reading is a time the viewer
 *   chose.
 * - Otherwise the true phase, eased into whenever the clock's version changed
 *   since the last frame: the error wrapped the shorter way round, drawn as
 *   u − e × (1 − ease(τ)), τ running 0 to 1 over easeSeconds(e, b / |c|).
 * - The first frame, the first after reduced motion lets go (the object was
 *   drawn as written, which is no phase to ease from), and any time chosen by
 *   hand draw the true pose at once.
 */
export declare function stepPhases(motions: readonly Motion[], r: ClockReading, reduced: boolean, st: PhaseState): void;
//# sourceMappingURL=animClock.d.ts.map