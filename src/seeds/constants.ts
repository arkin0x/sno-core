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
export const SEED_TICK = 120
/** One SEEDO length step: a tenth of a unit, in ticks (§5.1). */
export const SEED_STEP = 12
/** Fixed-point 1.0 for turtle directions (§5.1). */
export const SEED_ONE = 16384
/** Blocks per generation, `N` (§4.1). */
export const BLOCKS_PER_GENERATION = 144
/** The clock reads the block this far below the tip (§4.1). */
export const CLOCK_DEPTH = 6
/** A mix's outcome block is its commit height plus this (§6.2). */
export const MIX_DELAY = 36
/** A mixed DNA is at most this many mixes from written DNA (§6.7). */
export const MIX_DEPTH_MAX = 8
/** Seconds: the planted-height clamp's margin (§4.2). */
export const CLAMP_MARGIN = 7200
/** Block 0's header time; every later header time is greater (§4.2). */
export const GENESIS_TIME = 1231006505
/** The SEEDO revision this reader knows (§3.2). */
export const SEEDO_REVISION = 1

/** The known keywords of a SEEDO line (§3.1). Any other first word is an unknown line. */
export const SEEDO_KEYWORDS: readonly string[] = ['dna', 'seed', 'species', 'sterile', 'mutate', 'angle', 'width', 'color', 'planted', 'scale', 'gene', 'let', 'axiom', 'seedo']

/** The language's fixed limits (§3.8). */
export const SEEDO_LIMITS = {
  rules: 40,
  params: 4,
  value: 1000000,
  stack: 64,
  region: 64,
  textBytes: 8192,
  exprNodes: 64,
  exprDepth: 16,
  successor: 64,
  headNodes: 256,
  dnaNodes: 1024,
} as const

export const TERRAIN_DOMAIN_V2 = 'CYBERSPACE_TERRAIN_K_V2'
export const TERROIR_DOMAIN = 'CYBERSPACE_SEED_TERROIR_V1'
export const MIX_DOMAIN = 'CYBERSPACE_SEED_MIX_V1'
/** The cell widths, in bits above the seed's scale, of the four terroir nibbles, finest first (§4.4). */
export const TERRAIN_CELL_BITS: readonly number[] = [3, 7, 9, 11]

/** The three caps a DNA declares (§7). */
export interface Caps {
  vertices: number
  symbols: number
  generations: number
}

/** The NIP-13 work a mixed DNA carries, in bits (§7). Provisional. */
export const MIX_FLOOR = 20
/** The price table of §7. Provisional numbers. */
export const SEED_PRICE = {
  base: 16,
  caps: {
    vertices: { free: 2048, max: 65536 },
    symbols: { free: 2048, max: 16384 },
    generations: { free: 32, max: 256 },
  },
} as const
/** The caps of a DNA without a `caps` tag, the free caps (§7). */
export const BASE_CAPS: Readonly<Caps> = { vertices: 2048, symbols: 2048, generations: 32 }

/** `sin(d) * 16384` for whole degrees 0..90, rounded. Part of the language, never computed (§5.1). */
export const SEED_SIN: readonly number[] = [0, 286, 572, 857, 1143, 1428, 1713, 1997, 2280, 2563, 2845, 3126, 3406, 3686, 3964, 4240, 4516, 4790, 5063, 5334, 5604, 5872, 6138, 6402, 6664, 6924, 7182, 7438, 7692, 7943, 8192, 8438, 8682, 8923, 9162, 9397, 9630, 9860, 10087, 10311, 10531, 10749, 10963, 11174, 11381, 11585, 11786, 11982, 12176, 12365, 12551, 12733, 12911, 13085, 13255, 13421, 13583, 13741, 13894, 14044, 14189, 14330, 14466, 14598, 14726, 14849, 14968, 15082, 15191, 15296, 15396, 15491, 15582, 15668, 15749, 15826, 15897, 15964, 16026, 16083, 16135, 16182, 16225, 16262, 16294, 16322, 16344, 16362, 16374, 16382, 16384]

/** The built-in names of an expression (§3.4). */
export const SEEDO_BUILTINS: readonly string[] = ['w', 'W', 'g', 'K', 'n0', 'n1', 'n2', 'n3', 'pl']
/** The words that are never names (§3.4). */
export const SEEDO_RESERVED: readonly string[] = ['and', 'or', 'not', 'if', 'chance', 'in']

/** A standard gene: its default value and range, and the bounds a declared range is narrowed to (§3.3). */
export interface StandardGene {
  name: 'size' | 'hue' | 'tone' | 'opacity'
  def: number
  lo: number
  hi: number
  min: number
  max: number
}
/**
 * The fourth standard gene (§3.3): how solid the whole bloom is drawn, in
 * percent, carried as the payload's `opacity` below 100 (§5.4, §5.5). It is
 * last in the genome, after the DNA's own genes, so adding it moved no other
 * gene's index in a mix (§6.4). Its default range, 100..100, keeps every DNA
 * that never mentions it fully solid, and every mix of two such DNAs too.
 */
export const OPACITY_GENE: StandardGene = { name: 'opacity', def: 100, lo: 100, hi: 100, min: 10, max: 100 }

/**
 * The standard genes (§3.3). Every DNA has all four. The genome holds the
 * first three first, then the DNA's own genes, then `opacity`.
 */
export const STANDARD_GENES: readonly StandardGene[] = [
  { name: 'size', def: 100, lo: 50, hi: 200, min: 10, max: 400 },
  { name: 'hue', def: 0, lo: 0, hi: 23, min: 0, max: 23 },
  { name: 'tone', def: 0, lo: -4, hi: 4, min: -7, max: 7 },
  OPACITY_GENE,
]
