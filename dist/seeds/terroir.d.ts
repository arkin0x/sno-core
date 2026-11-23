/** A coordinate's three axes and its plane bit. */
export interface SeedXyz {
    x: bigint;
    y: bigint;
    z: bigint;
    plane: number;
}
/** The terrain of a seed's coordinate at its scale (§4.4). */
export interface Terroir {
    /** The number of 1 bits in the four nibbles, 0..16. */
    K: number;
    /** The finest nibble, 0..15. */
    n0: number;
    n1: number;
    n2: number;
    /** The coarsest nibble, 0..15. */
    n3: number;
    /** The plane, 0 or 1. */
    pl: number;
}
/** A coordinate's axes, from its 256-bit hex form (CYBERSPACE_V2 §2.2). */
export declare function coordHexToXyz(hex: string): SeedXyz;
/** A coordinate's 64 lowercase hex characters, from its axes and plane. */
export declare function xyzToCoordHex(x: bigint, y: bigint, z: bigint, plane: number): string;
/**
 * Terroir at scale `u` (0..84): at `u = 0` exactly terrain `K` of
 * CYBERSPACE_V2 §5.2; above it, cells `2^u` times wider, hashed under the
 * seed terroir domain with `byte(u)` in the preimage. Four SHA-256 calls.
 */
export declare function terroir(coordHex: string, scale?: number): Terroir;
//# sourceMappingURL=terroir.d.ts.map