import { describe, expect, it } from 'vitest'
import { carriedModel, carriedTable, carryAll, carryObject, removeParts, resolveParts, uncarry, type FetchRef } from './parts.js'
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
    // Without an author check the root's entry for THEM's address is honoured, and wins.
    const placed = await resolveParts(root, fetch)
    expect(asked).toEqual([at('pub', THEM)])
    expect(placed[0].children.map((c) => c.model?.name)).toEqual(['root a', 'own b'])
    // With it, the root's key under THEM is ignored and the fetched object's own answers.
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
    await resolveParts(s, relayOf({ [at('tile')]: stone }).fetch, { read })
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
    const out = await carryAll(held, (a) => {
      asked.push(a)
      const object = pieces[a]
      if (!object) return null
      return { object, carry: a !== at('pub') }
    })
    expect(Object.keys(out.objects ?? {}).sort()).toEqual([at('room'), at('under'), at('water')].sort())
    expect(carriedModel(out.objects ?? {}, at('water'))?.name).toBe('edited copy')
    expect(asked).not.toContain(at('water'))
    // And it reads back: what is written is what a reader draws.
    const placed = await resolveParts(fromPayload(toPayload(out), 'p') as ShardModel, relayOf().fetch, { author: ME })
    expect(placed.map((p) => p.carried ?? false)).toEqual([false, true, false])
    expect(carriedTable(fromPayload(toPayload(out), 'p') as ShardModel, ME)[at('under')]).toBeDefined()
  })
})
