// Behaviour the vectors do not reach: where this port follows DECK-0008's text over the
// reference interpreter, what a reader that is behind sees, and the reader-facing helpers.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  bloomEnv, capsFromTags, drawBloom, effectivePlantedHeight, growBloom, growSymbols, mixDna, mixSchedule,
  parseDna, readMixedDna, readSeed, SeedoError, tryParseDna,
} from '../seeds.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const here = dirname(fileURLToPath(import.meta.url))
const V: any = JSON.parse(readFileSync(join(here, 'fixtures', 'seeds-vectors.json'), 'utf8'))
const blockHash = (h: number): string | undefined => V.blocks[String(h)]
const headerTime = (h: number): number | undefined => V.clamp.header_times[String(h)]
const coordA = '3a7f1c9e5b2d4806f1e3c5a79b0d2f4618e3a5c7b9d1f3e5a7c9b1d3f5e7a9c1'
const CAPS = { vertices: 8000, symbols: 6000, generations: 40 }
const fiddlehead = parseDna(V.growth.dnas.fiddlehead)
const day30 = V.growth.cases.find((c: any) => c.dna === 'fiddlehead' && c.what === 'day 30 and 6 blocks')

describe('comments (§3.1): everything from the first # is removed, whatever it holds', () => {
  it('a comment on a CRLF line', () => {
    // the reference's /#.*$/ stops at the CR, removes nothing, and refuses "angle 8 # hi"
    expect(parseDna('dna x\r\nangle 8 # hi\r\naxiom F\r\n').angle).toBe(8)
  })
  it('a CR or a line separator inside a comment', () => {
    expect(parseDna('dna x\nangle 8 # a\rb\naxiom F').angle).toBe(8)
    expect(parseDna('dna x\nangle 8 # a b\naxiom F').angle).toBe(8)
    expect(parseDna('dna x # a b\naxiom F').name).toBe('x')
  })
  it('a control character outside the comment is still refused', () => {
    expect(tryParseDna('dna x\nangle\v8\naxiom F')).toEqual({ ok: false, error: 'line 2: a control character' })
    expect(tryParseDna('dna x\nangle 8\u0001\naxiom F')).toEqual({ ok: false, error: 'line 2: a control character' })
  })
})

describe('a mixed child text is not bounded by 8,192 bytes (§3.1)', () => {
  const mother = parseDna('dna mom\nnote ' + 'x'.repeat(8100) + '\naxiom F')
  it('the child parses though its text is longer', () => {
    const r = mixDna(mother, mother, 12345)
    if (r.refused) throw new Error(r.refused)
    expect(new TextEncoder().encode(r.text).length).toBeGreaterThan(8192)
    expect(r.dna.name).toBe('mom x mom')
  })
  it('the same text as a written DNA is refused', () => {
    const r = mixDna(mother, mother, 12345)
    if (r.refused) throw new Error(r.refused)
    expect(() => parseDna(r.text)).toThrow(new SeedoError('the text is longer than 8192 bytes'))
  })
})

describe('every name is an ordinary name', () => {
  it('a gene named __proto__ reads as its value', () => {
    // the reference's plain-object environment gives "[object Object]1" here and null vertices
    const d = parseDna('dna x\ngene __proto__ 3 3 in 1..6\nlet a = __proto__ + 1\naxiom F(a)')
    expect(bloomEnv(d, coordA, 0).a).toBe(4)
    const b = growBloom(d, { coord: coordA, planted: 970400 }, 970400, blockHash)
    expect(b.json).not.toContain('null')
  })
})

describe('a reader that is behind (§4.1)', () => {
  it('draws the latest generation it can compute and says so', () => {
    const missing = 970400 + 12 * 144
    const partial = (h: number): string | undefined => h === missing ? undefined : blockHash(h)
    const b = growBloom(fiddlehead, { coord: coordA, planted: 970400, caps: CAPS }, day30.clock, partial)
    expect(b.behind).toBe(true)
    expect(b.missingBlock).toBe(missing)
    expect(b.generation).toBe(11)
    expect(b.targetGeneration).toBe(30)
    expect(b.weatherBlocks.length).toBe(11)
  })
  it('a seed whose planted height is not settled is drawn at generation 0', () => {
    const day0 = V.growth.cases.find((c: any) => c.dna === 'fiddlehead' && c.what.startsWith('day 0'))
    const b = growBloom(fiddlehead, { coord: coordA, planted: null, caps: CAPS }, day30.clock, blockHash)
    expect(b.generation).toBe(0)
    expect(b.sha256).toBe(day0.sno_sha256)
  })
  it('a missing header leaves the planted height pending, never stepped over (§4.2)', () => {
    const c = V.clamp.cases[0]
    const gap = (h: number): number | undefined => h === c.settled_from_clock - 3 ? undefined : headerTime(h)
    expect(effectivePlantedHeight(c.stated, c.created_at, c.settled_from_clock, gap)).toEqual({ state: 'pending', missingHeader: c.settled_from_clock - 3 })
  })
})

describe('caching the string, redrawing per block (§12, Compute)', () => {
  it('one grown string draws every block of its generation', () => {
    const seed = { coord: coordA, planted: 970400, caps: CAPS }
    const grown = growSymbols(fiddlehead, seed, 970400 + 10 * 144, blockHash)
    for (const clock of [970400 + 10 * 144, 970400 + 10 * 144 + 71, 970400 + 11 * 144 - 1]) {
      expect(drawBloom(fiddlehead, grown, seed, clock).sha256).toBe(growBloom(fiddlehead, seed, clock, blockHash).sha256)
    }
  })
})

describe('mixSchedule', () => {
  const m = V.mixing.mixes[0]
  const block = m.event.tags.find((t: string[]) => t[0] === 'block')
  const commit = { anchorHeight: Number(block[1]), anchorHash: block[2], createdAt: m.event.created_at }
  it('an anchor above the clock is pending, not invalid', () => {
    expect(mixSchedule(commit, commit.anchorHeight - 1, headerTime, blockHash).state).toBe('pending')
  })
  it('an anchor hash that is not the reader\'s block is invalid', () => {
    const wrong = { ...commit, anchorHash: blockHash(commit.anchorHeight + 1) as string }
    expect(mixSchedule(wrong, m.readable_at_clock, headerTime, blockHash)).toEqual({ state: 'invalid', reason: 'the anchor is not on this chain' })
  })
  it('a mix more than 8 deep is invalid (§6.7)', () => {
    expect(mixSchedule({ ...commit, parentDepths: [7, 0] }, m.readable_at_clock, headerTime, blockHash).state).toBe('committed')
    expect(mixSchedule({ ...commit, parentDepths: [8, 0] }, m.readable_at_clock, headerTime, blockHash)).toEqual({ state: 'invalid', reason: 'more than 8 mixes from written DNA' })
  })
  it('readMixedDna refuses a written DNA and a malformed block tag', () => {
    expect(readMixedDna(V.mixing.parents.fiddlehead)).toEqual({ ok: false, reason: 'a written DNA, not a mixed one' })
    const bad = { ...m.event, tags: m.event.tags.map((t: string[]) => t[0] === 'block' ? ['block', '0970500', t[2]] : t) }
    expect(readMixedDna(bad).ok).toBe(false)
  })
  it('a mixed parent whose commit has not settled keeps the child pending', () => {
    expect(mixSchedule({ ...commit, parentOutcomeHeights: [null] }, m.readable_at_clock, headerTime, blockHash).state).toBe('pending')
  })
})

describe('tags', () => {
  it('caps: §10 decimals within range, at most one tag', () => {
    expect(capsFromTags([['caps', '4096', '4096', '64']])).toEqual({ vertices: 4096, symbols: 4096, generations: 64 })
    expect(capsFromTags([['caps', '04096', '4096', '64']])).toBe(null)
    expect(capsFromTags([['caps', '65537', '4096', '64']])).toBe(null)
    expect(capsFromTags([['caps', '1', '1', '1'], ['caps', '1', '1', '1']])).toBe(null)
    expect(capsFromTags([['caps', '1', '1']])).toBe(null)
  })
  it('readSeed skips a seed it cannot read (§8.2)', () => {
    const good = V.seeds.cases[0].event
    const without = (k: string): any => ({ ...good, tags: good.tags.filter((t: string[]) => t[0] !== k) })
    const swap = (k: string, v: string): any => ({ ...good, tags: good.tags.map((t: string[]) => t[0] === k ? [k, v] : t) })
    expect(readSeed(good).ok).toBe(true)
    expect(readSeed(without('C'))).toEqual({ ok: false, reason: 'no C tag' })
    expect(readSeed(without('nonce'))).toEqual({ ok: false, reason: 'no nonce tag' })
    expect(readSeed(swap('dna', 'ABC'))).toEqual({ ok: false, reason: 'the dna tag is not 64 hex' })
    expect(readSeed(swap('planted', '0970524'))).toEqual({ ok: false, reason: 'planted is not a decimal' })
    expect(readSeed({ ...good, tags: [...good.tags, ['scale', '85']] })).toEqual({ ok: false, reason: 'scale is not a decimal from 0 to 84' })
  })
})

describe('runs anywhere', () => {
  it('the module names no DOM or Node API', () => {
    const files = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of [...files.map((x) => join(here, x)), join(here, '..', 'seeds.ts')]) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/\b(window|document|self|globalThis|Buffer|process|require)\b|from 'node:|crypto\.subtle/)
    }
  })
})
