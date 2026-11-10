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
/** A bloom's string at a generation, ready to draw at any age within that generation. */
export interface GrownSymbols {
    str: BloomSymbol[];
    /** The generation reached. */
    generation: number;
    /** The generation the clock calls for; more than `generation` when the reader lacks a block hash. */
    targetGeneration: number;
    /** The driving blocks used, in order. */
    weatherBlocks: number[];
    /** The first driving block the reader lacked, when it is behind (§4.1). */
    missingBlock?: number;
    /** The environment: terroir, expressed genes and lets (§4.5). */
    env: SeedEnv;
}
/** The bloom's SNO payload (§5.5). A ShardPayload, built by construction to be valid. */
export interface BloomPayload extends ShardPayload {
    v: 2;
    mode: 'solid';
    colors: number[];
}
/** A grown and drawn bloom. */
export interface Bloom {
    /** Clock height minus the effective planted height (0 while not settled). */
    age: number;
    generation: number;
    targetGeneration: number;
    /** True when a driving block's hash was missing, so the bloom is drawn at an earlier generation (§4.1). */
    behind: boolean;
    missingBlock?: number;
    /** Symbols in the string drawn. */
    symbols: number;
    weatherBlocks: number[];
    sno: BloomPayload;
    /** The payload's compact JSON, keys in the §5.5 order. */
    json: string;
    /** SHA-256 of `json`'s UTF-8 bytes, 64 lowercase hex (§5.5). */
    sha256: string;
}
/**
 * The environment of a seed (§4.5): terroir at its scale, every gene's
 * expressed value, then every `let` in order. Built once per seed.
 */
export declare function bloomEnv(dna: Dna, coord: string, scale?: number): SeedEnv;
/**
 * Rewrite a seed's string up to the generation the clock calls for (§4.1,
 * §4.6). Throws SeedoError when the axiom is longer than the symbol cap
 * (§3.6). A missing block hash stops growth at the generation before it, and
 * says so, as §4.1 asks of a reader that is behind.
 */
export declare function growSymbols(dna: Dna, seed: SeedPlanting, clock: number, blockHash: BlockHashSource): GrownSymbols;
/** The geometry of a drawn string: positions in ticks, painted colors, faces. */
export interface BloomGeometry {
    /** x, y, z in ticks, three numbers per vertex. */
    V: number[];
    C: number[];
    F: Array<[number, number, number]>;
}
/** Draw a string with the turtle (§5.2, §5.3, §5.4) at an age in blocks. */
export declare function drawGeometry(dna: Dna, str: readonly BloomSymbol[], age: number, env: SeedEnv, vertexCap: number): BloomGeometry;
/** The SNO payload of drawn geometry (§5.5), keys in the order the payload hash needs. */
export declare function toBloomPayload(name: string, geo: BloomGeometry, unit: number): BloomPayload;
/** Draw a grown string at the clock height: the payload, its JSON and its hash. */
export declare function drawBloom(dna: Dna, grown: GrownSymbols, seed: SeedPlanting, clock: number): Bloom;
/**
 * Grow and draw one seed's bloom at a clock height (the tip minus 6).
 * `seed.planted` is the effective planted height from `effectivePlantedHeight`,
 * or null while it is not settled. Throws SeedoError only when the axiom is
 * longer than the symbol cap.
 */
export declare function growBloom(dna: Dna, seed: SeedPlanting, clock: number, blockHash: BlockHashSource): Bloom;
//# sourceMappingURL=grow.d.ts.map