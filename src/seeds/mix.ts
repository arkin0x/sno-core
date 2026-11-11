/**
 * Mixing two DNAs (§6): the mix hash and word, the gene draw with dominance
 * and mutation, sterility and species, the child's exact text, and when a
 * committed mix resolves.
 */
import { CLAMP_MARGIN, MIX_DELAY, MIX_DEPTH_MAX, MIX_DOMAIN, OPACITY_GENE, STANDARD_GENES, type Caps } from './constants.js'
import { effectivePlantedHeight, type HeaderTimeSource } from './clock.js'
import { trimWS } from './expr.js'
import { lowbias32, weatherWord } from './fixed.js'
import { concatBytes, hexBytes, sha256Hex, utf8Bytes } from './hash.js'
import { cutCodePoints, expressGene, hasLoneSurrogate, lineKeyword, parseDna, stripComment, type Allele, type Dna, type Gene } from './parse.js'
import type { BlockHashSource } from './grow.js'
import { capsFromTags, isDecimal, mixWorkOk, type SeedsEvent } from './price.js'

/** `SHA256("CYBERSPACE_SEED_MIX_V1" || outcome block hash || commit id)`, 64 hex (§6.3). */
export function mixHash(outcomeBlockHash: string, commitId: string): string {
  return sha256Hex(concatBytes(utf8Bytes(MIX_DOMAIN), hexBytes(outcomeBlockHash), hexBytes(commitId)))
}

/** `s0`, the weather word of the mix hash (§6.3). */
export function mixWord(outcomeBlockHash: string, commitId: string): number {
  return weatherWord(mixHash(outcomeBlockHash, commitId))
}

/**
 * A mixed DNA's `name` tag under §6.6: `default` when absent or empty (the
 * child is named "mother x father"), `valid`, or `invalid` (the mixed DNA is
 * invalid).
 */
export function nameTagVerdict(v: string | undefined): 'default' | 'valid' | 'invalid' {
  if (v === undefined || v === '') return 'default'
  if (hasLoneSurrogate(v)) return 'invalid'
  if ([...v].length > 64 || /[\x00-\x1f\x7f-\x9f#]/.test(v) || v.includes('->') || /^[ ]|[ ]$/.test(v)) return 'invalid'
  return 'valid'
}

const alleleText = (a: Allele): string => a.value + (a.dominant ? '!' : '')

/** A child's gene line (§6.6 step 4): `gene <name> <allele> <allele> in <lo>..<hi>`, single spaces. */
export function geneLine(g: Pick<Gene, 'name' | 'a' | 'b' | 'lo' | 'hi'>): string {
  return 'gene ' + g.name + ' ' + alleleText(g.a) + ' ' + alleleText(g.b) + ' in ' + g.lo + '..' + g.hi
}

/** How one gene of the child was drawn (§6.4). */
export interface GeneDraw {
  name: string
  /** The 32-bit word that drew it. */
  word: number
  /** Where each allele came from: `A1`, `A2`, `B1`, `B2`. */
  from: [string, string]
  child: Gene
  expressed: number
  /** The allele (1 or 2) that mutated, when it moved. */
  mutated: { allele: 1 | 2; from: number; to: number } | null
}

export type MixRefusal = 'sterile' | 'different SEEDO revisions' | 'different species' | 'invalid name tag'

export type MixResult =
  | { refused: MixRefusal }
  | {
      refused?: undefined
      /** The child's text, computed line by line from the mother's (§6.6). */
      text: string
      /** The child, parsed. */
      dna: Dna
      draws: GeneDraw[]
      /** The parents are of one species; otherwise the child is a sterile hybrid. */
      sameSpecies: boolean
    }

export interface MixOptions {
  /** The mixed DNA's `name` tag value, if it has one. */
  name?: string
  /** The mixed DNA carries a `hybrid` tag (§6.5). */
  hybrid?: boolean
}

/**
 * Mix a mother and a father with the mix word `s0` (§6.4 to §6.6). A preview
 * may pass any 32-bit word (§6.8). Lineage checks that need events (depth,
 * parents resolved, the anchor) are `mixSchedule`'s and the caller's.
 */
export function mixDna(mother: Dna, father: Dna, s0: number, options: MixOptions = {}): MixResult {
  const A = mother, B = father
  if (A.sterile || B.sterile) return { refused: 'sterile' }
  if (A.revision !== B.revision) return { refused: 'different SEEDO revisions' }
  const same = A.speciesKey === B.speciesKey
  if (!same && !options.hybrid) return { refused: 'different species' }
  const rate = Math.floor((A.mutate + B.mutate) / 2)
  const draws: GeneDraw[] = []
  const genes: Gene[] = []
  A.genes.forEach((ga, i) => {
    const gb = B.genes.find((x) => x.name === ga.name)
    // §6.4: an opacity that neither parent declares is skipped, and the child's is implicit
    if (ga.name === OPACITY_GENE.name && ga.implicit && gb?.implicit) return
    const s = lowbias32(s0 ^ Math.imul(i + 1, 0x9E3779B1 | 0))
    const ia = s & 1, ib = (s >>> 1) & 1
    const a = { ...(ia ? ga.b : ga.a) }
    const b = gb ? { ...(ib ? gb.b : gb.a) } : { ...(ia ? ga.a : ga.b) }
    const lo = gb ? Math.min(ga.lo, gb.lo) : ga.lo
    const hi = gb ? Math.max(ga.hi, gb.hi) : ga.hi
    let mutated: GeneDraw['mutated'] = null
    if (((s >>> 8) % 100) < rate) {
      const which = (s >>> 2) & 1, span = hi - lo
      const step = 1 + ((s >>> 16) % Math.max(1, Math.ceil(span / 6)))
      const sign = (s >>> 4) & 1 ? 1 : -1
      const tgt = which ? b : a, before = tgt.value
      tgt.value = Math.max(lo, Math.min(hi, tgt.value + sign * step))
      if (tgt.value !== before) mutated = { allele: (which + 1) as 1 | 2, from: before, to: tgt.value }
    }
    const child: Gene = { name: ga.name, a, b, lo, hi, standard: ga.standard, implicit: false }
    genes.push(child)
    draws.push({ name: ga.name, word: s, from: ['A' + (ia + 1), gb ? 'B' + (ib + 1) : 'A' + (2 - ia)], child, expressed: expressGene(child), mutated })
  })
  const verdict = nameTagVerdict(options.name)
  if (verdict === 'invalid') return { refused: 'invalid name tag' }
  const childName = verdict === 'default' ? cutCodePoints(A.name + ' x ' + B.name, 64) : options.name as string
  const byName = new Map(genes.map((g) => [g.name, g]))
  const head = ['dna ' + childName]
  if (!same) head.push('sterile')
  for (const s of STANDARD_GENES) {
    if (s === OPACITY_GENE) continue
    if (!A.genes.find((g) => g.name === s.name && !g.implicit)) head.push(geneLine(byName.get(s.name) as Gene))
  }
  // §6.6: a father's declared opacity reaches the head when the mother has no opacity line of her own
  const childOpacity = byName.get(OPACITY_GENE.name)
  if (childOpacity && A.genes.find((g) => g.name === OPACITY_GENE.name)?.implicit) head.push(geneLine(childOpacity))
  const out: string[] = []
  let wroteHead = false
  for (const raw of A.text.split('\n')) {
    const t = trimWS(stripComment(raw))
    const isRule = t.includes('->')
    const kw = lineKeyword(t)
    if (!isRule && (kw === 'dna' || kw === 'seed')) { out.push(...head); wroteHead = true; continue }
    if (!isRule && (kw === 'sterile' || kw === 'planted' || kw === 'scale')) continue
    if (!isRule && kw === 'gene') { out.push(geneLine(byName.get(t.split(/[\t\n\v\f\r ]+/)[1]) as Gene)); continue }
    out.push(raw)
  }
  if (!wroteHead) out.unshift(...head)
  const text = out.join('\n')
  return { text, dna: parseDna(text, { computed: true }), draws, sameSpecies: same }
}

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
export type MixSchedule =
  | { state: 'pending'; reason: string }
  | { state: 'invalid'; reason: string }
  | { state: 'committed'; commitHeight: number; outcomeHeight: number; ready: boolean }

export interface MixCommit {
  /** The `block` tag's height. */
  anchorHeight: number
  /** The `block` tag's hash: it MUST be the reader's block at that height (§6.2). */
  anchorHash: string
  /** The mixed DNA's `created_at`. */
  createdAt: number
  /**
   * The outcome heights of the mixed parents (a written parent has none).
   * Null for a mixed parent whose own commit height is not settled yet.
   */
  parentOutcomeHeights?: Array<number | null>
  /** The depths of both parents: 0 for a written DNA (§6.7). */
  parentDepths?: number[]
}

export function mixSchedule(commit: MixCommit, clock: number, time: HeaderTimeSource, blockHash: BlockHashSource): MixSchedule {
  const depth = 1 + Math.max(0, ...(commit.parentDepths ?? []))
  if (depth > MIX_DEPTH_MAX) return { state: 'invalid', reason: 'more than ' + MIX_DEPTH_MAX + ' mixes from written DNA' }
  if (commit.anchorHeight > clock) return { state: 'pending', reason: 'the anchor is above the clock height' }
  // §6.2: once the anchor is at most the clock height, its hash MUST be the reader's block there
  const anchor = blockHash(commit.anchorHeight)
  if (!anchor) return { state: 'pending', reason: 'the anchor block is missing' }
  if (anchor.toLowerCase() !== commit.anchorHash.toLowerCase()) return { state: 'invalid', reason: 'the anchor is not on this chain' }
  const eff = effectivePlantedHeight(commit.anchorHeight, commit.createdAt, clock, time)
  if (eff.state === 'pending') return { state: 'pending', reason: 'the commit height is not settled' }
  if (eff.state === 'cannot-grow') return { state: 'invalid', reason: 'no block has a header time within ' + CLAMP_MARGIN + ' seconds after created_at' }
  const parents = commit.parentOutcomeHeights ?? []
  if (parents.some((o) => o === null)) return { state: 'pending', reason: 'a mixed parent has not settled' }
  if (parents.some((o) => eff.height < (o as number))) return { state: 'invalid', reason: 'a mixed parent had not resolved at the commit height' }
  const outcomeHeight = eff.height + MIX_DELAY
  return { state: 'committed', commitHeight: eff.height, outcomeHeight, ready: outcomeHeight <= clock }
}

/** A mixed DNA's tags, read (§8.1). */
export interface MixedDnaTags {
  motherId: string
  fatherId: string
  anchorHeight: number
  anchorHash: string
  /** The `name` tag's value when it is not empty. */
  name?: string
  hybrid: boolean
  caps: Caps
}

/**
 * Read a `kind 3350` with empty content, a mixed DNA (§8.1): exactly one
 * `nonce` with work at the mix floor, one `mother` and one `father`, one
 * `block` whose height is a §10 decimal and whose hash is 64 lowercase hex,
 * a valid `name` tag if any, and valid caps. Any failure makes it invalid,
 * and every child whose ancestry includes it. The signature is the caller's.
 */
export function readMixedDna(ev: SeedsEvent): { ok: true; mix: MixedDnaTags } | { ok: false; reason: string } {
  if (ev.content !== undefined && ev.content !== '') return { ok: false, reason: 'a written DNA, not a mixed one' }
  const all = (k: string, role?: string): string[][] => ev.tags.filter((t) => t[0] === k && (role === undefined || t[3] === role))
  const nonce = all('nonce'), mother = all('e', 'mother'), father = all('e', 'father'), block = all('block'), name = all('name')
  if (nonce.length !== 1 || !mixWorkOk(ev)) return { ok: false, reason: 'the work is not exactly one nonce at the mix floor' }
  if (mother.length !== 1 || !/^[0-9a-f]{64}$/.test(mother[0][1] ?? '')) return { ok: false, reason: 'not exactly one mother' }
  if (father.length !== 1 || !/^[0-9a-f]{64}$/.test(father[0][1] ?? '')) return { ok: false, reason: 'not exactly one father' }
  if (block.length !== 1 || !isDecimal(block[0][1]) || !/^[0-9a-f]{64}$/.test(block[0][2] ?? '')) return { ok: false, reason: 'not exactly one well-formed block tag' }
  // the first name tag counts, as a reader uses the first of any tag that should appear once (§8.2)
  const nameValue = name.length ? name[0][1] : undefined
  const verdict = nameTagVerdict(nameValue)
  if (verdict === 'invalid') return { ok: false, reason: 'invalid name tag' }
  const caps = capsFromTags(ev.tags)
  if (!caps) return { ok: false, reason: 'invalid caps' }
  const mix: MixedDnaTags = {
    motherId: mother[0][1], fatherId: father[0][1], anchorHeight: Number(block[0][1]), anchorHash: block[0][2],
    hybrid: ev.tags.some((t) => t[0] === 'hybrid'), caps,
  }
  if (verdict === 'valid') mix.name = nameValue
  return { ok: true, mix }
}
