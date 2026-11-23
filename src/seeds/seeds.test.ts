// Behaviour the vectors do not reach: where this port follows DECK-0008's text over the
// reference interpreter, what a reader that is behind sees, and the reader-facing helpers.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  bloomEnv, bloomTransferList, capsFromTags, drawBloom, effectivePlantedHeight, GENESIS_TIME, growBloom, growSymbols,
  growthApplies, highestAtOrBelow, mixDna, mixSchedule, parseChildText, parseDna, readMixedDna, readSeed, SeedoError, tryGrowBloom,
  tryParseDna, worstCaseSteps,
} from '../seeds.js'
import { hasLoneSurrogate } from './parse.js'

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
    expect(parseDna('dna x\nangle 8 # a\u2028b\naxiom F').angle).toBe(8)
    expect(parseDna('dna x\nangle 8 # a\u2029b\naxiom F').angle).toBe(8)
    expect(parseDna('dna x # a\u2028b\naxiom F').name).toBe('x')
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
  it('readMixedDna uses the first name tag', () => {
    const two = { ...m.event, tags: [...m.event.tags, ['name', 'first'], ['name', 'kid -> F']] }
    const r = readMixedDna({ ...two, id: m.event.id })
    expect(r.ok && r.mix.name).toBe('first')
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
    expect(readSeed(swap('C', coordA.toUpperCase()))).toEqual({ ok: false, reason: 'C is not 64 lowercase hex' })
    expect(readSeed(swap('C', coordA.slice(2)))).toEqual({ ok: false, reason: 'C is not 64 lowercase hex' })
    expect(readSeed(without('nonce'))).toEqual({ ok: false, reason: 'no nonce tag' })
    expect(readSeed(swap('dna', 'ABC'))).toEqual({ ok: false, reason: 'the dna tag is not 64 hex' })
    expect(readSeed(swap('planted', '0970524'))).toEqual({ ok: false, reason: 'planted is not a decimal' })
    expect(readSeed({ ...good, tags: [...good.tags, ['scale', '85']] })).toEqual({ ok: false, reason: 'scale is not a decimal from 0 to 84' })
  })
})

describe('finding E and F far below the clock, or in a store of recent headers', () => {
  // header times 600 s apart with a deterministic wobble of up to 6 minutes either way, which keeps
  // every header time above the MTP before it, as consensus requires
  const time = (h: number): number => GENESIS_TIME + 600 * h + (((h * 7919) % 13) - 6) * 60
  // the definition: the highest height at or below the clock whose header time is at most t
  const brute = (t: number, clock: number, from = 0): number => { for (let h = clock; h >= from; h--) if (time(h) <= t) return h; return -1 }
  it('an answer near 400,000 with the clock at 975,000', () => {
    const t = time(400000)
    expect(highestAtOrBelow(t, time, 975000)).toBe(brute(t, 975000))
    const created = t + 7200
    const eff = effectivePlantedHeight(400000, created, 975000, time)
    expect(eff.state).toBe('settled')
    if (eff.state === 'settled') expect(eff.E).toBe(brute(created - 7200, 975000))
  })
  it('an answer in the lowest blocks, where only blocks 0 to 10 qualify', () => {
    expect(highestAtOrBelow(time(3), time, 5000)).toBe(brute(time(3), 5000))
    expect(highestAtOrBelow(GENESIS_TIME, time, 5000)).toBe(brute(GENESIS_TIME, 5000))
  })
  it('a store that starts at S: clock S+1100, answer S+40, no header below what the walk needs', () => {
    const S = 900000
    const asked: number[] = []
    const store = (h: number): number | undefined => { asked.push(h); return h >= S ? time(h) : undefined }
    const t = time(S + 40)
    expect(highestAtOrBelow(t, store, S + 1100)).toBe(brute(t, S + 1100, S))
    const eff = effectivePlantedHeight(S + 40, t + 7200, S + 1100, store)
    expect(eff.state).toBe('settled')
  })
})

describe('the phone budget: resume, steps, abort (§12, Compute)', () => {
  const seed = { coord: coordA, planted: 970400, caps: CAPS }
  it('worstCaseSteps is generations times symbols', () => {
    expect(worstCaseSteps(CAPS)).toBe(40 * 6000)
    expect(worstCaseSteps()).toBe(32 * 2048)
  })
  it('growing in small budgets and resuming reaches the same bloom', () => {
    let grown = growSymbols(fiddlehead, seed, day30.clock, blockHash, { maxSteps: 2000 })
    expect(grown.stopped).toBe('budget')
    expect(grown.complete).toBe(false)
    let calls = 1
    while (!grown.complete) { grown = growSymbols(fiddlehead, seed, day30.clock, blockHash, { from: grown, maxSteps: 2000 }); calls++ }
    expect(calls).toBeGreaterThan(2)
    expect(drawBloom(fiddlehead, grown, seed, day30.clock).sha256).toBe(day30.sno_sha256)
    expect(grown.weatherBlocks).toEqual(day30.weather_blocks)
  })
  it('a cached generation resumes to a later clock', () => {
    const day10 = growSymbols(fiddlehead, seed, 970400 + 10 * 144, blockHash)
    const later = growSymbols(fiddlehead, seed, day30.clock, blockHash, { from: day10 })
    const full = growSymbols(fiddlehead, seed, day30.clock, blockHash)
    expect(later.steps).toBeLessThan(full.steps)
    expect(drawBloom(fiddlehead, later, seed, day30.clock).sha256).toBe(day30.sno_sha256)
  })
  it('a cached string for another seed is not resumed from', () => {
    const elsewhere = growSymbols(fiddlehead, { ...seed, coord: V.growth.cases.find((c: any) => c.what.startsWith('another place')).coord }, day30.clock, blockHash)
    const g = growSymbols(fiddlehead, seed, day30.clock, blockHash, { from: elsewhere })
    expect(drawBloom(fiddlehead, g, seed, day30.clock).sha256).toBe(day30.sno_sha256)
  })
  it('an aborted signal stops before the next generation', () => {
    const g = growSymbols(fiddlehead, seed, day30.clock, blockHash, { signal: { aborted: true } })
    expect(g).toMatchObject({ generation: 0, stopped: 'aborted', complete: false, steps: 0 })
    expect(drawBloom(fiddlehead, g, seed, day30.clock).behind).toBe(true)
  })
})

describe('drawing for a worker', () => {
  const seed = { coord: coordA, planted: 970400, caps: CAPS }
  it('json and its hash are optional; buffers carry the same geometry', () => {
    const grown = growSymbols(fiddlehead, seed, day30.clock, blockHash)
    const parts = drawBloom(fiddlehead, grown, seed, day30.clock, { json: false, buffers: true })
    expect(parts.json).toBeUndefined()
    expect(parts.sha256).toBeUndefined()
    const sno = parts.sno!, b = parts.buffers!
    expect(b.positions.length).toBe(sno.vertices.length * 3)
    expect(Array.from(b.colors)).toEqual(sno.colors)
    expect(Array.from(b.faces)).toEqual(sno.faces.flat())
    expect(Array.from(b.positions, (t) => Math.floor(t / 120))).toEqual(sno.vertices.flat())
    expect(bloomTransferList(b)).toHaveLength(3)
    const none = drawBloom(fiddlehead, grown, seed, day30.clock, { payload: false })
    expect(none.sno).toBeUndefined()
    expect(none.generation).toBe(30)
  })
  it('tryGrowBloom takes the text and returns errors', () => {
    const ok = tryGrowBloom(V.growth.dnas.fiddlehead, seed, day30.clock, blockHash)
    expect(ok.ok && ok.bloom.sha256).toBe(day30.sno_sha256)
    expect(tryGrowBloom('dna x', seed, day30.clock, blockHash)).toEqual({ ok: false, error: 'no axiom' })
    expect(tryGrowBloom(fiddlehead, { ...seed, coord: 'zz' }, day30.clock, blockHash).ok).toBe(false)
  })
  it('a cached child text over 8 KB parses with parseChildText', () => {
    const mother = parseDna('dna mom\nnote ' + 'x'.repeat(8100) + '\naxiom F')
    const r = mixDna(mother, mother, 1)
    if (r.refused) throw new Error(r.refused)
    expect(parseChildText(r.text).name).toBe('mom x mom')
  })
})

describe('drawing a cached string at a later clock (the re-review\'s stale scenarios)', () => {
  const seed = { coord: coordA, planted: 970400, caps: CAPS }
  const c1 = 970400 + 10 * 144 + 5, c2 = 970400 + 12 * 144 + 5
  it('a gen-10 string drawn at a clock that calls for gen 12 is behind, and growing it on catches up', () => {
    const cached = growSymbols(fiddlehead, seed, c1, blockHash)
    const stale = drawBloom(fiddlehead, cached, seed, c2)
    const right = growBloom(fiddlehead, seed, c2, blockHash)
    expect(stale).toMatchObject({ generation: 10, targetGeneration: 12, behind: true })
    expect(stale.sha256).not.toBe(right.sha256)
    expect(right).toMatchObject({ generation: 12, targetGeneration: 12, behind: false })
    const caught = drawBloom(fiddlehead, growSymbols(fiddlehead, seed, c2, blockHash, { from: cached }), seed, c2)
    expect(caught.behind).toBe(false)
    expect(caught.sha256).toBe(right.sha256)
  })
  it('a string grown for another seed is refused', () => {
    const other = { ...seed, coord: 'ab'.repeat(32) }
    const foreign = growSymbols(fiddlehead, other, c2, blockHash)
    expect(growthApplies(foreign, fiddlehead, seed, c2)).toBe(false)
    expect(() => drawBloom(fiddlehead, foreign, seed, c2)).toThrow('grown for another DNA or seed')
    for (const changed of [{ ...seed, planted: 970401 }, { ...seed, scale: 1 }, { ...seed, caps: { ...CAPS, symbols: 5000 } }]) {
      expect(() => drawBloom(fiddlehead, growSymbols(fiddlehead, changed, c2, blockHash), seed, c2)).toThrow()
    }
  })
  it('a string past the clock\'s generation is refused', () => {
    const ahead = growSymbols(fiddlehead, seed, c2, blockHash)
    expect(growthApplies(ahead, fiddlehead, seed, c1)).toBe(false)
    expect(() => drawBloom(fiddlehead, ahead, seed, c1)).toThrow('past the 10 this clock calls for')
  })
  it('tryGrowBloom grows a mixed child over 8,192 bytes from { text, computed }', () => {
    const mom = parseDna('dna mom\nnote ' + 'x'.repeat(8100) + '\naxiom F')
    const child = mixDna(mom, mom, 1)
    if (child.refused) throw new Error(child.refused)
    expect(new TextEncoder().encode(child.text).length).toBeGreaterThan(8192)
    expect(tryGrowBloom(child.text, seed, c2, blockHash)).toEqual({ ok: false, error: 'the text is longer than 8192 bytes' })
    const r = tryGrowBloom({ text: child.text, computed: true }, seed, c2, blockHash)
    expect(r.ok && r.bloom.sno.name).toBe('mom x mom')
  })
})

describe('unpaired surrogates, without a lookbehind', () => {
  it('finds lone high and low surrogates and passes pairs', () => {
    expect(hasLoneSurrogate('a\ud83d\ude00b')).toBe(false)
    expect(hasLoneSurrogate('\ud83d')).toBe(true)
    expect(hasLoneSurrogate('x\ude00')).toBe(true)
    expect(hasLoneSurrogate('\ud83d\ud83d\ude00')).toBe(true)
    expect(hasLoneSurrogate('\ude00\ud83d')).toBe(true)
    expect(hasLoneSurrogate('é')).toBe(false)
  })
  it('the module has no lookbehind (Safari before 16.4 cannot compile one)', () => {
    for (const f of readdirSync(here).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      expect(readFileSync(join(here, f), 'utf8'), f).not.toMatch(/\(\?<[=!]/)
    }
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
