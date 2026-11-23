/**
 * The fixed numbers of DECK-0008 (Seeds): the language's limits, the clock,
 * the domains, the price table and the sine table.
 *
 * Section numbers in this directory refer to DECK-0008
 * (https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0008-seeds.md),
 * whose reference interpreter, `decks/seeds-reference.mjs`, this is a port of.
 * Where the two disagree the DECK is right.
 */
/** SNO ticks per model unit (DECK-0003 §1.2). */
export declare const SEED_TICK = 120;
/** One SEEDO length step: a tenth of a unit, in ticks (§5.1). */
export declare const SEED_STEP = 12;
/** Fixed-point 1.0 for turtle directions (§5.1). */
export declare const SEED_ONE = 16384;
/** Blocks per generation, `N` (§4.1). */
export declare const BLOCKS_PER_GENERATION = 144;
/** The clock reads the block this far below the tip (§4.1). */
export declare const CLOCK_DEPTH = 6;
/** A mix's outcome block is its commit height plus this (§6.2). */
export declare const MIX_DELAY = 36;
/** A mixed DNA is at most this many mixes from written DNA (§6.7). */
export declare const MIX_DEPTH_MAX = 8;
/** Seconds: the planted-height clamp's margin (§4.2). */
export declare const CLAMP_MARGIN = 7200;
/** Block 0's header time; every later header time is greater (§4.2). */
export declare const GENESIS_TIME = 1231006505;
/** The SEEDO revision this reader knows (§3.2). */
export declare const SEEDO_REVISION = 1;
/** The known keywords of a SEEDO line (§3.1). Any other first word is an unknown line. */
export declare const SEEDO_KEYWORDS: readonly string[];
/** The language's fixed limits (§3.8). */
export declare const SEEDO_LIMITS: {
    readonly rules: 40;
    readonly params: 4;
    readonly value: 1000000;
    readonly stack: 64;
    readonly region: 64;
    readonly textBytes: 8192;
    readonly exprNodes: 64;
    readonly exprDepth: 16;
    readonly successor: 64;
    readonly headNodes: 256;
    readonly dnaNodes: 1024;
};
export declare const TERRAIN_DOMAIN_V2 = "CYBERSPACE_TERRAIN_K_V2";
export declare const TERROIR_DOMAIN = "CYBERSPACE_SEED_TERROIR_V1";
export declare const MIX_DOMAIN = "CYBERSPACE_SEED_MIX_V1";
/** The cell widths, in bits above the seed's scale, of the four terroir nibbles, finest first (§4.4). */
export declare const TERRAIN_CELL_BITS: readonly number[];
/** The three caps a DNA declares (§7). */
export interface Caps {
    vertices: number;
    symbols: number;
    generations: number;
}
/** The NIP-13 work a mixed DNA carries, in bits (§7). Provisional. */
export declare const MIX_FLOOR = 20;
/** The price table of §7. Provisional numbers. */
export declare const SEED_PRICE: {
    readonly base: 16;
    readonly caps: {
        readonly vertices: {
            readonly free: 2048;
            readonly max: 65536;
        };
        readonly symbols: {
            readonly free: 2048;
            readonly max: 16384;
        };
        readonly generations: {
            readonly free: 32;
            readonly max: 256;
        };
    };
};
/** The caps of a DNA without a `caps` tag, the free caps (§7). */
export declare const BASE_CAPS: Readonly<Caps>;
/** `sin(d) * 16384` for whole degrees 0..90, rounded. Part of the language, never computed (§5.1). */
export declare const SEED_SIN: readonly number[];
/** The built-in names of an expression (§3.4). */
export declare const SEEDO_BUILTINS: readonly string[];
/** The words that are never names (§3.4). */
export declare const SEEDO_RESERVED: readonly string[];
/** A standard gene: its default value and range, and the bounds a declared range is narrowed to (§3.3). */
export interface StandardGene {
    name: 'size' | 'hue' | 'tone' | 'opacity';
    def: number;
    lo: number;
    hi: number;
    min: number;
    max: number;
}
/**
 * The fourth standard gene (§3.3): how solid the whole bloom is drawn, in
 * percent, carried as the payload's `opacity` below 100 (§5.4, §5.5). It is
 * last in the genome, after the DNA's own genes, so adding it moved no other
 * gene's index in a mix (§6.4). Its default range, 100..100, keeps every DNA
 * that never mentions it fully solid, and every mix of two such DNAs too.
 */
export declare const OPACITY_GENE: StandardGene;
/**
 * The standard genes (§3.3). Every DNA has all four. The genome holds the
 * first three first, then the DNA's own genes, then `opacity`.
 */
export declare const STANDARD_GENES: readonly StandardGene[];
//# sourceMappingURL=constants.d.ts.map