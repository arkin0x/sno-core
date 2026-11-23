/**
 * Seeds (DECK-0008): programs that grow in cyberspace. A DNA is a SEEDO text;
 * a seed plants it at a coordinate, a block height and a scale; its bloom is a
 * SNO payload every reader computes from the DNA, the seed and the Bitcoin
 * blocks mined since. This is the one implementation the clients share, a port
 * of the DECK's reference interpreter, `decks/seeds-reference.mjs`, checked
 * against every section of its vectors.
 *
 * No DOM and no network: block hashes and header times come from the caller.
 * It runs in a Web Worker, where a client SHOULD grow blooms (§12, Compute):
 * post the DNA's text, not a parsed Dna, and parse it in the worker.
 */
export * from './seeds/constants.js'
export { sha256Hex } from './seeds/hash.js'
export { isin, icos, isqrt, lowbias32, weatherWord, generationRoll, symbolRoll } from './seeds/fixed.js'
export { coordHexToXyz, xyzToCoordHex, terroir, type SeedXyz, type Terroir } from './seeds/terroir.js'
export { compileExpr, SeedoError, type SeedEnv, type SeedExpr, type SeedScope } from './seeds/expr.js'
export { parseDna, parseChildText, tryParseDna, expressGene, type Allele, type Dna, type Gene, type Let, type ParseDnaOptions, type Rule, type SymbolTemplate } from './seeds/parse.js'
export * from './seeds/clock.js'
export * from './seeds/grow.js'
export * from './seeds/mix.js'
export * from './seeds/price.js'
