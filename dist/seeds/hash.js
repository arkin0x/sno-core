/**
 * SHA-256 for Seeds: terroir, the mix hash, the payload hash and event ids.
 *
 * Synchronous and dependency-light, so it runs on a drawing thread, in a Web
 * Worker and in a Cloudflare Worker alike: `@noble/hashes`, which the clients
 * already carry through nostr-tools. WebCrypto's digest is asynchronous, and
 * terroir is computed inside growth.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js';
const utf8 = new TextEncoder();
/** UTF-8 bytes of a string. */
export function utf8Bytes(s) {
    return utf8.encode(s);
}
/** Bytes of an even-length hex string (either case). Throws on anything else. */
export function hexBytes(hex) {
    return nobleHexToBytes(hex);
}
/** The concatenation of byte arrays. */
export function concatBytes(...parts) {
    let n = 0;
    for (const p of parts)
        n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
/** SHA-256 as 64 lowercase hex characters. A string is hashed as its UTF-8 bytes. */
export function sha256Hex(data) {
    return bytesToHex(sha256(typeof data === 'string' ? utf8Bytes(data) : data));
}
//# sourceMappingURL=hash.js.map