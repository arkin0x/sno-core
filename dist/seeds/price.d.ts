/**
 * The price of a DNA's caps (§7), the NIP-13 checks on seeds and mixed DNAs,
 * and reading a seed's tags (§8.2).
 */
import { type Caps } from './constants.js';
/** The fields of a nostr event these checks read. */
export interface SeedsEvent {
    id: string;
    tags: string[][];
    pubkey?: string;
    created_at?: number;
    kind?: number;
    content?: string;
}
/** A tag value under CYBERSPACE_V2 §10: decimal digits, no sign, no leading zero unless it is `0`. */
export declare const isDecimal: (v: unknown) => v is string;
/** The bits one cap costs: the smallest `k >= 0` with `cap <= free * 2^k`; null when out of range. */
export declare function capBits(value: number, limits: {
    free: number;
    max: number;
}): number | null;
/** A DNA's price in bits, `16 + bits(vertices) + bits(symbols) + bits(generations)`; null when a cap is invalid. */
export declare function capsPrice(caps: Caps): number | null;
/**
 * A DNA's caps from its tags (§8.1): the free caps without a `caps` tag;
 * null when there is more than one, or a value is not a §10 decimal within
 * its cap's range (the DNA is invalid).
 */
export declare function capsFromTags(tags: string[][]): Caps | null;
/** NIP-13 difficulty: the number of leading zero bits of a hex id. */
export declare function leadingZeroBits(hex: string): number;
/**
 * NIP-13 work at `bits` (§7): a seed at its DNA's price, a mixed DNA at
 * `MIX_FLOOR`. The committed target is a §10 decimal at least `bits`, and the
 * id has at least that many leading zero bits.
 */
export declare function workOk(ev: SeedsEvent, bits: number): boolean;
/** A mixed DNA's work at the mix floor (§7). */
export declare const mixWorkOk: (ev: SeedsEvent) => boolean;
/**
 * The check on a seed before its DNA is resolved (§8.2): a `nonce` tag whose
 * committed target is a §10 decimal of at least the base price, and an id with
 * at least that many leading zero bits.
 */
export declare function seedPrecheck(ev: SeedsEvent): boolean;
/** A seed's tags, read (§8.2). */
export interface SeedTags {
    dnaId: string;
    dnaRelay: string;
    /** The stated planted height; the clamp gives the effective one. */
    planted: number;
    scale: number;
    coord: string;
    /** The committed NIP-13 target. */
    target: number;
    title?: string;
    /** Present on a moved seed: its lineage (DECK-0006 §2.2). */
    d?: string;
}
/**
 * Read a `kind 3351` seed's tags (§8.2), with every check a reader makes
 * before it resolves the DNA, the precheck included. Where a tag should
 * appear once and appears more often, the first is used. After resolving the
 * DNA, check `target >= capsPrice(dna caps)`, or call `workOk(ev, price)`.
 */
export declare function readSeed(ev: SeedsEvent): {
    ok: true;
    seed: SeedTags;
} | {
    ok: false;
    reason: string;
};
/** A NIP-01 event id: SHA-256 of `[0, pubkey, created_at, kind, tags, content]` as JSON. */
export declare function eventId(ev: Required<Pick<SeedsEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>>): string;
//# sourceMappingURL=price.d.ts.map