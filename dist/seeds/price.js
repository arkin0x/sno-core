/**
 * The price of a DNA's caps (§7), the NIP-13 checks on seeds and mixed DNAs,
 * and reading a seed's tags (§8.2).
 */
import { BASE_CAPS, MIX_FLOOR, SEED_PRICE } from './constants.js';
import { sha256Hex } from './hash.js';
/** A tag value under CYBERSPACE_V2 §10: decimal digits, no sign, no leading zero unless it is `0`. */
export const isDecimal = (v) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
/** The bits one cap costs: the smallest `k >= 0` with `cap <= free * 2^k`; null when out of range. */
export function capBits(value, limits) {
    if (!Number.isInteger(value) || value < 1 || value > limits.max)
        return null;
    let k = 0;
    while (limits.free * 2 ** k < value)
        k++;
    return k;
}
/** A DNA's price in bits, `16 + bits(vertices) + bits(symbols) + bits(generations)`; null when a cap is invalid. */
export function capsPrice(caps) {
    let bits = SEED_PRICE.base;
    for (const k of ['vertices', 'symbols', 'generations']) {
        const b = capBits(caps[k], SEED_PRICE.caps[k]);
        if (b === null)
            return null;
        bits += b;
    }
    return bits;
}
/**
 * A DNA's caps from its tags (§8.1): the free caps without a `caps` tag;
 * null when there is more than one, or a value is not a §10 decimal within
 * its cap's range (the DNA is invalid).
 */
export function capsFromTags(tags) {
    const found = tags.filter((t) => t[0] === 'caps');
    if (found.length === 0)
        return { ...BASE_CAPS };
    if (found.length > 1)
        return null;
    const [, v, s, g] = found[0];
    if (!isDecimal(v) || !isDecimal(s) || !isDecimal(g))
        return null;
    const caps = { vertices: Number(v), symbols: Number(s), generations: Number(g) };
    return capsPrice(caps) === null ? null : caps;
}
/** NIP-13 difficulty: the number of leading zero bits of a hex id. */
export function leadingZeroBits(hex) {
    let n = 0;
    for (const ch of hex) {
        const v = parseInt(ch, 16);
        if (v === 0) {
            n += 4;
            continue;
        }
        n += Math.clz32(v) - 28;
        break;
    }
    return n;
}
const nonceTag = (ev) => ev.tags.find((x) => x[0] === 'nonce');
/**
 * NIP-13 work at `bits` (§7): a seed at its DNA's price, a mixed DNA at
 * `MIX_FLOOR`. The committed target is a §10 decimal at least `bits`, and the
 * id has at least that many leading zero bits.
 */
export function workOk(ev, bits) {
    const t = nonceTag(ev);
    if (!t || !isDecimal(t[2]) || Number(t[2]) < bits)
        return false;
    return leadingZeroBits(ev.id) >= bits;
}
/** A mixed DNA's work at the mix floor (§7). */
export const mixWorkOk = (ev) => workOk(ev, MIX_FLOOR);
/**
 * The check on a seed before its DNA is resolved (§8.2): a `nonce` tag whose
 * committed target is a §10 decimal of at least the base price, and an id with
 * at least that many leading zero bits.
 */
export function seedPrecheck(ev) {
    const t = nonceTag(ev);
    if (!t || !isDecimal(t[2]) || Number(t[2]) < SEED_PRICE.base)
        return false;
    return leadingZeroBits(ev.id) >= Number(t[2]);
}
/**
 * Read a `kind 3351` seed's tags (§8.2), with every check a reader makes
 * before it resolves the DNA, the precheck included. Where a tag should
 * appear once and appears more often, the first is used. After resolving the
 * DNA, check `target >= capsPrice(dna caps)`, or call `workOk(ev, price)`.
 */
export function readSeed(ev) {
    const first = (k) => ev.tags.find((t) => t[0] === k);
    const dna = first('dna'), planted = first('planted'), scale = first('scale'), C = first('C'), nonce = first('nonce');
    if (!dna || !/^[0-9a-fA-F]{64}$/.test(dna[1] ?? ''))
        return { ok: false, reason: 'the dna tag is not 64 hex' };
    if (!planted || !isDecimal(planted[1]))
        return { ok: false, reason: 'planted is not a decimal' };
    if (scale && (!isDecimal(scale[1]) || Number(scale[1]) > 84))
        return { ok: false, reason: 'scale is not a decimal from 0 to 84' };
    if (!C)
        return { ok: false, reason: 'no C tag' };
    // a seed needs an exact coordinate, because its terroir depends on it (§8.2)
    if (!/^[0-9a-f]{64}$/.test(C[1] ?? ''))
        return { ok: false, reason: 'C is not 64 lowercase hex' };
    if (!nonce)
        return { ok: false, reason: 'no nonce tag' };
    if (!seedPrecheck(ev))
        return { ok: false, reason: 'the work is below its committed target or the base price' };
    const seed = { dnaId: dna[1].toLowerCase(), dnaRelay: dna[2] ?? '', planted: Number(planted[1]), scale: scale ? Number(scale[1]) : 0, coord: C[1], target: Number(nonce[2]) };
    const title = first('title'), d = first('d');
    if (title && typeof title[1] === 'string')
        seed.title = title[1];
    if (d && typeof d[1] === 'string')
        seed.d = d[1];
    return { ok: true, seed };
}
/** A NIP-01 event id: SHA-256 of `[0, pubkey, created_at, kind, tags, content]` as JSON. */
export function eventId(ev) {
    return sha256Hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
}
//# sourceMappingURL=price.js.map