/**
 * Growing a bloom (§4) and drawing it as a SNO payload (§5).
 *
 * A bloom is a pure function of its DNA, its seed (coordinate, effective
 * planted height, scale, caps), the clock height and the block hashes. No DOM,
 * no clock, no randomness: it runs on any thread, a Web Worker included.
 *
 * Growing is two steps, so a client can cache the first: `growSymbols` rewrites
 * the string once per generation (a day of blocks), and `drawBloom` turns it
 * into geometry at the current age, once per block. `growBloom` does both.
 *
 * Across a worker boundary, post the DNA's text and parse it in the worker: a
 * parsed `Dna` holds compiled functions, which cannot be cloned. `tryGrowBloom`
 * takes the text and returns errors instead of throwing.
 */
import { type Caps } from './constants.js';
import { type SeedEnv } from './expr.js';
import { type Dna } from './parse.js';
import type { ShardPayload } from '../shards.js';
/** A block's hash by height, 64 hex in displayed order (§4.3); null or undefined when the reader lacks it. */
export type BlockHashSource = (height: number) => string | null | undefined;
/** What a seed contributes to its bloom. */
export interface SeedPlanting {
    /** The seed's `C`, 64 hex. Its terroir depends on it exactly. */
    coord: string;
    /**
     * The effective planted height, after the clamp (`effectivePlantedHeight`).
     * Null while it is not settled: the bloom is then drawn at generation 0.
     */
    planted: number | null;
    /** The seed's scale `u`, 0..84. Default 0. */
    scale?: number;
    /** The DNA's caps (`capsFromTags`). Default the free caps. */
    caps?: Caps;
}
/** One symbol of a bloom's string: its character, up to four parameters, and the generation that made it (§4.6). */
export interface BloomSymbol {
    c: string;
    p: number[];
    b: number;
}
/** Why growth stopped short of the generation the clock calls for. */
export type GrowthStop = 'missing-block' | 'budget' | 'aborted';
/** A bloom's string at a generation, ready to draw at any age within that generation. */
export interface GrownSymbols {
    str: BloomSymbol[];
    /** The generation reached. */
    generation: number;
    /** The generation the clock it was grown for calls for. `drawBloom` recomputes it for the clock it draws at. */
    targetGeneration: number;
    /** True when `generation` is `targetGeneration`. */
    complete: boolean;
    /** Why it stopped short, when it did. Resume with `{ from }`. */
    stopped?: GrowthStop;
    /** The first driving block the reader lacked, when it is behind (§4.1). */
    missingBlock?: number;
    /** The driving blocks used, in order, since generation 1. */
    weatherBlocks: number[];
    /** Symbol steps this call spent (symbols visited by rewriting). */
    steps: number;
    /** The seed's environment by slot: terroir, expressed genes and lets (§4.5). */
    env: SeedEnv;
    /** What this string was grown for, so `{ from }` can tell whether it still applies. */
    grownFor: {
        dnaText: string;
        coord: string;
        planted: number | null;
        scale: number;
        symbolCap: number;
    };
}
/** How much one call to `growSymbols` may do. */
export interface GrowOptions {
    /**
     * A string grown earlier for the same DNA and seed, to continue from its
     * generation instead of from the axiom. Ignored (growth starts again from
     * the axiom, which is always right) when it was grown for another DNA,
     * place, planted height, scale or symbol cap, or is past the generation
     * the clock calls for.
     */
    from?: GrownSymbols;
    /**
     * A budget in symbol steps. Growth stops before a generation that would
     * take it past the budget, though every call grows at least one generation
     * when one is due, so it always makes progress. Compare `worstCaseSteps`.
     */
    maxSteps?: number;
    /** Checked before each generation: an aborted signal stops growth there. */
    signal?: {
        readonly aborted: boolean;
    };
}
/** The most symbol steps growing a DNA with these caps can take: generations times symbols (§7). */
export declare function worstCaseSteps(caps?: Caps): number;
/** The bloom's SNO payload (§5.5). A ShardPayload, built by construction to be valid. */
export interface BloomPayload extends ShardPayload {
    v: 2;
    mode: 'solid';
    colors: number[];
}
/**
 * The geometry as typed arrays, for a worker to post with its buffers in the
 * transfer list (`bloomTransferList`) instead of cloning a payload.
 */
export interface BloomBuffers {
    /** x, y, z per vertex in SNO ticks (120 per model unit; one model unit is 2^scale gibsons), clamped to 64 units. */
    positions: Int32Array;
    /** One palette index per vertex (`cyberspace-neon-256`). */
    colors: Uint8Array;
    /** Three vertex indices per face. */
    faces: Uint32Array;
    /**
     * How solid the whole bloom is drawn, in percent (`10..99`): the expressed
     * standard gene `opacity` (§5.4). Absent when it is 100, exactly when the
     * payload omits it, so a client that builds a shard from the buffers sets
     * the shard's `opacity` from this field and nothing else.
     */
    opacity?: number;
}
/** The buffers to pass as a postMessage transfer list with `BloomBuffers`. */
export declare function bloomTransferList(b: BloomBuffers): ArrayBuffer[];
/** What a drawn bloom says about its growth. */
export interface BloomGrowth {
    /** Clock height minus the effective planted height (0 while not settled). */
    age: number;
    generation: number;
    targetGeneration: number;
    /**
     * True when growth stopped short of the generation the clock calls for: a
     * missing block (§4.1), a budget or an abort. The bloom is still drawn at
     * the clock's age, so every symbol of the generations it reached is fully
     * grown; only the later rewrites are missing.
     */
    behind: boolean;
    stopped?: GrowthStop;
    missingBlock?: number;
    /** Symbols in the string drawn. */
    symbols: number;
    weatherBlocks: number[];
}
/** A grown and drawn bloom, with its payload, the payload's JSON and its hash. */
export interface Bloom extends BloomGrowth {
    sno: BloomPayload;
    /** The payload's compact JSON, keys in the §5.5 order. */
    json: string;
    /** SHA-256 of `json`'s UTF-8 bytes, 64 lowercase hex (§5.5). */
    sha256: string;
}
/** A bloom drawn with `DrawOptions`: only the parts asked for are present. */
export interface BloomParts extends BloomGrowth {
    sno?: BloomPayload;
    json?: string;
    sha256?: string;
    buffers?: BloomBuffers;
}
/** Which parts of a bloom to build. JSON and its hash cost a stringify and a SHA-256 of up to megabytes. */
export interface DrawOptions {
    /** The SNO payload. Default true. */
    payload?: boolean;
    /** The payload's JSON and SHA-256; needs the payload. Default true. */
    json?: boolean;
    /** Transferable typed arrays. Default false. */
    buffers?: boolean;
}
/** The environment of a seed by slot (§4.5): terroir, every gene's expressed value, then every `let`. */
export declare function envSlots(dna: Dna, coord: string, scale?: number): SeedEnv;
/** The environment of a seed by name, for people and tests: built-ins at 0, genes expressed, lets evaluated. */
export declare function bloomEnv(dna: Dna, coord: string, scale?: number): Record<string, number>;
/**
 * Rewrite a seed's string up to the generation the clock calls for (§4.1,
 * §4.6). Throws SeedoError when the axiom is longer than the symbol cap
 * (§3.6). A missing block hash stops growth at the generation before it and
 * says so, as §4.1 asks of a reader that is behind; so do a budget and an
 * abort (`GrowOptions`). Continue later with `{ from: grown }`.
 */
export declare function growSymbols(dna: Dna, seed: SeedPlanting, clock: number, blockHash: BlockHashSource, options?: GrowOptions): GrownSymbols;
/** The generation the clock calls for, for this seed (§4.1): 0 while the planted height is not settled. */
export declare function targetGeneration(seed: SeedPlanting, clock: number): number;
/**
 * True when a grown string can be drawn for this DNA and seed at this clock:
 * it was grown for the same DNA, coordinate, planted height, scale and symbol
 * cap, and is not past the generation the clock calls for. It may be behind
 * it; `drawBloom` then says so. `drawBloom` refuses a string for which this is
 * false, since it would draw another bloom.
 */
export declare function growthApplies(grown: GrownSymbols, dna: Dna, seed: SeedPlanting, clock: number): boolean;
/** The geometry of a drawn string: positions in ticks, painted colors, faces. */
export interface BloomGeometry {
    /** x, y, z in ticks, three numbers per vertex. */
    V: number[];
    C: number[];
    F: Array<[number, number, number]>;
}
/** Draw a string with the turtle (§5.2, §5.3, §5.4) at an age in blocks. `env` is the seed's slots (`envSlots`). */
export declare function drawGeometry(dna: Dna, str: readonly BloomSymbol[], age: number, env: SeedEnv, vertexCap: number): BloomGeometry;
/**
 * The bloom's opacity (§5.4): the expressed standard gene `opacity`, from 10
 * to 100. A DNA that does not declare it is 100, fully solid.
 */
export declare function bloomOpacity(dna: Dna): number;
/**
 * The SNO payload of drawn geometry (§5.5), keys in the order the payload
 * hash needs. `opacity` is the bloom's (`bloomOpacity`); it is written after
 * `faces`, and only when it is below 100.
 */
export declare function toBloomPayload(name: string, geo: BloomGeometry, unit: number, opacity?: number): BloomPayload;
/** The geometry as transferable typed arrays, with the bloom's opacity when it is below 100. */
export declare function toBloomBuffers(geo: BloomGeometry, opacity?: number): BloomBuffers;
/**
 * Draw a grown string at the clock height. Without options: the payload, its
 * JSON and its hash. With `DrawOptions`: only the parts asked for, for
 * example `{ json: false, buffers: true }` in a worker that posts geometry.
 *
 * The target generation is the one this clock calls for, so a string cached
 * at an earlier generation is drawn `behind` until it is grown on (with
 * `growSymbols(..., { from })`). Throws when `growthApplies` is false: a
 * string grown for another DNA or seed, or past this clock's generation.
 */
export declare function drawBloom(dna: Dna, grown: GrownSymbols, seed: SeedPlanting, clock: number): Bloom;
export declare function drawBloom(dna: Dna, grown: GrownSymbols, seed: SeedPlanting, clock: number, options: DrawOptions): BloomParts;
/**
 * Grow and draw one seed's bloom at a clock height (the tip minus 6).
 * `seed.planted` is the effective planted height from `effectivePlantedHeight`,
 * or null while it is not settled. Throws SeedoError only when the axiom is
 * longer than the symbol cap.
 */
export declare function growBloom(dna: Dna, seed: SeedPlanting, clock: number, blockHash: BlockHashSource): Bloom;
export declare function growBloom(dna: Dna, seed: SeedPlanting, clock: number, blockHash: BlockHashSource, options: GrowOptions & DrawOptions): BloomParts;
/**
 * A DNA as a worker receives it: a written DNA's text, or `{ text, computed:
 * true }` for a mixed child's computed text, which may pass 8,192 bytes (§3.1).
 */
export type DnaSource = Dna | string | {
    text: string;
    computed?: boolean;
};
/**
 * `growBloom` for a worker: takes the DNA as its text (or parsed), and returns
 * an invalid text, an axiom over the symbol cap or a malformed coordinate or
 * scale as `{ ok: false, error }` instead of throwing.
 */
export declare function tryGrowBloom(dna: DnaSource, seed: SeedPlanting, clock: number, blockHash: BlockHashSource): {
    ok: true;
    bloom: Bloom;
} | {
    ok: false;
    error: string;
};
export declare function tryGrowBloom(dna: DnaSource, seed: SeedPlanting, clock: number, blockHash: BlockHashSource, options: GrowOptions & DrawOptions): {
    ok: true;
    bloom: BloomParts;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=grow.d.ts.map