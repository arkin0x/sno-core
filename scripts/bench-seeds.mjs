// Growth timings for Seeds (DECK-0008), on the built dist/: the six example DNAs at
// day 30 and 6 blocks, and a DNA built to be slow within the limits of §3.8 at the free,
// prototype and largest caps. When a cyberspace spec checkout is present
// (CYBERSPACE_SPEC_DIR, or ../cyberspace), the reference interpreter is timed beside it.
//
//   npm run build:dist && node scripts/bench-seeds.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import * as S from '../dist/seeds.js'

const here = dirname(fileURLToPath(import.meta.url))
const V = JSON.parse(readFileSync(join(here, '..', 'src', 'seeds', 'fixtures', 'seeds-vectors.json'), 'utf8'))
const specDir = process.env.CYBERSPACE_SPEC_DIR ?? resolve(here, '..', '..', 'cyberspace')
const refPath = join(specDir, 'decks', 'seeds-reference.mjs')
const R = existsSync(refPath) ? await import(pathToFileURL(refPath).href) : null

const coordA = '3a7f1c9e5b2d4806f1e3c5a79b0d2f4618e3a5c7b9d1f3e5a7c9b1d3f5e7a9c1'
const P0 = 970400
const PROTO = { vertices: 8000, symbols: 6000, generations: 40 }
const LARGEST = { vertices: 65536, symbols: 16384, generations: 256 }
const realHash = (h) => V.blocks[String(h)]
// weather does not change the work of the slow DNA, so any hash will do past the vectors' blocks
const fakeHash = (h) => S.sha256Hex('bench block ' + h)

// A balanced, fully parenthesized tree over `leaves` joined by `op`: 2L - 1 nodes, depth about 2 log2(L).
function tree(leaves, op) {
  if (leaves.length === 1) return leaves[0]
  const m = leaves.length >> 1
  return '(' + tree(leaves.slice(0, m), op) + ' ' + op + ' ' + tree(leaves.slice(m), op) + ')'
}
const names = ['a', 'b', 'c', 'd', 'w', 'W', 'g', 'K', 'n0', 'n1', 'n2', 'n3', 'pl']
const leaves = (n, first) => Array.from({ length: n }, (_, i) => (i === 0 && first !== undefined) ? first : names[i % names.length])
// condition: 64 nodes, always true (not of a product with a literal 0 in it; * never short-circuits)
const cond = 'not ' + tree(leaves(32, '0'), '*')
// chance: 64 nodes, always 0, so `w < chance` never holds
const chance = '-' + tree(leaves(32, '0'), '*')
// argument: 63 nodes
const arg = tree(leaves(32), '+')
/**
 * The slow DNA of DECK-0008 §7: generation 1 fills the string to the symbol cap with A(1,2,3,4);
 * then every generation, for every symbol, two rules spend all 256 condition and chance nodes of
 * head A/4 and fail, and a third rewrites the symbol with four 63-node arguments.
 */
function slowDna(symbolCap) {
  const lines = [
    'dna slow',
    'axiom ' + 'A'.repeat(symbolCap / 4),
    'A -> A(1,2,3,4) A(1,2,3,4) A(1,2,3,4) A(1,2,3,4)',
    `A(a,b,c,d) if ${cond} chance ${chance} -> A(a,b,c,d)`,
    `A(a,b,c,d) if ${cond} chance ${chance} -> A(a,b,c,d)`,
    `A(a,b,c,d) -> A(${arg}, ${arg}, ${arg}, ${arg})`,
  ]
  return lines.join('\n')
}

function time(fn, minRuns = 3, minMs = 1500) {
  for (let i = 0; i < 2; i++) fn() // warm-up
  const ts = []
  const start = performance.now()
  while (ts.length < minRuns || performance.now() - start < minMs) {
    const t = performance.now(); fn(); ts.push(performance.now() - t)
    if (ts.length >= 50) break
  }
  ts.sort((x, y) => x - y)
  return { median: ts[ts.length >> 1], min: ts[0], runs: ts.length }
}
const fmt = (ms) => ms >= 100 ? ms.toFixed(0) + ' ms' : ms.toFixed(2) + ' ms'

const rows = []
function bench(label, text, caps, clock, hash) {
  const dna = S.parseDna(text)
  const seed = { coord: coordA, planted: P0, caps }
  const b = S.growBloom(dna, seed, clock, hash)
  const port = time(() => S.growBloom(dna, seed, clock, hash), 3, caps.generations > 100 ? 1 : 1500)
  const grown = S.growSymbols(dna, seed, clock, hash)
  const draw = time(() => S.drawBloom(dna, grown, seed, clock))
  let ref = null
  if (R) {
    const prog = R.parseDNA(text)
    const run = () => R.grow({ prog, coord: coordA, planted: P0, scale: 0, caps, clock, blockHash: hash })
    const check = run()
    if (R.sha256hex(Buffer.from(check.json, 'utf8')) !== b.sha256) throw new Error(label + ': the port and the reference disagree')
    ref = time(run, 3, caps.generations > 100 ? 1 : 1500)
  }
  rows.push({ label, gens: b.generation, symbols: b.symbols, vertices: b.sno.vertices.length, bytes: b.json.length, port, draw, ref, steps: grown.generation * caps.symbols })
}

for (const name of ['fiddlehead', 'sword fern', 'oak', 'willow', 'coral', 'crystal']) {
  bench(name + ', day 30 + 6, prototype caps', V.growth.dnas[name], PROTO, P0 + 30 * 144 + 6, realHash)
}
bench('slow DNA, free caps (2048/2048/32)', slowDna(2048), S.BASE_CAPS, P0 + 32 * 144 + 6, fakeHash)
bench('slow DNA, prototype caps (8000/6000/40)', slowDna(6000), PROTO, P0 + 40 * 144 + 6, fakeHash)
bench('slow DNA, largest caps (65536/16384/256)', slowDna(16384), LARGEST, P0 + 256 * 144 + 6, fakeHash)
// drawing at its worst: 16,384 F against the largest vertex cap
{
  const text = 'dna draw\naxiom ' + 'F'.repeat(4096) + '\nF -> F F F F'
  const dna = S.parseDna(text), seed = { coord: coordA, planted: P0, caps: LARGEST }, clock = P0 + 2 * 144
  const grown = S.growSymbols(dna, { ...seed, caps: { ...LARGEST, generations: 1 } }, clock, fakeHash)
  const draw = time(() => S.drawBloom(dna, grown, seed, clock))
  const b = S.drawBloom(dna, grown, seed, clock)
  rows.push({ label: 'draw only: 16,384 F, vertex cap 65,536', gens: grown.generation, symbols: grown.str.length, vertices: b.sno.vertices.length, bytes: b.json.length, port: null, draw, ref: null })
}

console.log('node ' + process.version + ', ' + (R ? 'reference: ' + refPath : 'reference not found'))
console.log('| case | gen | symbols | vertices | SNO bytes | grow + draw (port) | grow + draw (reference) | draw only (port) |')
console.log('|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  console.log(`| ${r.label} | ${r.gens} | ${r.symbols} | ${r.vertices} | ${r.bytes} | ${r.port ? fmt(r.port.median) : ''} | ${r.ref ? fmt(r.ref.median) : ''} | ${fmt(r.draw.median)} |`)
}
