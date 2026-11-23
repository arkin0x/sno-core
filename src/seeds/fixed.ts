/**
 * The integer primitives of DECK-0008: the sine table's lookups, the integer
 * square root (§5.1), and the weather mixer and words (§4.3).
 *
 * Every value that decides geometry is an integer. JavaScript numbers are
 * exact here because every intermediate value of §5.1 is below 2^53, which is
 * what the reference relies on too.
 */
import { SEED_SIN } from './constants.js'

/** `sin(d)` for whole degrees, times 16384, from the table (§5.1). */
export function isin(d: number): number {
  d = ((d % 360) + 360) % 360
  if (d <= 90) return SEED_SIN[d]
  if (d <= 180) return SEED_SIN[180 - d]
  if (d <= 270) return -SEED_SIN[d - 180]
  return -SEED_SIN[360 - d]
}

/** `cos(d)` for whole degrees, times 16384: `isin(d + 90)`. */
export function icos(d: number): number {
  return isin(d + 90)
}

/** The largest integer whose square is at most `n`; 0 for `n <= 0`. */
export function isqrt(n: number): number {
  if (n <= 0) return 0
  let r = Math.floor(Math.sqrt(n))
  while (r * r > n) r--
  while ((r + 1) * (r + 1) <= n) r++
  return r
}

/** `a / b` rounded toward minus infinity. Not expression division, which truncates (§3.4). */
export const fdiv = (a: number, b: number): number => Math.floor(a / b)

/**
 * lowbias32 (Chris Wellons), the weather mixer of §4.3: unsigned 32 bits in,
 * unsigned 32 bits out. The products use Math.imul, since a plain `*` loses
 * the low bits once a product passes 2^53.
 */
export function lowbias32(x: number): number {
  let a = x | 0
  a ^= a >>> 16; a = Math.imul(a, 0x7feb352d)
  a ^= a >>> 15; a = Math.imul(a, 0x846ca68b | 0)
  a ^= a >>> 16
  return a >>> 0
}

/**
 * The weather word of 64 hex characters (§4.3): a block hash in its displayed
 * order, or a SHA-256 such as the mix hash (§6.3).
 */
export function weatherWord(hex: string): number {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('a weather word folds 64 hex characters')
  let s = 0x811c9dc5 | 0
  for (let i = 0; i < 64; i += 8) s = lowbias32(s ^ parseInt(hex.slice(i, i + 8), 16))
  return s
}

/** `W`, the generation's roll for the whole bloom, 0..99 (§4.3). */
export function generationRoll(word: number): number {
  return lowbias32(word ^ 0x5bd1e995) % 100
}

/** `w`, the roll of the symbol at index `i` of the string being rewritten, 0..99 (§4.3). */
export function symbolRoll(word: number, i: number): number {
  return lowbias32(word ^ Math.imul(i + 1, 0x9E3779B1 | 0)) % 100
}
