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
 *    reduced motion every motion is drawn at phase 0, the rest pose, unless
 *    the viewer chose the time by hand (an editor's scrub).
 *
 * ONOSENDAI's lib/worldClock.ts and scene/animMotion.ts (ONOSENDAI #735) hold
 * the same rules with the timers and the scene around them.
 */
import { phaseAt, smoothstep } from './anim.js';
// ---- correcting t ----------------------------------------------------------------
/** Corrections of this or less are left to the device clock (§1.14: "more than 2 seconds"). */
export const MIN_CORRECTION_MS = 2000;
/** An offset this large is no clock error but a broken source (a stale cached response): ignored. */
export const SANE_OFFSET_MS = 24 * 3600_000;
/** The server time header a source may send, Unix milliseconds. */
export const SERVER_TIME_HEADER = 'x-server-time';
const median = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
/**
 * The offset the samples show, and how sure it is: the median over the
 * usable samples of server + resolution / 2 − midpoint, and the median of
 * RTT / 2 + resolution / 2. Null without a usable sample.
 */
export function offsetFrom(samples) {
    const ok = samples.filter((s) => Number.isFinite(s.serverMs) && Number.isFinite(s.sentMs) && Number.isFinite(s.gotMs) && s.gotMs >= s.sentMs);
    if (ok.length === 0)
        return null;
    return {
        offsetMs: median(ok.map((s) => s.serverMs + s.resolutionMs / 2 - (s.sentMs + s.gotMs) / 2)),
        uncertaintyMs: median(ok.map((s) => (s.gotMs - s.sentMs) / 2 + s.resolutionMs / 2)),
    };
}
/**
 * The correction to use after a measurement, against the one in force (ms):
 * - none (0), when the measured offset is 2 seconds or less: the device is
 *   the better clock, and a correction in force is dropped;
 * - kept, when one is in force and the new measurement agrees with it
 *   within the measurement's own doubt: noise, so nothing wobbles;
 * - the measured offset otherwise (kept up to date).
 * Nothing usable, or an offset past SANE_OFFSET_MS, keeps `current`.
 */
export function correctionFor(samples, current) {
    const m = offsetFrom(samples);
    if (!m || Math.abs(m.offsetMs) > SANE_OFFSET_MS)
        return current;
    if (Math.abs(m.offsetMs) <= MIN_CORRECTION_MS)
        return 0;
    if (current !== 0 && Math.abs(m.offsetMs - current) <= m.uncertaintyMs)
        return current;
    return m.offsetMs;
}
/**
 * A server time from a response's headers: `X-Server-Time` (ms) if present,
 * else `Date` (whole seconds) plus any `Age` (a cache in between that kept
 * the upstream Date says how long it held the response); null for neither.
 * A browser reads either cross-origin only when the source names it in
 * `Access-Control-Expose-Headers`; a same-origin `Date` is always readable.
 */
export function serverTimeOf(headers) {
    const header = headers.get(SERVER_TIME_HEADER);
    const ms = Number(header);
    if (header !== null && Number.isFinite(ms) && ms > 0)
        return { serverMs: ms, resolutionMs: 1 };
    const date = headers.get('date');
    const parsed = date ? Date.parse(date) : NaN;
    if (!Number.isFinite(parsed))
        return null;
    const age = Number(headers.get('age'));
    return { serverMs: parsed + (Number.isFinite(age) && age > 0 ? age * 1000 : 0), resolutionMs: 1000 };
}
export function newPhaseState(n) {
    return { shown: new Float64Array(n), err: new Float64Array(n), start: new Float64Array(n), len: new Float64Array(n), version: -1, held: false };
}
/** A phase error wrapped into [−1/2, 1/2): the shorter way round a cycle. */
export function wrapHalf(e) {
    return e - Math.floor(e + 0.5);
}
/** How long an ease of `err` cycles takes on a cycle of `period` seconds: min(3, max(0.5, |e| × P)). */
export function easeSeconds(err, period) {
    const p = Number.isFinite(period) && period > 0 ? period : 0;
    return Math.min(3, Math.max(0.5, Math.abs(err) * p));
}
/**
 * The phase each motion is drawn at, written into `st.shown`. Pure but for
 * `st`, where the eases live. Allocates nothing.
 *
 * - Reduced motion: phase 0 for every motion (`st.held`; a caller draws the
 *   object as written, §1.14), unless the reading is a time the viewer chose.
 * - Otherwise the true phase, eased into whenever the clock's version changed
 *   since the last frame or reduced motion was just turned off: the error
 *   wrapped the shorter way round, drawn as u − e × (1 − ease(τ)), τ running
 *   0 to 1 over easeSeconds(e, b / |c|).
 * - The first frame, and any time chosen by hand, draws the true pose at once.
 */
export function stepPhases(motions, r, reduced, st) {
    const n = motions.length;
    if (reduced && !r.chosen) {
        for (let i = 0; i < n; i++) {
            st.shown[i] = 0;
            st.err[i] = 0;
            st.len[i] = 0;
        }
        st.held = true;
        st.version = r.version;
        return;
    }
    const first = st.version === -1;
    const changed = !first && !r.chosen && (st.version !== r.version || st.held);
    if (r.chosen)
        for (let i = 0; i < n; i++)
            st.len[i] = 0;
    for (let i = 0; i < n; i++) {
        const m = motions[i];
        const truth = phaseAt(m, r.t);
        if (changed) {
            const e = wrapHalf(truth - st.shown[i]);
            st.err[i] = e;
            st.start[i] = r.nowS;
            st.len[i] = e === 0 ? 0 : easeSeconds(e, m.b / Math.abs(m.c));
        }
        let shown = truth;
        if (st.len[i] > 0) {
            const tau = (r.nowS - st.start[i]) / st.len[i];
            if (tau >= 1 || tau < 0)
                st.len[i] = 0;
            else
                shown = truth - st.err[i] * (1 - smoothstep(tau));
        }
        shown -= Math.floor(shown);
        st.shown[i] = shown;
    }
    st.version = r.version;
    st.held = false;
}
//# sourceMappingURL=animClock.js.map