/**
 * The clock (§4.1), growing between generations (§4.7), and the planted-height
 * clamp with its settling (§4.2). Header times come from the caller, so the
 * same code runs against a full node, a header cache or a test fixture.
 */
import { BLOCKS_PER_GENERATION, CLAMP_MARGIN, CLOCK_DEPTH, GENESIS_TIME } from './constants.js';
/** A header the clamp needs and the reader does not have. Not a gap to step over (§4.2). */
export class MissingHeaderError extends Error {
    height;
    constructor(height) {
        super('missing header ' + height);
        this.height = height;
        this.name = 'MissingHeaderError';
    }
}
/** The clock height: the best tip minus 6 (§4.1). */
export function clockHeight(tipHeight) {
    return tipHeight - CLOCK_DEPTH;
}
/** The bloom's generation at an age in blocks: `min(floor(age / 144), cap)`, 0 before planting (§4.1). */
export function generationAt(age, generationCap) {
    return age < 0 ? 0 : Math.min(Math.floor(age / BLOCKS_PER_GENERATION), generationCap);
}
/**
 * `f(b)` of §4.7: how far, out of 144, a symbol born in generation `birth` has
 * grown at `age`. Axiom symbols (birth 0) are always fully grown.
 */
export function grownFraction(birth, age) {
    const N = BLOCKS_PER_GENERATION;
    const f = birth === 0 ? N : Math.max(0, age) - birth * N;
    return f < 0 ? 0 : f > N ? N : f;
}
const need = (h, time) => {
    const t = time(h);
    if (t === undefined)
        throw new MissingHeaderError(h);
    return t;
};
/** Median time past of block `h`: the median header time of blocks `h - 10` to `h` (BIP-113). */
export function medianTimePast(h, time) {
    const ts = [];
    for (let k = h - 10; k <= h; k++)
        ts.push(need(k, time));
    return ts.sort((a, b) => a - b)[5];
}
/** True once `MTP(clock) > createdAt + 7200`: E and F are then the same for every reader (§4.2). */
export function isSettled(createdAt, clock, time) {
    return medianTimePast(clock, time) > createdAt + CLAMP_MARGIN;
}
/**
 * The highest height at or below `clock` whose header time is at most `t`, or
 * -1 if no block's is. Header times are not monotonic, so this finds the
 * highest `h*` with `MTP(h*) < t` (MTP never decreases) and looks at
 * `h* + 1` down to `h* - 10`, as §4.2 describes.
 *
 * `h*` is found by galloping down from the clock and then bisecting, which
 * reads headers near the answer only. The reference walks down one block at a
 * time; the result is the same on any chain whose MTP never decreases, which
 * Bitcoin's consensus rules guarantee.
 */
export function highestAtOrBelow(t, time, clock) {
    if (t < GENESIS_TIME)
        return -1;
    let hs;
    if (medianTimePast(clock, time) < t)
        hs = clock;
    else {
        // MTP(hi) >= t; find lo with MTP(lo) < t, doubling the step
        let hi = clock, step = 1, lo = clock - 1;
        while (medianTimePast(lo, time) >= t) {
            hi = lo;
            step *= 2;
            lo = clock - step;
        }
        while (hi - lo > 1) {
            const mid = lo + Math.floor((hi - lo) / 2);
            if (medianTimePast(mid, time) < t)
                lo = mid;
            else
                hi = mid;
        }
        hs = lo;
    }
    for (let h = Math.min(clock, hs + 1); h >= hs - 10; h--)
        if (need(h, time) <= t)
            return h;
    throw new Error('unreachable: MTP(h*) < t but no block of h*-10..h* is at or below t');
}
export function effectivePlantedHeight(stated, createdAt, clock, time) {
    try {
        if (!isSettled(createdAt, clock, time))
            return { state: 'pending' };
        const F = highestAtOrBelow(createdAt + CLAMP_MARGIN, time, clock);
        if (F < 0)
            return { state: 'cannot-grow', E: null, F: null };
        const E = highestAtOrBelow(createdAt - CLAMP_MARGIN, time, clock);
        return { state: 'settled', height: Math.min(Math.max(stated, E), F), E: E < 0 ? null : E, F };
    }
    catch (e) {
        if (e instanceof MissingHeaderError)
            return { state: 'pending', missingHeader: e.height };
        throw e;
    }
}
//# sourceMappingURL=clock.js.map