/**
 * Mixing two DNAs (§6): the mix hash and word, the gene draw with dominance
 * and mutation, sterility and species, the child's exact text, and when a
 * committed mix resolves.
 */
import { type Caps } from './constants.js';
import { type HeaderTimeSource } from './clock.js';
import { type Dna, type Gene } from './parse.js';
import type { BlockHashSource } from './grow.js';
import { type SeedsEvent } from './price.js';
/** `SHA256("CYBERSPACE_SEED_MIX_V1" || outcome block hash || commit id)`, 64 hex (§6.3). */
export declare function mixHash(outcomeBlockHash: string, commitId: string): string;
/** `s0`, the weather word of the mix hash (§6.3). */
export declare function mixWord(outcomeBlockHash: string, commitId: string): number;
/**
 * A mixed DNA's `name` tag under §6.6: `default` when absent or empty (the
 * child is named "mother x father"), `valid`, or `invalid` (the mixed DNA is
 * invalid).
 */
export declare function nameTagVerdict(v: string | undefined): 'default' | 'valid' | 'invalid';
/** A child's gene line (§6.6 step 4): `gene <name> <allele> <allele> in <lo>..<hi>`, single spaces. */
export declare function geneLine(g: Pick<Gene, 'name' | 'a' | 'b' | 'lo' | 'hi'>): string;
/** How one gene of the child was drawn (§6.4). */
export interface GeneDraw {
    name: string;
    /** The 32-bit word that drew it. */
    word: number;
    /** Where each allele came from: `A1`, `A2`, `B1`, `B2`. */
    from: [string, string];
    child: Gene;
    expressed: number;
    /** The allele (1 or 2) that mutated, when it moved. */
    mutated: {
        allele: 1 | 2;
        from: number;
        to: number;
    } | null;
}
export type MixRefusal = 'sterile' | 'different SEEDO revisions' | 'different species' | 'invalid name tag';
export type MixResult = {
    refused: MixRefusal;
} | {
    refused?: undefined;
    /** The child's text, computed line by line from the mother's (§6.6). */
    text: string;
    /** The child, parsed. */
    dna: Dna;
    draws: GeneDraw[];
    /** The parents are of one species; otherwise the child is a sterile hybrid. */
    sameSpecies: boolean;
};
export interface MixOptions {
    /** The mixed DNA's `name` tag value, if it has one. */
    name?: string;
    /** The mixed DNA carries a `hybrid` tag (§6.5). */
    hybrid?: boolean;
}
/**
 * Mix a mother and a father with the mix word `s0` (§6.4 to §6.6). A preview
 * may pass any 32-bit word (§6.8). Lineage checks that need events (depth,
 * parents resolved, the anchor) are `mixSchedule`'s and the caller's.
 */
export declare function mixDna(mother: Dna, father: Dna, s0: number, options?: MixOptions): MixResult;
/**
 * Where a committed mix stands at a reader's clock height (§6.2, §6.7).
 *
 * - `pending`: the anchor is above the clock, the commit height is not settled
 *   (or a header is missing), or a mixed parent's commit height is not settled.
 * - `invalid`: the anchor's hash is not the reader's block at that height, no
 *   block qualifies for the clamp's ceiling, or the commit height is lower than
 *   a mixed parent's outcome height.
 * - `committed`: the commit and outcome heights; `ready` once the outcome
 *   height is at most the clock height, and the child exists.
 */
export type MixSchedule = {
    state: 'pending';
    reason: string;
} | {
    state: 'invalid';
    reason: string;
} | {
    state: 'committed';
    commitHeight: number;
    outcomeHeight: number;
    ready: boolean;
};
export interface MixCommit {
    /** The `block` tag's height. */
    anchorHeight: number;
    /** The `block` tag's hash: it MUST be the reader's block at that height (§6.2). */
    anchorHash: string;
    /** The mixed DNA's `created_at`. */
    createdAt: number;
    /**
     * The outcome heights of the mixed parents (a written parent has none).
     * Null for a mixed parent whose own commit height is not settled yet.
     */
    parentOutcomeHeights?: Array<number | null>;
    /** The depths of both parents: 0 for a written DNA (§6.7). */
    parentDepths?: number[];
}
export declare function mixSchedule(commit: MixCommit, clock: number, time: HeaderTimeSource, blockHash: BlockHashSource): MixSchedule;
/** A mixed DNA's tags, read (§8.1). */
export interface MixedDnaTags {
    motherId: string;
    fatherId: string;
    anchorHeight: number;
    anchorHash: string;
    /** The `name` tag's value when it is not empty. */
    name?: string;
    hybrid: boolean;
    caps: Caps;
}
/**
 * Read a `kind 3350` with empty content, a mixed DNA (§8.1): exactly one
 * `nonce` with work at the mix floor, one `mother` and one `father`, one
 * `block` whose height is a §10 decimal and whose hash is 64 lowercase hex,
 * a valid `name` tag if any, and valid caps. Any failure makes it invalid,
 * and every child whose ancestry includes it. The signature is the caller's.
 */
export declare function readMixedDna(ev: SeedsEvent): {
    ok: true;
    mix: MixedDnaTags;
} | {
    ok: false;
    reason: string;
};
//# sourceMappingURL=mix.d.ts.map