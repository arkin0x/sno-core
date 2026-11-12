// Every section of DECK-0008's golden vectors, run against this port.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BASE_CAPS, BLOCKS_PER_GENERATION, CLAMP_MARGIN, CLOCK_DEPTH, MIX_DELAY, MIX_DEPTH_MAX, MIX_DOMAIN, MIX_FLOOR,
  SEED_ONE, SEED_PRICE, SEED_SIN, SEED_STEP, SEED_TICK, SEEDO_LIMITS, TERRAIN_DOMAIN_V2, TERROIR_DOMAIN, type Caps,
  bloomEnv, capsFromTags, capsPrice, effectivePlantedHeight, eventId, expressGene, generationRoll, growBloom, icos, isDecimal,
  isin, isqrt, isSettled, leadingZeroBits, lowbias32, medianTimePast, mixDna, mixHash, mixSchedule, mixWord,
  mixWorkOk, nameTagVerdict, parseDna, readMixedDna, readSeed, SeedoError, seedPrecheck, sha256Hex, symbolRoll, terroir,
  weatherWord, workOk, type Dna, type SeedsEvent,
  bloomOpacity, drawBloom, growSymbols, OPACITY_GENE, STANDARD_GENES,
} from '../seeds.js'
import { highestAtOrBelow } from './clock.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const here = dirname(fileURLToPath(import.meta.url))
const V: any = JSON.parse(readFileSync(join(here, 'fixtures', 'seeds-vectors.json'), 'utf8'))

const blocks: Record<string, string> = V.blocks
const blockHash = (h: number): string | undefined => blocks[String(h)]
const times: Record<string, number> = V.clamp.header_times
const headerTime = (h: number): number | undefined => times[String(h)]
const cases = (xs: any[], label: (x: any) => string): Array<[string, any]> => xs.map((x) => [label(x), x])
const allele = (a: { value: number; dominant: boolean }): string => a.value + (a.dominant ? '!' : '')

describe('constants', () => {
  it('match the vectors', () => {
    const c = V.constants
    expect([c.TICK, c.STEP, c.ONE, c.N, c.CLOCK_DEPTH, c.MIX_DELAY, c.MIX_DEPTH_MAX, c.CLAMP_MARGIN])
      .toEqual([SEED_TICK, SEED_STEP, SEED_ONE, BLOCKS_PER_GENERATION, CLOCK_DEPTH, MIX_DELAY, MIX_DEPTH_MAX, CLAMP_MARGIN])
    expect(c.limits).toEqual(SEEDO_LIMITS)
    expect([c.TERRAIN_DOMAIN_V2, c.TERROIR_DOMAIN, c.MIX_DOMAIN]).toEqual([TERRAIN_DOMAIN_V2, TERROIR_DOMAIN, MIX_DOMAIN])
    expect(c.price).toEqual(SEED_PRICE)
  })
})

describe('blocks', () => {
  it.each(Object.entries(blocks))('%s is 64 lowercase hex with a weather word', (_h, hash) => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Number.isInteger(weatherWord(hash))).toBe(true)
  })
})

describe('primitives', () => {
  const p = V.primitives
  it('the sine table hash', () => expect(sha256Hex(JSON.stringify(SEED_SIN))).toBe(p.sin_table_sha256))
  it.each(Object.entries(p.isin))('isin(%s)', (d, v) => expect(isin(Number(d))).toBe(v))
  it.each(Object.entries(p.icos))('icos(%s)', (d, v) => expect(icos(Number(d))).toBe(v))
  it.each(Object.entries(p.isqrt))('isqrt(%s)', (n, v) => expect(isqrt(Number(n))).toBe(v))
  it.each(Object.entries(p.mix32))('lowbias32(%s)', (n, v) => expect(lowbias32(Number(n))).toBe(v))
  it('the weather word, W and the first eight w of block 970,544', () => {
    const w = weatherWord(p.word.block_hash)
    expect(p.word.block_hash).toBe(blockHash(p.word.block_height))
    expect(w).toBe(p.word.word)
    expect(generationRoll(w)).toBe(p.word.W)
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => symbolRoll(w, i))).toEqual(p.word.w_first_8)
  })
})

describe('terroir', () => {
  it.each(cases(V.terroir, (t: any) => t.what + ' (scale ' + t.scale + ')'))('%s', (_w, t: any) => {
    expect(terroir(t.coord, t.scale)).toEqual({ K: t.K, n0: t.n0, n1: t.n1, n2: t.n2, n3: t.n3, pl: t.pl })
  })
})

describe('expressions', () => {
  const x = V.expressions
  const env = bloomEnv(parseDna(x.dna), x.coord, x.scale)
  it.each(Object.entries(x.values))('let %s', (name, v) => expect(env[name]).toBe(v))
})

describe('rejected', () => {
  it.each(cases(V.rejected, (r: any) => r.why))('%s', (_w, r: any) => {
    let err: unknown = null
    try { parseDna(r.dna) } catch (e) { err = e }
    expect(err).toBeInstanceOf(SeedoError)
    expect((err as Error).message).toBe(r.error_in_reference)
  })
})

describe('accepted', () => {
  it.each(cases(V.accepted, (a: any) => a.why))('%s', (_w, a: any) => {
    const d = parseDna(a.dna)
    expect(d.name).toBe(a.name)
    expect(d.mutate).toBe(a.mutate)
    expect(d.rules.length).toBe(a.rules)
    // the vectors list a genome without an implicit opacity, as they did before opacity existed
    expect(d.genes.filter((g) => !(g.name === 'opacity' && g.implicit)).map((g) => [g.name, allele(g.a), allele(g.b), g.lo, g.hi, expressGene(g)])).toEqual(a.genes)
  })
})

describe('axiom_cap', () => {
  it.each(cases(V.axiom_cap, (c: any) => 'symbol cap ' + c.symbol_cap))('%s', (_w, c: any) => {
    const grow = (): unknown => growBloom(parseDna(c.dna), { coord: V.terroir[5].coord, planted: 970400, caps: { vertices: 2048, symbols: c.symbol_cap, generations: 32 } }, 970400, blockHash)
    if (c.valid) expect(grow).not.toThrow(); else expect(grow).toThrow(SeedoError)
  })
})

describe('unknown_lines', () => {
  it(V.unknown_lines.what, () => {
    const u = V.unknown_lines
    const b = growBloom(parseDna(u.dna), { coord: u.coord, planted: u.planted, caps: u.caps }, u.clock, blockHash)
    expect(b.sha256).toBe(u.sno_sha256)
    const plain = V.growth.cases.find((c: any) => c.dna === 'fiddlehead' && c.what === 'day 30 and 6 blocks')
    expect(b.sha256).toBe(plain.sno_sha256)
  })
})

describe('name_tags', () => {
  it.each(cases(V.name_tags, (t: any) => JSON.stringify(t.value)))('%s', (_w, t: any) => expect(nameTagVerdict(t.value)).toBe(t.verdict))
})

describe('decimal_tag_values', () => {
  it.each(cases(V.decimal_tag_values, (t: any) => JSON.stringify(t.value)))('%s', (_w, t: any) => expect(isDecimal(t.value)).toBe(t.valid))
})

describe('growth', () => {
  const dnas: Record<string, Dna> = Object.fromEntries(Object.entries(V.growth.dnas).map(([k, t]) => [k, parseDna(t as string)]))
  it.each(cases(V.growth.cases, (c: any) => c.dna + ': ' + c.what))('%s', (_w, c: any) => {
    const b = growBloom(dnas[c.dna], { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, c.clock, blockHash)
    expect(b.behind).toBe(false)
    expect(b.age).toBe(c.age)
    expect(b.generation).toBe(c.generation)
    expect(b.symbols).toBe(c.symbols)
    expect(b.sno.vertices.length).toBe(c.vertices)
    expect(b.sno.faces.length).toBe(c.faces)
    expect(b.weatherBlocks).toEqual(c.weather_blocks)
    expect(b.json.length).toBe(c.sno_bytes)
    expect(b.sha256).toBe(c.sno_sha256)
    if (c.sno) expect(b.json).toBe(JSON.stringify(c.sno))
  })
})

describe('clamp', () => {
  it.each(cases(V.clamp.cases, (c: any) => c.what))('%s', (_w, c: any) => {
    const clock = c.settled_from_clock
    expect(isSettled(c.created_at, clock, headerTime)).toBe(true)
    expect(medianTimePast(clock, headerTime)).toBe(c.mtp_at_that_clock)
    const E = highestAtOrBelow(c.created_at - CLAMP_MARGIN, headerTime, clock)
    const F = highestAtOrBelow(c.created_at + CLAMP_MARGIN, headerTime, clock)
    expect(E < 0 ? null : E).toBe(c.E)
    expect(F < 0 ? null : F).toBe(c.F)
    const eff = effectivePlantedHeight(c.stated, c.created_at, clock, headerTime)
    if (c.effective === 'none') expect(eff).toEqual({ state: 'cannot-grow', E: null, F: null })
    else expect(eff).toEqual({ state: 'settled', height: c.effective, E: c.E, F: c.F })
    if (c.not_settled_at_clock !== undefined) {
      expect(isSettled(c.created_at, c.not_settled_at_clock, headerTime)).toBe(false)
      expect(c.effective_one_clock_earlier).toBe(null)
      expect(effectivePlantedHeight(c.stated, c.created_at, c.not_settled_at_clock, headerTime)).toEqual({ state: 'pending' })
    }
  })
})

describe('mixing', () => {
  const M = V.mixing
  // DNAs by event id, as a reader resolves them: the written parents, then each child as it is computed
  const byId = new Map<string, { dna: Dna; outcome: number | null; caps: Caps }>()
  for (const ev of Object.values(M.parents) as any[]) byId.set(ev.id, { dna: parseDna(ev.content), outcome: null, caps: capsFromTags(ev.tags) as Caps })

  it.each(Object.entries(M.parents))('parent %s: its id and its caps', (_n, ev: any) => {
    expect(eventId(ev)).toBe(ev.id)
    expect(capsFromTags(ev.tags)).toEqual({ vertices: 8000, symbols: 6000, generations: 40 })
  })

  it.each(cases(M.mixes, (m: any) => m.what))('%s', (_w, m: any) => {
    const ev = m.event
    expect(eventId(ev)).toBe(ev.id)
    expect(mixWorkOk(ev)).toBe(true)
    const read = readMixedDna(ev)
    if (m.refused === 'invalid name tag') expect(read).toEqual({ ok: false, reason: 'invalid name tag' })
    else expect(read.ok).toBe(true)
    const tag = (k: string, role?: string): string[] => ev.tags.find((t: string[]) => t[0] === k && (role === undefined || t[3] === role))
    const mother = byId.get(tag('e', 'mother')[1])!, father = byId.get(tag('e', 'father')[1])!
    const block = tag('block')
    const commit = {
      anchorHeight: Number(block[1]), anchorHash: block[2], createdAt: ev.created_at,
      parentOutcomeHeights: [mother.outcome, father.outcome].filter((o): o is number => o !== null),
    }
    // settling: pending one clock before, settled from the vector's clock
    expect(mixSchedule(commit, m.settled_from_clock - 1, headerTime, blockHash).state).toBe('pending')
    const sch = mixSchedule(commit, m.settled_from_clock, headerTime, blockHash)
    if (m.refused === 'a mixed parent had not resolved at the commit height') {
      expect(sch).toEqual({ state: 'invalid', reason: m.refused })
      return
    }
    expect(sch.state).toBe('committed')
    if (sch.state !== 'committed') return
    expect(sch.commitHeight).toBe(m.commit_height)
    expect(sch.outcomeHeight).toBe(m.outcome_height)
    expect(blockHash(sch.outcomeHeight)).toBe(m.outcome_hash)
    expect(Math.max(sch.outcomeHeight, m.settled_from_clock)).toBe(m.readable_at_clock)
    const ready = mixSchedule(commit, m.readable_at_clock, headerTime, blockHash)
    expect(ready.state === 'committed' && ready.ready).toBe(true)
    if (m.readable_at_clock > m.settled_from_clock) {
      const early = mixSchedule(commit, m.readable_at_clock - 1, headerTime, blockHash)
      expect(early.state === 'committed' && early.ready).toBe(false)
    }
    expect(mixHash(m.outcome_hash, ev.id)).toBe(m.mix_hash)
    const s0 = mixWord(m.outcome_hash, ev.id)
    expect(s0).toBe(m.mix_word)
    const nameTag = tag('name')
    const r = mixDna(mother.dna, father.dna, s0, { hybrid: !!tag('hybrid'), name: nameTag ? nameTag[1] : undefined })
    if (m.refused) { expect(r.refused).toBe(m.refused); return }
    if (r.refused) throw new Error('refused: ' + r.refused)
    expect(r.draws.map((d) => ({
      name: d.name, word: d.word, alleles_from: d.from, a: allele(d.child.a), b: allele(d.child.b),
      lo: d.child.lo, hi: d.child.hi, expressed: d.expressed, mutated: d.mutated,
    }))).toEqual(m.genes)
    expect(r.text).toBe(m.child_text)
    expect(r.dna.sterile).toBe(m.child_sterile)
    byId.set(ev.id, { dna: r.dna, outcome: sch.outcomeHeight, caps: capsFromTags(ev.tags) as Caps })
  })

  it(M.child_growth.what, () => {
    const g = M.child_growth
    const child = byId.get(M.mixes[0].event.id)!
    const b = growBloom(child.dna, { coord: V.terroir[5].coord, planted: g.planted, caps: g.caps }, g.clock, blockHash)
    expect(b.generation).toBe(g.generation)
    expect(b.sno.vertices.length).toBe(g.vertices)
    expect(b.sha256).toBe(g.sno_sha256)
  })

  describe('seeds', () => {
    const S = V.seeds
    const dnaEvents = new Map<string, any>([...Object.values(M.parents), ...M.mixes.map((m: any) => m.event), S.free_dna].map((e: any) => [e.id, e]))
    it('the free DNA: its id, no caps tag, the free caps', () => {
      expect(eventId(S.free_dna)).toBe(S.free_dna.id)
      expect(capsFromTags(S.free_dna.tags)).toEqual(BASE_CAPS)
      expect(parseDna(S.free_dna.content).name).toBe('crystal')
    })
    it.each(cases(S.cases, (c: any) => c.what))('%s', (_w, c: any) => {
      const ev: SeedsEvent = c.event
      expect(eventId(c.event)).toBe(ev.id)
      expect(leadingZeroBits(ev.id)).toBe(c.leading_zero_bits)
      const caps = capsFromTags(dnaEvents.get(c.dna).tags)
      expect(caps).toEqual(c.dna_caps)
      const price = capsPrice(caps as Caps)
      expect(price).toBe(c.price)
      // §8.2: before the DNA is resolved, the id must meet its own committed target, at least the base price
      const prechecks = c.committed_target >= SEED_PRICE.base && c.leading_zero_bits >= c.committed_target
      expect(seedPrecheck(ev)).toBe(prechecks)
      const read = readSeed(ev)
      expect(read.ok).toBe(prechecks)
      if (read.ok) {
        expect(read.seed.dnaId).toBe(c.dna)
        expect(read.seed.target).toBe(c.committed_target)
      }
      // after it is resolved, the committed target must reach the DNA's price
      expect(workOk(ev, price as number)).toBe(c.grows)
      expect(prechecks && c.committed_target >= (price as number)).toBe(c.grows)
    })
  })
})

describe('price', () => {
  it('the mix floor', () => expect(V.price.mix_floor).toBe(MIX_FLOOR))
  it.each(cases(V.price.rows, (r: any) => JSON.stringify(r.caps)))('%s', (_w, r: any) => expect(capsPrice(r.caps)).toBe(r.bits))
})

describe('opacity, the fourth standard gene (§3.3, §5.4, §5.5, §6.4, §6.6)', () => {
  const O = V.opacity
  it('the standard gene', () => {
    expect(OPACITY_GENE).toEqual(O.standard_gene)
    expect(STANDARD_GENES.map((g) => g.name)).toEqual(['size', 'hue', 'tone', 'opacity'])
  })
  it.each(cases(O.growth, (c: any) => c.what))('%s', (_w, c: any) => {
    const dna = parseDna(c.dna)
    const b = growBloom(dna, { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, c.clock, blockHash)
    expect(b.generation).toBe(c.generation)
    expect(b.sno.vertices.length).toBe(c.vertices)
    expect(b.sno.faces.length).toBe(c.faces)
    expect(b.sno.opacity ?? null).toBe(c.opacity)
    expect(bloomOpacity(dna)).toBe(c.opacity ?? 100)
    expect(b.json.length).toBe(c.sno_bytes)
    expect(b.sha256).toBe(c.sno_sha256)
    const { opacity: _o, ...solid } = b.sno
    expect(sha256Hex(JSON.stringify(solid))).toBe(c.sno_sha256_without_opacity)
    if (c.sno) expect(b.sno).toEqual(c.sno)
    // the buffers carry the opacity exactly when the payload does
    const seed = { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }
    const parts = drawBloom(dna, growSymbols(dna, seed, c.clock, blockHash), seed, c.clock, { payload: false, buffers: true })
    expect(parts.buffers?.opacity ?? null).toBe(c.opacity)
  })
  it.each(cases(O.accepted, (a: any) => a.why))('accepted: %s', (_w, a: any) => {
    const d = parseDna(a.dna)
    expect(d.genes.map((g) => [g.name, allele(g.a), allele(g.b), g.lo, g.hi, expressGene(g)])).toEqual(a.genes)
    const env = bloomEnv(d, coordAOf(), 0)
    expect(env.opacity).toBe(a.opacity)
  })
  it.each(cases(O.rejected, (r: any) => r.why))('rejected: %s', (_w, r: any) => {
    expect(() => parseDna(r.dna)).toThrow(SeedoError)
    expect(() => parseDna(r.dna)).toThrow(r.error_in_reference)
  })
  it('the glass crystal of the growth cases is the glass crystal the mixes use', () => expect(O.growth[0].dna).toBe(O.dnas['glass crystal']))
  it('the mixes cover both parents declaring opacity, a mutated opacity and a sterile hybrid', () => {
    const op = (m: any) => m.genes.find((g: any) => g.name === 'opacity')
    expect(O.mixes.some((m: any) => m.mother === 'glass crystal' && m.father === 'frost crystal' && op(m).mutated === null)).toBe(true)
    expect(O.mixes.some((m: any) => op(m)?.mutated)).toBe(true)
    expect(O.mixes.some((m: any) => m.hybrid && m.child_sterile && m.child_growth.opacity !== null)).toBe(true)
  })
  it.each(cases(O.mixes, (m: any) => m.what))('%s', (_w, m: any) => {
    const dnas: Record<string, Dna> = {
      crystal: parseDna(V.growth.dnas.crystal), coral: parseDna(V.growth.dnas.coral),
      'glass crystal': parseDna(O.dnas['glass crystal']), 'frost crystal': parseDna(O.dnas['frost crystal']),
    }
    const A = dnas[m.mother], B = dnas[m.father]
    const s0 = weatherWord(blockHash(m.word_from_block) as string)
    expect(s0).toBe(m.mix_word)
    const r = mixDna(A, B, s0, { hybrid: !!m.hybrid })
    if (r.refused) throw new Error('refused: ' + r.refused)
    if (m.child_sterile !== undefined) expect(r.dna.sterile).toBe(m.child_sterile)
    expect(r.draws.map((d) => ({
      name: d.name, index: A.genes.findIndex((g) => g.name === d.name), word: d.word, alleles_from: d.from, a: allele(d.child.a), b: allele(d.child.b),
      lo: d.child.lo, hi: d.child.hi, expressed: d.expressed, mutated: d.mutated,
    }))).toEqual(m.genes)
    expect(r.text).toBe(m.child_text)
    const g = growBloom(r.dna, { coord: coordAOf(), planted: m.child_growth.planted, scale: 0, caps: O.growth[0].caps }, m.child_growth.clock, blockHash)
    expect(g.sno.opacity ?? null).toBe(m.child_growth.opacity)
    expect(g.sno.vertices.length).toBe(m.child_growth.vertices)
    expect(g.sha256).toBe(m.child_growth.sno_sha256)
  })
})
function coordAOf(): string { return V.opacity.growth[0].coord }
