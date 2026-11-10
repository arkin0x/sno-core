/** A block's header time (its header's `time` field) by height; undefined when the reader lacks it. */
export type HeaderTimeSource = (height: number) => number | undefined;
/** A header the clamp needs and the reader does not have. Not a gap to step over (§4.2). */
export declare class MissingHeaderError extends Error {
    readonly height: number;
    constructor(height: number);
}
/** The clock height: the best tip minus 6 (§4.1). */
export declare function clockHeight(tipHeight: number): number;
/** The bloom's generation at an age in blocks: `min(floor(age / 144), cap)`, 0 before planting (§4.1). */
export declare function generationAt(age: number, generationCap: number): number;
/**
 * `f(b)` of §4.7: how far, out of 144, a symbol born in generation `birth` has
 * grown at `age`. Axiom symbols (birth 0) are always fully grown.
 */
export declare function grownFraction(birth: number, age: number): number;
/** Median time past of block `h`: the median header time of blocks `h - 10` to `h` (BIP-113). */
export declare function medianTimePast(h: number, time: HeaderTimeSource): number;
/** True once `MTP(clock) > createdAt + 7200`: E and F are then the same for every reader (§4.2). */
export declare function isSettled(createdAt: number, clock: number, time: HeaderTimeSource): boolean;
/**
 * The highest height at or below `clock` whose header time is at most `t`, or
 * -1 if no block's is. Header times are not monotonic, so this finds the
 * highest `h*` with `MTP(h*) < t` (MTP never decreases) and looks at
 * `h* + 1` down to `h* - 10`, as §4.2 describes.
 *
 * `h*` is found by galloping down from the clock, never below height 10 (the
 * lowest with an MTP), and then bisecting, which reads headers near the answer
 * only. The reference walks down one block at a time; the result is the same
 * on any chain whose MTP never decreases, which Bitcoin's consensus rules
 * guarantee. A header store may hold only recent blocks, so when the gallop or
 * the bisection reaches a header the reader lacks, this falls back to the
 * reference's walk from the lowest height already known to be too late, and
 * so never needs a header the reference does not.
 */
export declare function highestAtOrBelow(t: number, time: HeaderTimeSource, clock: number): number;
/**
 * The effective planted height of a seed, or the commit height of a mix
 * (§4.2, §6.2), at a reader's clock height.
 *
 * - `pending`: not settled yet, or a header it needs is missing. Draw the seed
 *   at generation 0; a mix is pending.
 * - `cannot-grow`: no block's header time is at most `createdAt + 7200`. The
 *   seed cannot grow; a mixed DNA is invalid.
 * - `settled`: `height = min(max(stated, E), F)`. `E` is null when no block
 *   qualifies for it, and then does not raise the height.
 */
export type PlantedHeight = {
    state: 'pending';
    missingHeader?: number;
} | {
    state: 'cannot-grow';
    E: null;
    F: null;
} | {
    state: 'settled';
    height: number;
    E: number | null;
    F: number;
};
export declare function effectivePlantedHeight(stated: number, createdAt: number, clock: number, time: HeaderTimeSource): PlantedHeight;
//# sourceMappingURL=clock.d.ts.map