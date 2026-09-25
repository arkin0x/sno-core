import { describe, expect, it } from 'vitest'
import { MAX_PART_DEPTH, parseAddress, partMatrix, refKey, refTags, resolveParts, type FetchRef } from './parts.js'
import { fromPayload, ticksOf, toPayload, toRender, type Ref, type ShardModel } from './shards.js'

const PK = 'ab'.repeat(32)
const addr = (d: string): Ref => ['a', `33331:${PK}:${d}`]

/** A payload in wire coordinates, one vertex unless told otherwise. */
const payload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 2, name: 't', unit: 0, extent: 8, mode: 'solid', vertices: [[1, 0, 0]], colors: [229], faces: [], ...over,
})
const read = (over: Record<string, unknown> = {}): ShardModel => {
  const s = fromPayload(payload(over), 't')
  if (!s) throw new Error('refused')
  return s
}

/** A column-major 4x4 applied to a point. */
const apply = (m: number[], p: [number, number, number]): number[] =>
  [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]).map((n) => Math.round(n * 1e9) / 1e9 + 0)

describe('refs and parts on the wire (§1.9 rules 11 to 13)', () => {
  it('reads a placement into the model frame and writes it back unchanged', () => {
    const refs = [addr('tile'), ['e', 'cd'.repeat(32), 'wss://relay.example']]
    const parts = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 240, 0, 120, 10, 90, 45, 0], [1, 120, 0, -120, 0, 0, 0, -1]]
    const s = read({ refs, parts })
    // Z negated, turns about X and Y mirrored, Z's kept: the vertices' frame.
    expect(s.parts?.[1]).toEqual({ ref: 0, at: [240, 0, -120], turn: [350, 270, 45], step: 0 })
    expect(s.refs).toEqual(refs)
    const out = toPayload(s)
    expect(out.parts).toEqual(parts)
    expect(out.refs).toEqual(refs)
  })

  it('accepts an object that is nothing but the arrangement of others (rule 13)', () => {
    const s = read({ vertices: [], colors: [], refs: [addr('tile')], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    expect(s.vertices).toHaveLength(0)
    expect(s.parts).toHaveLength(1)
  })

  it('rejects every malformed reference and placement', () => {
    const bad: Array<Record<string, unknown>> = [
      { refs: 'x' },
      { refs: [['a', `33331:${PK.toUpperCase()}:d`]] },
      { refs: [['a', `30023:${PK}:d`]] },
      { refs: [['e', 'cd'.repeat(31)]] },
      { refs: [['p', PK]] },
      { refs: [['e', 'cd'.repeat(32), 'wss://x', 'extra']] },
      { refs: [['e', 'cd'.repeat(32), 7]] },
      { parts: [[0, 0, 0, 0, 0, 0, 0, 0]] },
      { refs: [addr('t')], parts: [[1, 0, 0, 0, 0, 0, 0, 0]] },
      { refs: [addr('t')], parts: [[0, 7681, 0, 0, 0, 0, 0, 0]] },
      { refs: [addr('t')], parts: [[0, 0, 0, 0, 360, 0, 0, 0]] },
      { refs: [addr('t')], parts: [[0, 0, 0, 0, 0, 0, 0, 0.5]] },
      { refs: [addr('t')], parts: [[0, 0, 0, 0, 0, 0, 0]] },
      { refs: [addr('t')], parts: 'x' },
    ]
    for (const over of bad) expect(fromPayload(payload(over), 't'), JSON.stringify(over)).toBeNull()
  })

  it('tags only the references a placement uses', () => {
    const s = read({ refs: [addr('used'), addr('unused')], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    expect(refTags(s)).toEqual([addr('used')])
    expect(parseAddress(addr('d:with:colons')[1])).toEqual({ kind: 33331, pubkey: PK, d: 'd:with:colons' })
  })
})

describe('partMatrix', () => {
  it('stands a placed vertex where the wire says: R v + P, through the mirror both ways', () => {
    const child = read()
    // On the wire: at (0, 0, 2 units), a quarter turn about Y. Ry(90) takes +X to -Z.
    const parent = read({ refs: [addr('c')], parts: [[0, 0, 0, 240, 0, 90, 0, 0]] })
    const m = partMatrix(parent.parts![0], parent.unit, child.unit)
    expect(apply(m, toRender(ticksOf(child.vertices[0])))).toEqual([0, 0, 1])
  })

  it('turns about X, then Y, then Z, all about the parent axes', () => {
    const child = read()
    // Rx(90) leaves +X alone, Ry(90) sends it to -Z, Rz(90) leaves -Z alone.
    const one = read({ refs: [addr('c')], parts: [[0, 0, 0, 0, 90, 90, 90, 0]] })
    expect(apply(partMatrix(one.parts![0], 0, 0), toRender(ticksOf(child.vertices[0])))).toEqual([0, 0, -1])
  })

  it('scales by 2^(its unit + step - the parent unit)', () => {
    const parent = read({ unit: 3, refs: [addr('c')], parts: [[0, 0, 0, 0, 0, 0, 0, 1]] })
    expect(apply(partMatrix(parent.parts![0], 3, 4), [1, 0, 0])).toEqual([4, 0, 0])
  })
})

describe('resolveParts', () => {
  const store = (objects: Record<string, Record<string, unknown> | 'throw'>): { fetch: FetchRef; calls: string[] } => {
    const calls: string[] = []
    const fetch: FetchRef = async (ref) => {
      calls.push(refKey(ref))
      const got = objects[ref[1].split(':').pop() as string]
      if (got === 'throw') throw new Error('down')
      return got ? payload(got) : null
    }
    return { fetch, calls }
  }

  it('fetches a placed object once, however often it is placed', async () => {
    const { fetch, calls } = store({ tile: {} })
    const parts = Array.from({ length: 129 }, (_, i) => [0, i * 120 - 7680, 0, 0, 0, 0, 0, 0])
    const placed = await resolveParts(read({ refs: [addr('tile')], parts }), fetch)
    expect(placed).toHaveLength(129)
    expect(placed.every((p) => p.model !== null)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('draws a placeholder for what is missing, broken, too large or too small, and never refuses the parent', async () => {
    const { fetch } = store({ broken: { mode: 'nonsense' }, big: { unit: 84 }, down: 'throw' })
    const parent = read({
      refs: [addr('nowhere'), addr('broken'), addr('big'), addr('down')],
      parts: [[0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0, 1], [3, 0, 0, 0, 0, 0, 0, 0]],
    })
    const placed = await resolveParts(parent, fetch)
    expect(placed.map((p) => p.missing)).toEqual(['unreachable', 'invalid', 'scale', 'unreachable'])
    expect(placed.every((p) => p.model === null)).toBe(true)
  })

  it('treats an object already among its parents as missing, itself included', async () => {
    const { fetch } = store({
      a: { refs: [addr('b')], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] },
      b: { refs: [addr('a')], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] },
    })
    const root = read({ refs: [addr('a'), addr('root')], parts: [[0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0]] })
    const placed = await resolveParts(root, fetch, addr('root'))
    // root -> a -> b -> a: the second a is the loop.
    expect(placed[0].children[0].children[0].missing).toBe('cycle')
    expect(placed[1].missing).toBe('cycle')
  })

  it(`follows no deeper than ${MAX_PART_DEPTH} levels`, async () => {
    const objects: Record<string, Record<string, unknown>> = {}
    for (let i = 1; i <= 6; i++) objects[`l${i}`] = { refs: [addr(`l${i + 1}`)], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] }
    const { fetch, calls } = store(objects)
    let level = await resolveParts(read({ refs: [addr('l1')], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] }), fetch)
    for (let depth = 1; depth <= MAX_PART_DEPTH; depth++) {
      expect(level[0].model, `level ${depth}`).not.toBeNull()
      level = level[0].children
    }
    expect(level[0].missing).toBe('deep')
    // The fifth level is never fetched.
    expect(calls).toHaveLength(MAX_PART_DEPTH)
  })
})
