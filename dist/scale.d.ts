/**
 * scale.ts — the physical size of one cell at a given scale.
 *
 * The spec puts 2^33 gibsons in a meter (§9.2, §9.7), so a gibson is about
 * 1.16e-10 m, roughly a hydrogen atom.
 */
/**
 * A gibson count as a human distance.
 *
 * Takes a bigint because these are real cyberspace distances: a landmark can be
 * 10^25 gibsons away, which is past what a double holds exactly. The division to
 * meters happens in fixed point for that reason, and only then becomes a float.
 */
export declare function formatDistance(gibsons: bigint): string;
/** One cell at this scale, as a short human string like "1.91 \u03bcm". */
export declare function formatCellSize(scaleExp: number): string;
/** The same, with the unit spelled out: "1.91 micrometers", "1 meter", "2 astronomical units". */
export declare function formatCellSizeLong(scaleExp: number): string;
//# sourceMappingURL=scale.d.ts.map