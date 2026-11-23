/**
 * Coordinates (CYBERSPACE_V2 §2.2) and terroir, the soil of a seed (§4.4).
 */
import { TERRAIN_CELL_BITS, TERRAIN_DOMAIN_V2, TERROIR_DOMAIN } from './constants.js';
import { concatBytes, hexBytes, sha256Hex, utf8Bytes } from './hash.js';
const AXIS_BITS = 85;
/** A coordinate's axes, from its 256-bit hex form (CYBERSPACE_V2 §2.2). */
export function coordHexToXyz(hex) {
    if (!/^[0-9a-fA-F]{1,64}$/.test(hex))
        throw new Error('a coordinate is up to 64 hex characters');
    const c = BigInt('0x' + hex);
    let x = 0n, y = 0n, z = 0n;
    for (let i = 0; i < AXIS_BITS; i++) {
        const b = BigInt(i);
        z |= ((c >> BigInt(1 + i * 3)) & 1n) << b;
        y |= ((c >> BigInt(2 + i * 3)) & 1n) << b;
        x |= ((c >> BigInt(3 + i * 3)) & 1n) << b;
    }
    return { x, y, z, plane: Number(c & 1n) };
}
/** A coordinate's 64 lowercase hex characters, from its axes and plane. */
export function xyzToCoordHex(x, y, z, plane) {
    let c = BigInt(plane & 1);
    for (let i = 0; i < AXIS_BITS; i++) {
        const b = BigInt(i);
        c |= ((z >> b) & 1n) << BigInt(1 + i * 3);
        c |= ((y >> b) & 1n) << BigInt(2 + i * 3);
        c |= ((x >> b) & 1n) << BigInt(3 + i * 3);
    }
    return c.toString(16).padStart(64, '0');
}
/**
 * Terroir at scale `u` (0..84): at `u = 0` exactly terrain `K` of
 * CYBERSPACE_V2 §5.2; above it, cells `2^u` times wider, hashed under the
 * seed terroir domain with `byte(u)` in the preimage. Four SHA-256 calls.
 */
export function terroir(coordHex, scale = 0) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 84)
        throw new Error('a scale is 0 to 84');
    const p = coordHexToXyz(coordHex);
    const dom = utf8Bytes(scale === 0 ? TERRAIN_DOMAIN_V2 : TERROIR_DOMAIN);
    const nib = TERRAIN_CELL_BITS.map((b0) => {
        const bits = b0 + scale, B = BigInt(bits);
        const cell = hexBytes(xyzToCoordHex((p.x >> B) << B, (p.y >> B) << B, (p.z >> B) << B, p.plane));
        const pre = scale === 0
            ? concatBytes(dom, Uint8Array.of(bits), cell)
            : concatBytes(dom, Uint8Array.of(scale), Uint8Array.of(bits), cell);
        return parseInt(sha256Hex(pre).slice(0, 2), 16) & 0x0f;
    });
    const word16 = (nib[0] << 12) | (nib[1] << 8) | (nib[2] << 4) | nib[3];
    let K = 0;
    for (let v = word16; v; v >>= 1)
        K += v & 1;
    return { K, n0: nib[0], n1: nib[1], n2: nib[2], n3: nib[3], pl: p.plane };
}
//# sourceMappingURL=terroir.js.map