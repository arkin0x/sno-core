import { describe, expect, it } from 'vitest'
import { Fetched, MAX_PLACED, carriedModel, carriedTable, carryAll, carryObject, parseAddress, removeParts, resolveParts, uncarry, withAuthor, type FetchRef, type Placed } from './parts.js'
import { objectFromEvent } from './feed.js'
import { fromPayload, liftKnown, normalizeStored, toPayload, type Ref, type ShardModel } from './shards.js'

// DECK-0003 §1.10: an object may carry the objects it places, in `objects`.

const ME = 'ab'.repeat(32)
const THEM = 'cd'.repeat(32)
const at = (d: string, pk = ME): string => `33331:${pk}:${d}`
const ref = (d: string, pk = ME): Ref => ['a', at(d, pk)]

/** A payload in wire coordinates, one vertex unless told otherwise. */
const payload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 2, name: 't', unit: 0, extent: 8, mode: 'solid', vertices: [[1, 0, 0]], colors: [229], faces: [], ...over,
})
const read = (over: Record<string, unknown> = {}): ShardModel => {
  const s = fromPayload(payload(over), 't')
  if (!s) throw new Error('refused')
  return s
}
const PLACE = [0, 0, 0, 0, 0, 0, 0, 0]
/** A parent placing each of `ds` once, carrying `objects`. */
const parent = (ds: string[], objects?: unknown, pk = ME): ShardModel =>
  read({ vertices: [], colors: [], refs: ds.map((d) => ref(d, pk)), parts: ds.map((_, i) => [i, 0, 0, 0, 0, 0, 0, 0]), ...(objects === undefined ? {} : { objects }) })

/** A parent placing `ds`, carrying only the first. */
const read0 = (ds: string[]): ShardModel => parent(ds, { [at(ds[0])]: payload({ name: 'carried' }) })

const water = payload({ name: 'water', opacity: 40, constrain: 'off' })
const stone = payload({ name: 'stone', constrain: 'all' })

/** A fetch that counts what it was asked, answering from `relay` by d. */
const relayOf = (relay: Record<string, unknown> = {}): { fetch: FetchRef; asked: string[] } => {
  const asked: string[] = []
  return { asked, fetch: async (r) => { asked.push(r[1]); return relay[r[1]] ?? null } }
}

describe('objects on the wire (§1.10, §1.9 rule 16)', () => {
  it('reads the table out of extra, and writes it back', () => {
    const s = parent(['room', 'water'], { [at('room')]: stone, [at('water')]: water })
    expect(s.extra).toBeUndefined()
    expect(Object.keys(s.objects ?? {})).toEqual([at('room'), at('water')])
    expect(toPayload(s).objects).toEqual({ [at('room')]: stone, [at('water')]: water })
  })

  it('never refuses the parent for the field, and reads one that is not a table as absent', () => {
    for (const junk of [null, [], 'x', 7, true, [[at('w'), water]]]) {
      const s = parent(['w'], junk)
      expect(s.objects, JSON.stringify(junk)).toBeUndefined()
      expect(toPayload(s).objects).toBeUndefined()
    }
  })

  it('drops a key that is not an address, and keeps a bad entry as it came', () => {
    const s = parent(['w'], { [at('w')]: 'not a payload', 'w': water, [`33331:${ME.toUpperCase()}:w`]: water })
    expect(s.objects).toEqual({ [at('w')]: 'not a payload' })
    expect(toPayload(s).objects).toEqual({ [at('w')]: 'not a payload' })
  })

  it('writes the table it holds, and nothing when it holds nothing', () => {
    // Not pruned here: `stray` might be placed beneath a fetched object (carryAll prunes).
    const s = parent(['room'], { [at('room')]: stone, [at('stray')]: water })
    expect(Object.keys(toPayload(s).objects ?? {})).toEqual([at('room'), at('stray')])
    expect(toPayload({ ...parent(['w']), objects: {} }).objects).toBeUndefined()
  })

  it('drops a carried object with the last placement that reaches it', () => {
    const room = payload({ name: 'room', refs: [ref('water')], parts: [PLACE] })
    const s = parent(['room', 'water', 'stone'], { [at('room')]: room, [at('water')]: water, [at('stone')]: stone })
    // Removing the direct placement of water keeps it: the room still places it.
    const a = removeParts(s, [1])
    expect(Object.keys(a.objects ?? {}).sort()).toEqual([at('room'), at('stone'), at('water')].sort())
    const b = removeParts(a, [0])
    expect(Object.keys(b.objects ?? {})).toEqual([at('stone')])
    expect(removeParts(b, [0]).objects).toBeUndefined()
  })

  it('takes a table inside the table off when it writes, without merging it up', () => {
    const nested = { ...water, objects: { [at('deep')]: stone } }
    const out = toPayload(parent(['w'], { [at('w')]: nested })).objects as Record<string, Record<string, unknown>>
    expect(out[at('w')]).toEqual(water)
    expect(out[at('deep')]).toBeUndefined()
  })

  it('lifts a table an older version carried in extra', () => {
    const s = parent(['w'])
    const old = { ...s, extra: { objects: { [at('w')]: water }, other: 1 } }
    const lifted = liftKnown(old)
    expect(lifted.objects).toEqual({ [at('w')]: water })
    expect(lifted.extra).toEqual({ other: 1 })
    expect(normalizeStored(old).objects).toEqual({ [at('w')]: water })
  })

  it('keeps a __proto__ key as data', () => {
    const s = fromPayload(JSON.parse(`{"v":2,"name":"t","unit":0,"mode":"solid","vertices":[],"colors":[],"faces":[],"objects":{"__proto__":{"x":1}}}`), 't')
    expect(s?.objects).toBeUndefined()
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

describe('resolveParts with a table', () => {
  it('draws from the table and asks no relay', async () => {
    const { fetch, asked } = relayOf()
    const placed = await resolveParts(parent(['room', 'water'], { [at('room')]: stone, [at('water')]: water }), fetch, { author: ME })
    expect(asked).toEqual([])
    expect(placed.map((p) => [p.model?.name, p.model?.opacity, p.carried])).toEqual([['stone', undefined, true], ['water', 40, true]])
    // Each keeps its own fields: the water's constrain is its own, carried in extra.
    expect(placed[1].model?.extra).toEqual({ constrain: 'off' })
  })

  it('makes a bad entry a placeholder for its placements, still unfetched, and leaves the parent alone', async () => {
    const { fetch, asked } = relayOf({ [at('w')]: water })
    const placed = await resolveParts(parent(['w', 'v'], { [at('w')]: { ...water, v: 3 }, [at('v')]: 'x' }), fetch, { author: ME })
    expect(asked).toEqual([])
    expect(placed.map((p) => [p.missing, p.carried])).toEqual([['invalid', true], ['invalid', true]])
  })

  it('fetches what the table does not hold', async () => {
    const { fetch, asked } = relayOf({ [at('tile', THEM)]: stone })
    const s = read({ vertices: [], colors: [], refs: [ref('w'), ref('tile', THEM)], parts: [PLACE, [1, 0, 0, 0, 0, 0, 0, 0]], objects: { [at('w')]: water } })
    const placed = await resolveParts(s, fetch, { author: ME })
    expect(asked).toEqual([at('tile', THEM)])
    expect(placed[1].model?.name).toBe('stone')
    expect(placed[1].carried).toBeUndefined()
  })

  it('ignores a key under another pubkey and fetches it instead (D5)', async () => {
    const { fetch, asked } = relayOf()
    const s = parent(['tile'], { [at('tile')]: stone }, THEM)
    const placed = await resolveParts(s, fetch, { author: ME })
    expect(asked).toEqual([at('tile', THEM)])
    expect(placed[0].missing).toBe('unreachable')
    // The author defaults to the pubkey `self` names.
    const mine = await resolveParts(parent(['w'], { [at('w')]: water }), relayOf().fetch, ref('me'))
    expect(mine[0].model?.name).toBe('water')
  })

  it('looks the root table up at every depth, and ignores a table inside the table', async () => {
    const room = payload({ name: 'room', refs: [ref('water'), ref('deep')], parts: [PLACE, [1, 0, 0, 0, 0, 0, 0, 0]], objects: { [at('deep')]: stone } })
    const { fetch, asked } = relayOf()
    const placed = await resolveParts(parent(['room'], { [at('room')]: room, [at('water')]: water }), fetch, { author: ME })
    expect(placed[0].children[0].model?.name).toBe('water')
    expect(placed[0].children[0].carried).toBe(true)
    // `deep` is only in the room's own table, which a reader ignores: fetched, not found.
    expect(asked).toEqual([at('deep')])
    expect(placed[0].children[1].missing).toBe('unreachable')
  })

  it('uses a fetched object\'s own table for its placements, after the root\'s', async () => {
    const published = payload({ name: 'pub', refs: [ref('a', THEM), ref('b', THEM)], parts: [PLACE, [1, 0, 0, 0, 0, 0, 0, 0]], objects: { [at('a', THEM)]: payload({ name: 'own a' }), [at('b', THEM)]: payload({ name: 'own b' }), [at('x')]: stone } })
    const { fetch, asked } = relayOf({ [at('pub', THEM)]: published })
    const root = parent(['pub'], { [at('a', THEM)]: payload({ name: 'root a' }) }, THEM)
    // The root is THEM's, so its entry for THEM's address counts, and is looked in first.
    const placed = await resolveParts(root, fetch, { author: THEM })
    expect(asked).toEqual([at('pub', THEM)])
    expect(placed[0].children.map((c) => c.model?.name)).toEqual(['root a', 'own b'])
    // Under ME, the root's key under THEM is ignored and the fetched object's own answers.
    const strict = await resolveParts(root, relayOf({ [at('pub', THEM)]: published }).fetch, { author: ME })
    expect(strict[0].children.map((c) => c.model?.name)).toEqual(['own a', 'own b'])
  })

  it('reads an entry of the root table in the root\'s event, even beneath a fetched object', async () => {
    // pub (fetched, THEM) places q, which the root carries; q places r, which only pub's table holds.
    const pub = payload({ name: 'pub', refs: [ref('q')], parts: [PLACE], objects: { [at('r', THEM)]: stone } })
    const q = payload({ name: 'q', refs: [ref('r', THEM)], parts: [PLACE] })
    const { fetch, asked } = relayOf({ [at('pub', THEM)]: pub })
    const s = read({ vertices: [], colors: [], refs: [ref('pub', THEM)], parts: [PLACE], objects: { [at('q')]: q } })
    const placed = await resolveParts(s, fetch, { author: ME })
    expect(placed[0].children[0].model?.name).toBe('q')
    // q travels in the root's event, so pub's table does not answer for it: r is fetched.
    expect(asked).toEqual([at('pub', THEM), at('r', THEM)])
  })

  it('reads every payload, fetched or carried, through the read it is given', async () => {
    const seen: string[] = []
    const read = (p: unknown, key: string): ShardModel | null => { seen.push(key); return fromPayload(p, key) }
    const s = read0(['w', 'tile'])
    await resolveParts(s, relayOf({ [at('tile')]: stone }).fetch, { read, author: ME })
    expect(seen.sort()).toEqual([`a:${at('tile')}`, `a:${at('w')}`].sort())
  })

  it('counts a carried placement toward loops', async () => {
    const loop = payload({ name: 'loop', refs: [ref('loop')], parts: [PLACE] })
    const placed = await resolveParts(parent(['loop'], { [at('loop')]: loop }), relayOf().fetch, { author: ME })
    expect(placed[0].model?.name).toBe('loop')
    expect(placed[0].children[0].missing).toBe('cycle')
  })
})

describe('writing a table', () => {
  it('carries an object, flattening what it carries into the root, root entries first', () => {
    const inner = { ...read({ name: 'inner', refs: [ref('deep')], parts: [PLACE] }), objects: { [at('deep')]: stone, [at('kept')]: water } }
    const root = carryObject(parent(['inner', 'kept'], { [at('kept')]: payload({ name: 'root kept' }) }), at('inner'), inner)
    expect(Object.keys(root.objects ?? {}).sort()).toEqual([at('deep'), at('inner'), at('kept')].sort())
    expect((root.objects?.[at('kept')] as { name: string }).name).toBe('root kept')
    expect((root.objects?.[at('inner')] as Record<string, unknown>).objects).toBeUndefined()
    expect(carriedModel(root.objects ?? {}, at('inner'))?.name).toBe('inner')
    expect(uncarry(uncarry(root, at('inner')), at('nothing')).objects?.[at('inner')]).toBeUndefined()
    expect(uncarry(parent(['w'], { [at('w')]: water }), at('w')).objects).toBeUndefined()
  })

  it('carries what lookup chooses at any depth, walks through what it leaves a reference, and keeps an entry already held', async () => {
    const pieces: Record<string, ShardModel> = {
      [at('pub')]: read({ name: 'published', refs: [ref('under')], parts: [PLACE] }),
      [at('under')]: read({ name: 'under the published one' }),
      [at('room')]: read({ name: 'room', refs: [ref('water')], parts: [PLACE] }),
      [at('water')]: read({ name: 'workshop water' }),
    }
    const root = parent(['pub', 'room', 'tile'], undefined)
    const held = carryObject(carryObject(root, at('water'), read({ name: 'edited copy' })), at('gone'), read({ name: 'no longer placed' }))
    const asked: string[] = []
    const out = carryAll(held, ([, a]) => {
      asked.push(a)
      const object = pieces[a]
      if (!object) return null
      return { object, carry: a !== at('pub') }
    })
    // Without `prune`, an entry nothing reached stays; with it, it goes.
    expect(Object.keys(out.objects ?? {}).sort()).toEqual([at('gone'), at('room'), at('under'), at('water')].sort())
    const pruned = carryAll(held, ([, a]) => (pieces[a] ? { object: pieces[a], carry: a !== at('pub') } : null), { prune: true })
    expect(Object.keys(pruned.objects ?? {}).sort()).toEqual([at('room'), at('under'), at('water')].sort())
    expect(carriedModel(out.objects ?? {}, at('water'))?.name).toBe('edited copy')
    expect(asked).not.toContain(at('water'))
    // And it reads back: what is written is what a reader draws.
    const placed = await resolveParts(fromPayload(toPayload(out), 'p') as ShardModel, relayOf().fetch, { author: ME })
    expect(placed.map((p) => p.carried ?? false)).toEqual([false, true, false])
    expect(carriedTable(fromPayload(toPayload(out), 'p') as ShardModel, ME)[at('under')]).toBeDefined()
  })
})

describe('the review of #21', () => {
  const placer = (name: string, ds: string[], over: Record<string, unknown> = {}): Record<string, unknown> =>
    payload({ name, vertices: [], colors: [], refs: ds.map((d) => ref(d)), parts: ds.map((_, i) => [i, 0, 0, 0, 0, 0, 0, 0]), ...over })
  const m = (p: Record<string, unknown>): ShardModel => fromPayload(p, 'x') as ShardModel

  it('carryAll walks an address again when it is met nearer the top, so what it places is carried', async () => {
    // A > B > C > X reaches X at depth 4; the root also places X at depth 1, and X places Y.
    const pieces: Record<string, ShardModel> = { A: m(placer('A', ['B'])), B: m(placer('B', ['C'])), C: m(placer('C', ['X'])), X: m(placer('X', ['Y'])), Y: m(payload({ name: 'Y' })) }
    const out = carryAll(m(placer('root', ['A', 'X'])), ([, a]) => {
      const d = a.split(':')[2]
      return pieces[d] ? { object: pieces[d], carry: true } : null
    })
    expect(Object.keys(out.objects ?? {}).map((k) => k.split(':')[2]).sort()).toEqual(['A', 'B', 'C', 'X', 'Y'])
    const { fetch, asked } = relayOf()
    await resolveParts(fromPayload(toPayload(out), 'r') as ShardModel, fetch, { author: ME })
    expect(asked).toEqual([])
    // And prune keeps an edited copy of Y the same way.
    const held = m(placer('root', ['A', 'X'], { objects: { [at('Y')]: payload({ name: 'edited Y' }) } }))
    const pruned = carryAll(held, ([, a]) => { const d = a.split(':')[2]; return pieces[d] ? { object: pieces[d], carry: true } : null }, { prune: true })
    expect((pruned.objects?.[at('Y')] as { name: string }).name).toBe('edited Y')
  })

  it('honours no key when no author is known, never every key', async () => {
    const forged = read({ vertices: [], colors: [], refs: [ref('tile', THEM)], parts: [PLACE], objects: { [at('tile', THEM)]: payload({ name: 'FORGED' }) } })
    for (const options of [undefined, ['e', 'ef'.repeat(32)] as Ref, { author: null }]) {
      const placed = await resolveParts(forged, relayOf().fetch, options)
      expect(placed[0].model, JSON.stringify(options)).toBeNull()
      expect(placed[0].missing).toBe('unreachable')
    }
    expect(carriedTable(forged, null)).toEqual({})
    // withAuthor sets the author and keeps only its keys; resolveParts then uses it.
    const mine = withAuthor(read({ vertices: [], colors: [], refs: [ref('w')], parts: [PLACE], objects: { [at('w')]: water, [at('x', THEM)]: stone } }), ME)
    expect(mine.author).toBe(ME)
    expect(Object.keys(mine.objects ?? {})).toEqual([at('w')])
    expect((await resolveParts(mine, relayOf().fetch))[0].model?.name).toBe('water')
    expect(withAuthor(mine, ME)).toBe(mine)
    expect(withAuthor(mine, null).objects).toBeUndefined()
  })

  it('removeParts keeps an entry a fetched object still standing may place', () => {
    const root = m(placer('root', ['W', 'P'], { objects: { [at('W')]: payload({ name: 'W' }) } }))
    expect(removeParts(root, [0]).objects?.[at('W')]).toBeDefined()
    // With nothing fetched left, it goes.
    const alone = m(placer('root', ['W', 'Z'], { objects: { [at('W')]: payload({ name: 'W' }), [at('Z')]: payload({ name: 'Z' }) } }))
    expect(Object.keys(removeParts(alone, [0]).objects ?? {})).toEqual([at('Z')])
  })

  it('carryObject brings in only keys under the writer\'s own pubkey', () => {
    const inner = { ...m(placer('inner', ['deep'])), objects: { [at('deep')]: stone, [at('z', THEM)]: water } }
    const out = carryObject(m(placer('root', ['inner'])), at('inner'), inner)
    expect(Object.keys(out.objects ?? {}).sort()).toEqual([at('deep'), at('inner')].sort())
  })

  it('an object fetched by e keeps its own table under the pubkey the fetch says', async () => {
    const pub = placer('pub', ['q'], { objects: { [at('q')]: payload({ name: 'q' }) } })
    const root = read({ vertices: [], colors: [], refs: [['e', 'ef'.repeat(32)]], parts: [PLACE] })
    const told = await resolveParts(root, async (r) => (r[0] === 'e' ? new Fetched(pub, ME) : null), { author: ME })
    expect(told[0].children[0].model?.name).toBe('q')
    const untold = await resolveParts(root, async (r) => (r[0] === 'e' ? pub : null), { author: ME })
    expect(untold[0].children[0].missing).toBe('unreachable')
  })

  it('a d is any string, line breaks included', async () => {
    const a = `33331:${ME}:line\nbreak`
    expect(parseAddress(a)?.d).toBe('line\nbreak')
    const s = read({ vertices: [], colors: [], refs: [['a', a]], parts: [PLACE], objects: { [a]: water } })
    expect(Object.keys(carriedTable(s, ME))).toEqual([a])
    expect((await resolveParts(s, relayOf().fetch, { author: ME }))[0].model?.name).toBe('water')
  })

  it('writes the table in code point order, one spelling', () => {
    const s = parent(['b', 'a'], { [at('b')]: stone, [at('a')]: water })
    expect(Object.keys(toPayload(s).objects ?? {})).toEqual([at('a'), at('b')])
  })

  it(`draws no more than ${MAX_PLACED} placements in one resolve, the rest placeholders`, async () => {
    const many = (d: string, n: number): Record<string, unknown> => payload({ name: d, vertices: [], colors: [], refs: [ref(d)], parts: Array.from({ length: n }, (_, i) => [0, i, 0, 0, 0, 0, 0, 0]) })
    const root = { ...m(many('A', 60)), objects: { [at('A')]: many('B', 60), [at('B')]: many('C', 60), [at('C')]: payload({ name: 'C' }) } }
    const placed = await resolveParts(root, relayOf().fetch, { author: ME })
    let drawn = 0, over = 0
    const count = (xs: typeof placed): void => { for (const x of xs) { if (x.model) drawn++; if (x.missing === 'budget') over++; count(x.children) } }
    count(placed)
    expect(drawn).toBeLessThanOrEqual(MAX_PLACED)
    expect(over).toBeGreaterThan(0)
  })

  it('the feed keeps only its author\'s keys, and says who that is', () => {
    const content = JSON.stringify({ ...placer('chair', ['tile']), objects: { [at('tile')]: water, [at('chair', THEM)]: stone } })
    const o = objectFromEvent({ id: 'f'.repeat(64), pubkey: ME, created_at: 1, kind: 33331, tags: [['d', 'set']], content })
    expect(o?.shard.author).toBe(ME)
    expect(Object.keys(o?.shard.objects ?? {})).toEqual([at('tile')])
  })

  it('reads an entry with a table of its own from the same object every time', () => {
    const table = { [at('w')]: { ...water, objects: { [at('x')]: stone } } }
    const seen: unknown[] = []
    const reader = (p: unknown, k: string): ShardModel | null => { seen.push(p); return fromPayload(p, k) }
    carriedModel(table, at('w'), reader)
    carriedModel(table, at('w'), reader)
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]).not.toHaveProperty('objects')
  })
})

describe('the placement budget cannot be outrun', () => {
  // The reviewer's shapes: four levels each placing the next N times, then a
  // fifth level (deep placeholders) or a loop back up (cycle placeholders).
  const level = (name: string, next: string | null, n: number): Record<string, unknown> =>
    payload({ name, vertices: [], colors: [], ...(next ? { refs: [ref(next)], parts: Array.from({ length: n }, (_, i) => [0, i, 0, 0, 0, 0, 0, 0]) } : {}) })
  const build = (last: string | null, n: number): ShardModel => ({
    ...(fromPayload(level('root', 'b', n), 'r') as ShardModel),
    objects: { [at('b')]: level('b', 'c', n), [at('c')]: level('c', 'd', n), [at('d')]: level('d', 'e', n), [at('e')]: level('e', last, n) },
  })
  const nodes = (xs: Placed[]): number => xs.reduce((n, x) => n + 1 + nodes(x.children), 0)

  for (const [shape, last] of [['a fifth level, all deep', 'f'], ['a loop back up, all cycles', 'd'], ['four levels', null]] as const) {
    it(`bounds ${shape}`, async () => {
      const placed = await resolveParts(build(last, 40), relayOf().fetch, { author: ME })
      // At most the budget, plus one marker per object cut short (never more objects than counted).
      expect(nodes(placed)).toBeLessThanOrEqual(2 * MAX_PLACED)
    })
  }

  it('counts placeholders too: a level past the depth bound is paid for', async () => {
    const placed = await resolveParts(build('f', 12), relayOf().fetch, { author: ME })
    const tally: Record<string, number> = {}
    const walk = (xs: Placed[]): void => { for (const x of xs) { tally[x.missing ?? 'drawn'] = (tally[x.missing ?? 'drawn'] ?? 0) + 1; walk(x.children) } }
    walk(placed)
    // 12 + 144 + 1728 + 20736 counted would pass the budget before the deep level is reached.
    expect(tally.budget).toBeGreaterThan(0)
    expect((tally.drawn ?? 0) + (tally.deep ?? 0)).toBeLessThanOrEqual(MAX_PLACED)
  })

  it('shares one budget between resolves that are handed the same one', async () => {
    const budget = { left: 1000 }
    const first = await resolveParts(build(null, 12), relayOf().fetch, { author: ME, budget })
    const second = await resolveParts(build(null, 12), relayOf().fetch, { author: ME, budget })
    const drawn = (xs: Placed[]): number => xs.reduce((n, x) => n + (x.model ? 1 : 0) + drawn(x.children), 0)
    expect(drawn(first) + drawn(second)).toBeLessThanOrEqual(1000)
    expect(budget.left).toBe(0)
    expect(second.length).toBe(1)
    expect(second[0].missing).toBe('budget')
  })
})
