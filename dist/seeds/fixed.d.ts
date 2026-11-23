/** `sin(d)` for whole degrees, times 16384, from the table (§5.1). */
export declare function isin(d: number): number;
/** `cos(d)` for whole degrees, times 16384: `isin(d + 90)`. */
export declare function icos(d: number): number;
/** The largest integer whose square is at most `n`; 0 for `n <= 0`. */
export declare function isqrt(n: number): number;
/** `a / b` rounded toward minus infinity. Not expression division, which truncates (§3.4). */
export declare const fdiv: (a: number, b: number) => number;
/**
 * lowbias32 (Chris Wellons), the weather mixer of §4.3: unsigned 32 bits in,
 * unsigned 32 bits out. The products use Math.imul, since a plain `*` loses
 * the low bits once a product passes 2^53.
 */
export declare function lowbias32(x: number): number;
/**
 * The weather word of 64 hex characters (§4.3): a block hash in its displayed
 * order, or a SHA-256 such as the mix hash (§6.3).
 */
export declare function weatherWord(hex: string): number;
/** `W`, the generation's roll for the whole bloom, 0..99 (§4.3). */
export declare function generationRoll(word: number): number;
/** `w`, the roll of the symbol at index `i` of the string being rewritten, 0..99 (§4.3). */
export declare function symbolRoll(word: number, i: number): number;
//# sourceMappingURL=fixed.d.ts.map