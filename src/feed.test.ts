import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_DEADLINE_MS, CONNECT_DEADLINE_MS, DELETION_ADDRESS_MAX, DELETION_FILTER_BYTES, DELETION_FILTER_VALUES, FEED_PAGE, READ_DEADLINE_MS, SNO_KIND, createFeed, deletionFilters, creditAuthor, creditOf, creditTags, feedFilter, withCredit,
  MAX_PRICE_SATS, SELLER_LABEL_MAX, feedItems, handlerFilter, isDeleted, isListing, listingApp, listingFromEvent, listingPointer, objectD, objectFromEvent, readCredit, readEach,
  registrableDomain, sellerLink,
  type DeletionFilter, type FeedEvent, type FeedFilter, type FeedState, type ReadFilter, type Subscribe,
} from './feed.js'
import { toPayload } from './shards.js'

const PK = 'ab'.repeat(32)
const PK2 = 'cd'.repeat(32)

/** A valid payload (DECK-0003 §1), one point. */
const payload = (name = 't'): string => JSON.stringify({ v: 2, name, unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] })

let n = 0
/** A kind 33331 event for an object. */
function obj(d: string, createdAt: number, pubkey = PK, name = d): FeedEvent {
  n += 1
  return { id: `${n}`.padStart(64, '0'), pubkey, created_at: createdAt, kind: SNO_KIND, tags: [['d', d]], content: payload(name) }
}

/** What a relay holds, answered the way a relay answers a filter: newest first, `limit` of them. */
function answer(events: FeedEvent[], f: ReadFilter): FeedEvent[] {
  const tag = (e: FeedEvent, name: string, values?: string[]): boolean => !values || e.tags.some((t) => t[0] === name && values.includes(t[1]))
  const d = f as DeletionFilter
  return events
    .filter((e) => f.kinds.includes(e.kind) && (!f.authors || f.authors.includes(e.pubkey)) && ((f as FeedFilter).until === undefined || e.created_at <= (f as FeedFilter).until!) && tag(e, 'a', d['#a']) && tag(e, 'e', d['#e']))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit)
}

/**
 * Relays in memory. Each answers after `delay` ms, or never (`hang`), and
 * records every filter it was asked.
 */
function relays(spec: Record<string, { events: FeedEvent[]; delay?: number; hang?: boolean; noEose?: boolean }>): { subscribe: Subscribe; asked: Record<string, FeedFilter[]> } {
  const asked: Record<string, FeedFilter[]> = {}
  // Only the pages are recorded; deletion reads (kind 5) are not pages.
  const subscribe: Subscribe = (url, filter, h) => {
    const r = spec[url]
    if (!filter.kinds.includes(5)) (asked[url] ??= []).push(filter as FeedFilter)
    let closed = false
    if (!r.hang) {
      setTimeout(() => {
        if (closed) return
        for (const e of answer(r.events, filter)) h.onevent(e)
        if (!r.noEose) h.oneose()
      }, r.delay ?? 0)
    }
    return { close: () => { closed = true } }
  }
  return { subscribe, asked }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the feed filter', () => {
  it('asks for kind 33331, paged with until, and never for a tag (strfry refuses more than three)', () => {
    expect(feedFilter()).toEqual({ kinds: [SNO_KIND], limit: FEED_PAGE })
    const f = feedFilter({ authors: [PK], until: 100, limit: 10 })
    expect(f).toEqual({ kinds: [33331], authors: [PK], until: 100, limit: 10 })
    expect(Object.keys(f).some((k) => k.startsWith('#'))).toBe(false)
  })
})

describe('objectFromEvent', () => {
  it('reads an object, with its address', () => {
    const o = objectFromEvent(obj('chair', 5))
    expect(o?.d).toBe('chair')
    expect(o?.address).toBe(`33331:${PK}:chair`)
    expect(o?.shard.vertices).toHaveLength(1)
    expect(o?.event.id).toBe(o?.id)
  })

  it('refuses what is not an object: another kind, no d, malformed, sealed to a place, empty', () => {
    expect(objectFromEvent({ ...obj('a', 1), kind: 1 })).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), tags: [] })).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), content: '{nope' })).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), tags: [['d', 'a'], ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region']] })).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), content: JSON.stringify({ v: 2, name: 'e', unit: 0, extent: 8, mode: 'points', vertices: [], colors: [], faces: [] }) })).toBeNull()
  })

  it('refuses a missing or empty d, reading the first d tag as NIP-01 does (DECK-0003 §3.1)', () => {
    expect(objectD({ tags: [] })).toBeNull()
    expect(objectD({ tags: [['d']] })).toBeNull()
    expect(objectD({ tags: [['d', '']] })).toBeNull()
    expect(objectD({ tags: [['d', ''], ['d', 'late']] })).toBeNull()
    expect(objectD({ tags: [['name', 'x'], ['d', 'chair'], ['d', '']] })).toBe('chair')
    expect(objectFromEvent({ ...obj('a', 1), tags: [['d', '']] })).toBeNull()
  })

  it('refuses a payload with a blank name (DECK-0003 §1.1)', () => {
    expect(objectFromEvent({ ...obj('a', 1), content: payload('  ') })).toBeNull()
  })
})

describe('readEach: each relay on its own', () => {
  it('paints from a fast relay at once, and one hung relay costs only its connect deadline (snocrash #22)', async () => {
    const { subscribe } = relays({ fast: { events: [obj('a', 10)], delay: 50 }, hung: { events: [] } })
    const got: string[] = []
    const handle = readEach(['fast', 'hung'], feedFilter(), subscribe, (ev, url) => got.push(`${url}:${ev.id}`), {
      // The hung relay never finishes connecting.
      connect: (url: string) => (url === 'hung' ? new Promise<boolean>(() => {}) : Promise.resolve(true)),
    })
    await vi.advanceTimersByTimeAsync(60)
    expect(got).toHaveLength(1)
    let finished = false
    void handle.done.then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS)
    expect(finished).toBe(true)
    const ends = await handle.done
    expect(ends.get('fast')).toBe('eose')
    expect(ends.get('hung')).toBe('unreachable')
  })

  it('gives auth its own allowance: a signer slower than the connect deadline still gets the relay read', async () => {
    const { subscribe } = relays({ gated: { events: [obj('a', 10)] } })
    const got: string[] = []
    const handle = readEach(['gated'], feedFilter(), subscribe, (ev) => got.push(ev.id), {
      connect: () => Promise.resolve(true),
      // An extension or a bunker: a person approving the challenge.
      auth: () => new Promise((resolve) => setTimeout(resolve, CONNECT_DEADLINE_MS * 2)),
    })
    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS * 2 + 10)
    expect(got).toHaveLength(1)
    expect((await handle.done).get('gated')).toBe('eose')
  })

  it('reads anyway when auth never answers, after its allowance', async () => {
    const { subscribe } = relays({ open: { events: [obj('a', 10)] } })
    const got: string[] = []
    const handle = readEach(['open'], feedFilter(), subscribe, (ev) => got.push(ev.id), { auth: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(AUTH_DEADLINE_MS + 10)
    expect(got).toHaveLength(1)
    expect((await handle.done).get('open')).toBe('eose')
  })

  it('ends at the read deadline for a relay that never says it is finished', async () => {
    const { subscribe } = relays({ slow: { events: [obj('a', 1)], noEose: true } })
    const handle = readEach(['slow'], feedFilter(), subscribe, () => {})
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS)
    expect((await handle.done).get('slow')).toBe('deadline')
  })

  it('a subscribe that throws counts as unreachable, not as a stuck read', async () => {
    const handle = readEach(['bad'], feedFilter(), () => { throw new Error('no socket') }, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect((await handle.done).get('bad')).toBe('unreachable')
  })
})

describe('createFeed', () => {
  it('keeps the newest event per address, whichever relay sent it and in whatever order', async () => {
    const older = obj('chair', 10, PK, 'old chair')
    const newer = obj('chair', 20, PK, 'new chair')
    const { subscribe } = relays({ r1: { events: [newer], delay: 5 }, r2: { events: [older], delay: 30 } })
    let last: FeedState | null = null
    const feed = createFeed({ relays: ['r1', 'r2'], subscribe, onChange: (s) => { last = s } })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(100)
    await p
    expect(last!.objects.map((o) => o.shard.name)).toEqual(['new chair'])
    // Where it was read from, for a reference's relay hint.
    expect(last!.objects[0].seen).toEqual(['r1'])
  })

  it('pages each relay on its own cursor, so a busy relay never makes a quiet one skip objects', async () => {
    // Busy: ten objects at times 100..91. Quiet: three, at 95, 50 and 10.
    const busy = Array.from({ length: 10 }, (_, i) => obj(`b${i}`, 100 - i))
    const quiet = [obj('q0', 95, PK2), obj('q1', 50, PK2), obj('q2', 10, PK2)]
    const { subscribe, asked } = relays({ busy: { events: busy }, quiet: { events: quiet } })
    let last: FeedState | null = null
    const feed = createFeed({ relays: ['busy', 'quiet'], subscribe, pageSize: 2, onChange: (s) => { last = s } })
    for (let i = 0; i < 20 && !feed.state().exhausted; i++) {
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(200)
      await p
    }
    // Every object, none skipped, newest first.
    expect(last!.objects.map((o) => o.d)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'q0', 'b6', 'b7', 'b8', 'b9', 'q1', 'q2'])
    expect(last!.exhausted).toBe(true)
    // Each relay's second page starts at its own oldest second: the busy
    // one's at 99, the quiet one's at 50. One shared cursor (the lowest, 50)
    // would have sent the busy relay down to 50 and skipped b2 to b9.
    expect(asked.busy[1].until).toBe(99)
    expect(asked.quiet[1].until).toBe(50)
  })

  it('keeps events that share the boundary second with the end of a page', async () => {
    // Two at 99: the first page ends on one of them.
    const events = [obj('a', 100), obj('b', 99), obj('c', 99), obj('d', 98)]
    const { subscribe } = relays({ r: { events } })
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: 2, onChange: () => {} })
    for (let i = 0; i < 6 && !feed.state().exhausted; i++) {
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(10)
      await p
    }
    expect(feed.state().objects.map((o) => o.d).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(feed.state().exhausted).toBe(true)
  })

  it('stops paging a relay that ignores until, instead of asking it forever', async () => {
    const events = [obj('a', 100), obj('b', 90)]
    // A relay that answers the newest page whatever it is asked.
    const subscribe: Subscribe = (_url, _f, h) => { setTimeout(() => { for (const e of events) h.onevent(e); h.oneose() }, 0); return { close: () => {} } }
    const feed = createFeed({ relays: ['deaf'], subscribe, pageSize: 2, onChange: () => {} })
    let pages = 0
    while (!feed.state().exhausted && pages < 10) {
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(10)
      await p
      pages += 1
    }
    expect(feed.state().exhausted).toBe(true)
    expect(pages).toBeLessThanOrEqual(3)
  })

  it('a relay that runs out its time with nothing is a miss, not finished: it ends after two', async () => {
    const { subscribe } = relays({ mute: { events: [], noEose: true } })
    const feed = createFeed({ relays: ['mute'], subscribe, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS + 10)
    await p
    expect(feed.state().exhausted).toBe(false)
    p = feed.more()
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS + 10)
    await p
    expect(feed.state().exhausted).toBe(true)
  })

  it('a relay that first answers after the read deadline gets its objects on the next page (verification review)', async () => {
    let asks = 0
    const events = Array.from({ length: 5 }, (_, i) => obj(`s${i}`, 1000 - i))
    // Cold: the first answer comes 7 s after the ask; warm after that.
    const subscribe: Subscribe = (_url, f, h) => {
      const late = f.kinds.includes(5) ? 0 : asks++ === 0 ? 7000 : 50
      const t = setTimeout(() => { for (const e of answer(events, f)) h.onevent(e); h.oneose() }, late)
      return { close: () => clearTimeout(t) }
    }
    const feed = createFeed({ relays: ['slow'], subscribe, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(8000)
    await p
    expect(feed.state().exhausted).toBe(false)
    p = feed.more()
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(feed.state().objects).toHaveLength(5)
  })

  it('a signer that takes longer than auth plus the read gets the relay read on the next page, auth now cached', async () => {
    let authed = false
    const auth = (): Promise<void> => (authed ? Promise.resolve() : new Promise((r) => setTimeout(() => { authed = true; r() }, 25000)))
    const events = Array.from({ length: 3 }, (_, i) => obj(`g${i}`, 1000 - i))
    // A gated relay answers only once authenticated.
    const subscribe: Subscribe = (_url, f, h) => {
      let closed = false
      const go = (): void => { if (!closed) { for (const e of answer(events, f)) h.onevent(e); h.oneose() } }
      const iv = setInterval(() => { if (authed) { clearInterval(iv); go() } }, 100)
      return { close: () => { closed = true; clearInterval(iv) } }
    }
    const feed = createFeed({ relays: ['gated'], subscribe, read: { auth }, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(30000)
    await p
    expect(feed.state().exhausted).toBe(false)
    p = feed.more()
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(feed.state().objects).toHaveLength(3)
  })

  it('asks a relay it could not reach once more, and leaves it out after a second miss', async () => {
    const { subscribe, asked } = relays({ flaky: { events: [obj('a', 5)] }, ok: { events: Array.from({ length: 4 }, (_, i) => obj(`o${i}`, 50 - i)) } })
    let tries = 0
    const connect = (url: string): Promise<boolean> => (url === 'flaky' ? Promise.resolve(++tries > 1) : Promise.resolve(true))
    const feed = createFeed({ relays: ['flaky', 'ok'], subscribe, pageSize: 2, read: { connect }, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    // Missed once: still asked on the next page, and read this time.
    p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(asked.flaky).toHaveLength(1)
    expect(feed.state().objects.some((o) => o.d === 'a')).toBe(true)
  })

  it('leaves out a relay that misses twice in a row', async () => {
    const { subscribe } = relays({ down: { events: [] } })
    const feed = createFeed({ relays: ['down'], subscribe, read: { connect: () => Promise.resolve(false) }, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(feed.state().exhausted).toBe(false)
    p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(feed.state().exhausted).toBe(true)
  })

  it('stops asking a relay once a short page brings nothing new', async () => {
    const { subscribe, asked } = relays({ r: { events: [obj('a', 5)] } })
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: 3, onChange: () => {} })
    let p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    // Short, but it brought something: asked once more, past its oldest second.
    expect(feed.state().exhausted).toBe(false)
    p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(asked.r.map((f) => f.until)).toEqual([undefined, 4])
    expect(feed.state().exhausted).toBe(true)
    await feed.more()
    expect(asked.r).toHaveLength(2)
  })

  it('an empty first page ends the relay at once', async () => {
    const { subscribe, asked } = relays({ r: { events: [] } })
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: 3, onChange: () => {} })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(feed.state().exhausted).toBe(true)
    expect(asked.r).toHaveLength(1)
  })

  it('keeps paging past a page the client pool cut short by dropping events that failed verification', async () => {
    // Six objects at 100..95; the two at 99 and 98 carry bad signatures, and
    // the pool drops them before the feed sees them, as nostr-tools does.
    const events = Array.from({ length: 6 }, (_, i) => obj(`v${i}`, 100 - i))
    const forged = new Set([events[1].id, events[2].id])
    const asked: FeedFilter[] = []
    const subscribe: Subscribe = (_url, f, h) => {
      if (!f.kinds.includes(5)) asked.push(f as FeedFilter)
      setTimeout(() => { for (const e of answer(events, f)) if (!forged.has(e.id)) h.onevent(e); h.oneose() }, 0)
      return { close: () => {} }
    }
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: 3, onChange: () => {} })
    for (let i = 0; i < 6 && !feed.state().exhausted; i++) {
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(10)
      await p
    }
    // The relay's first page (100, 99, 98) reached the feed as one event; the
    // feed still read on to 97, 96 and 95.
    expect(feed.state().objects.map((o) => o.d)).toEqual(['v0', 'v3', 'v4', 'v5'])
    expect(feed.state().exhausted).toBe(true)
    expect(asked[1].until).toBe(99)
  })
})

describe('deletions (NIP-09)', () => {
  const del = (pubkey: string, createdAt: number, tags: string[][]): FeedEvent => { n += 1; return { id: `d${n}`.padStart(64, '0'), pubkey, created_at: createdAt, kind: 5, tags, content: '' } }

  it('isDeleted: by id, or by address at or after the event; never by someone else', () => {
    const o = objectFromEvent(obj('lamp', 100))!
    expect(isDeleted(o, [del(PK, 50, [['e', o.id]])])).toBe(true)
    expect(isDeleted(o, [del(PK, 100, [['a', o.address]])])).toBe(true)
    // An address deletion older than this version does not remove it.
    expect(isDeleted(o, [del(PK, 99, [['a', o.address]])])).toBe(false)
    expect(isDeleted(o, [del(PK2, 200, [['e', o.id], ['a', o.address]])])).toBe(false)
  })

  it('the feed hides an object its author deleted, reading deletions with one tag filter each', async () => {
    const kept = obj('kept', 100)
    const gone = obj('gone', 90)
    const byAddress = obj('old', 80)
    const events = [kept, gone, byAddress, del(PK, 95, [['e', gone.id]]), del(PK, 85, [['a', `33331:${PK}:old`]])]
    const seen: ReadFilter[] = []
    const subscribe: Subscribe = (_url, f, h) => { seen.push(f); setTimeout(() => { for (const e of answer(events, f)) h.onevent(e); h.oneose() }, 0); return { close: () => {} } }
    const feed = createFeed({ relays: ['r'], subscribe, onChange: () => {} })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(feed.state().objects.map((o) => o.d)).toEqual(['kept'])
    for (const f of seen) expect(Object.keys(f).filter((k) => k.startsWith('#')).length).toBeLessThanOrEqual(1)
  })

  const item = (d: string, pubkey = PK, id = `${(n += 1)}`.padStart(64, '0')): { pubkey: string; address: string; id: string } => ({ pubkey, address: `33331:${pubkey}:${d}`, id })
  const bytes = (f: DeletionFilter): number => [...(f['#a'] ?? f['#e'] ?? []), ...f.authors].reduce((sum, v) => sum + new TextEncoder().encode(v).length, 0)

  it('deletionFilters: chunks of at most DELETION_FILTER_VALUES values, each naming only its own authors', () => {
    const items = Array.from({ length: 250 }, (_, i) => item(`o${i}`, i < 120 ? PK : PK2))
    const filters = deletionFilters(items)
    const byA = filters.filter((f) => f['#a'])
    const byE = filters.filter((f) => f['#e'])
    expect(byA.map((f) => f['#a']!.length)).toEqual([100, 100, 50])
    expect(byE.map((f) => f['#e']!.length)).toEqual([100, 100, 50])
    // Every address and id once, in some chunk.
    expect(byA.flatMap((f) => f['#a']!)).toEqual(items.map((o) => o.address))
    expect(byE.flatMap((f) => f['#e']!)).toEqual(items.map((o) => o.id))
    expect(byA.map((f) => f.authors)).toEqual([[PK], [PK, PK2], [PK2]])
    for (const f of filters) expect(Object.keys(f).filter((k) => k.startsWith('#'))).toHaveLength(1)
    expect(deletionFilters([])).toEqual([])
  })

  it('deletionFilters: long addresses split by bytes; an address past DELETION_ADDRESS_MAX is checked by id only', () => {
    const long = Array.from({ length: 40 }, (_, i) => item(`${i}`.padEnd(DELETION_ADDRESS_MAX - 80, 'x')))
    const huge = item('h'.repeat(DELETION_ADDRESS_MAX * 64))
    const filters = deletionFilters([...long, huge])
    const byA = filters.filter((f) => f['#a'])
    expect(byA.length).toBeGreaterThan(1)
    for (const f of filters) expect(bytes(f)).toBeLessThanOrEqual(DELETION_FILTER_BYTES)
    expect(byA.flatMap((f) => f['#a']!)).toEqual(long.map((o) => o.address))
    // Never named by address, but its id is still read.
    expect(filters.some((f) => f['#e']?.includes(huge.id))).toBe(true)
    expect(DELETION_FILTER_VALUES).toBe(100)
  })

  it('the feed reads every chunk, and hides an object deleted by an address in a later chunk', async () => {
    const page = 150
    const objs = Array.from({ length: page }, (_, i) => obj(`c${i}`, 1000 - i))
    const last = objs[page - 1]
    const events = [...objs, del(PK, 2000, [['a', `33331:${PK}:${last.tags[0][1]}`]])]
    const deletionReads: DeletionFilter[] = []
    const subscribe: Subscribe = (_url, f, h) => {
      if (f.kinds.includes(5)) deletionReads.push(f as DeletionFilter)
      setTimeout(() => { for (const e of answer(events, f)) h.onevent(e); h.oneose() }, 0)
      return { close: () => {} }
    }
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: page, onChange: () => {} })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(50)
    await p
    expect(deletionReads.map((f) => (f['#a'] ?? f['#e'])!.length)).toEqual([100, 50, 100, 50])
    expect(feed.state().objects).toHaveLength(page - 1)
    expect(feed.state().objects.some((o) => o.d === last.tags[0][1])).toBe(false)
  })
})

/**
 * An object for sale (NIP-FF-1, NIP-FF-2), signed with a throwaway key made
 * for this test and thrown away. It has never been sent to a relay.
 */
const LISTING: FeedEvent & { sig: string } = {
  kind: 33331,
  created_at: 1792000000,
  content: 'A brass orrery, three rings on a walnut base. Buy it to place it anywhere in cyberspace.',
  tags: [
    ['d', '6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40'],
    ['encrypted', 'aes-256-gcm', 'dGVzdC1maXh0dXJlLWNpcGhlcnRleHQtbm90LXJlYWwtZGF0YQ==', 'https://api.fanfares.live/request-key'],
    ['price', '2100', 'SATS'],
    ['title', 'Brass Orrery'],
    ['name', 'orrery'],
    ['subject', '3D object'],
    ['a', '31990:d7d8109ee43657ce6056ada4653006bbb641f31e50e85243681c2724507811ec:Fanfares'],
    ['zap', '0000000000000000000000000000000000000000000000000000000000000001', 'wss://relay.example.com', '1'],
    ['imeta', `url https://cdn.example.com/${'a1'.repeat(32)}.gif`, 'm image/gif', `x ${'a1'.repeat(32)}`, 'dim 320x320', 'alt A brass orrery turning on its base'],
    ['imeta', `url https://cdn.example.com/${'b2'.repeat(32)}.png`, 'm image/png', `x ${'b2'.repeat(32)}`, 'dim 320x320', 'alt A brass orrery'],
    ['alt', 'A 3D object for sale: Brass Orrery, 2100 sats'],
  ],
  pubkey: '54cf3d41a8c1a0c6d3a2134ecef5fe43a51ff8328014244dd38f2bc9f543f241',
  id: '00d52d317f8b9d12853775c2ecf87025ff3d1a91ee5590924d79ec3fffff0964',
  sig: 'd84182210fb628b498dcb658a8ca8cb77ccd2476ea7ee463751ec9e2583e1fb3d250813a900a9707fd929eaea59b9d6e67b7f176da636fc1ed88d6ff9d0081fb',
}

/** The fixture with tags changed: `[name, ...]` replaces the first tag of that name, and `[name]` alone removes every one. */
function changed(...edits: string[][]): FeedEvent {
  let tags = LISTING.tags.map((t) => [...t])
  for (const e of edits) {
    const at = tags.findIndex((t) => t[0] === e[0])
    if (e.length === 1) tags = tags.filter((t) => t[0] !== e[0])
    else if (at >= 0) tags[at] = e
    else tags.push(e)
  }
  return { ...LISTING, tags }
}

describe('objects for sale (NIP-FF-1 key service in encrypted[3])', () => {
  it('reads a listing: title, price, key service, both pictures, alt, and what an naddr needs', () => {
    const l = listingFromEvent(LISTING)!
    expect(l).not.toBeNull()
    expect(isListing(l)).toBe(true)
    expect(l.type).toBe('listing')
    expect(l.title).toBe('Brass Orrery')
    expect(l.priceSats).toBe(2100)
    expect(l.keyService).toBe('https://api.fanfares.live/request-key')
    expect(l.preview).toEqual({ url: `https://cdn.example.com/${'a1'.repeat(32)}.gif`, mime: 'image/gif', width: 320, height: 320, sha256: 'a1'.repeat(32), alt: 'A brass orrery turning on its base' })
    expect(l.thumb?.url).toBe(`https://cdn.example.com/${'b2'.repeat(32)}.png`)
    expect(l.thumb?.mime).toBe('image/png')
    expect(l.alt).toBe('A brass orrery turning on its base')
    expect(l.text).toBe(LISTING.content)
    expect(l.address).toBe(`33331:${LISTING.pubkey}:6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40`)
    expect(listingPointer({ ...l, seen: ['wss://a', 'wss://b', 'wss://c', 'wss://d'] })).toEqual({ kind: 33331, pubkey: LISTING.pubkey, identifier: l.d, relays: ['wss://a', 'wss://b', 'wss://c'] })
  })

  it('falls back to the name tag for a title, and to the alt tag when no picture has alt text', () => {
    const l = listingFromEvent(changed(['title'], ['imeta']))!
    expect(l.title).toBe('orrery')
    expect(l.preview).toBeUndefined()
    expect(l.thumb).toBeUndefined()
    expect(l.alt).toBe('A 3D object for sale: Brass Orrery, 2100 sats')
  })

  it('never reads a listing as geometry: objectFromEvent refuses it, even when its content parses as a payload', () => {
    expect(objectFromEvent(LISTING)).toBeNull()
    const looksLikeAShape = { ...LISTING, content: payload('decoy') }
    expect(objectFromEvent(looksLikeAShape)).toBeNull()
    expect(listingFromEvent(looksLikeAShape)?.text).toBe(payload('decoy'))
  })

  it('an object hidden at a place (encrypted[3] cyberspace:region) is still neither an object nor a listing', () => {
    const hidden = changed(['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region'])
    expect(listingFromEvent(hidden)).toBeNull()
    expect(objectFromEvent(hidden)).toBeNull()
  })

  it('refuses a malformed listing: no price, a price that is not a positive whole number of sats, http, no d', () => {
    expect(listingFromEvent(changed(['price']))).toBeNull()
    for (const bad of ['0', '-5', '1.5', '21e3', '', ' 21', '99999999999999999']) expect(listingFromEvent(changed(['price', bad, 'SATS'])), bad).toBeNull()
    expect(listingFromEvent(changed(['price', '2100', 'USD']))).toBeNull()
    // The unit is required and is the literal SATS (NIP-FF-2).
    for (const unit of [undefined, 'sats', 'Sats', 'SAT', 'BTC']) expect(listingFromEvent(changed(unit === undefined ? ['price', '2100'] : ['price', '2100', unit])), String(unit)).toBeNull()
    expect(listingFromEvent({ ...LISTING, tags: [...LISTING.tags, ['price', '1', 'SATS']] })).toBeNull()
    // At most every bitcoin there will ever be.
    expect(MAX_PRICE_SATS).toBe(2_100_000_000_000_000)
    expect(listingFromEvent(changed(['price', '2100000000000000', 'SATS']))?.priceSats).toBe(2_100_000_000_000_000)
    for (const over of ['2100000000000001', '9007199254740991', '9007199254740992']) expect(listingFromEvent(changed(['price', over, 'SATS'])), over).toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', 'x', 'http://keys.example.com/request-key']))).toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', 'x', 'https://user:pw@keys.example.com/']))).toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', 'x']))).toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', 'x', 'not a url']))).toBeNull()
    expect(listingFromEvent(changed(['d']))).toBeNull()
    expect(listingFromEvent(changed(['d', '']))).toBeNull()
    expect(listingFromEvent({ ...LISTING, kind: 30023 })).toBeNull()
  })

  it('lists an object for sale whoever sells its key, over https only', () => {
    const at = (url: string): FeedEvent => changed(['encrypted', 'aes-256-gcm', 'dGVzdC1maXh0dXJlLWNpcGhlcnRleHQtbm90LXJlYWwtZGF0YQ==', url])
    for (const ok of ['https://api.fanfares.live/request-key', 'https://staging.api.fanfares.live/request-key', 'https://keys.example.com/request-key', 'https://sno.example.org/sell?item=1']) {
      expect(listingFromEvent(at(ok))?.keyService, ok).toBe(ok)
    }
    for (const bad of ['http://api.fanfares.live/request-key', 'https://user:pass@keys.example.com/request-key', 'javascript:alert(1)', 'data:text/plain,x', 'cyberspace:region', 'request-key', '']) {
      expect(listingFromEvent(at(bad)), bad).toBeNull()
    }
  })

  it('needs NIP-FF-1 and a price, not the rest of NIP-FF-2: one encrypted tag, aes-256-gcm, a ciphertext', () => {
    const enc = LISTING.tags.find((t) => t[0] === 'encrypted')!
    // A second encrypted tag naming a place: hidden, never a listing, whichever comes first.
    expect(listingFromEvent({ ...LISTING, tags: [...LISTING.tags, ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region']] })).toBeNull()
    expect(listingFromEvent({ ...LISTING, tags: [['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region'], ...LISTING.tags] })).toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'chacha20', enc[2], enc[3]]))).toBeNull()
    for (const ct of ['', 'not base64!', 'dGVzdA==', 'dGVzdC1maXh0dXJlLWNpcGhlcnRleHQtbm90LXJlYWwtZGF0YQ']) expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', ct, enc[3]])), ct).toBeNull()
    // Fanfares' own rules (a zap recipient, a UUIDv4 d) are its key service's to enforce, not a reader's.
    expect(listingFromEvent(changed(['zap']))?.title).toBe('Brass Orrery')
    expect(listingFromEvent(changed(['d', 'brass-orrery']))?.d).toBe('brass-orrery')
    expect(listingFromEvent(changed(['d', '6f1c2a8e-4b7d-1e0a-9c3f-2d5e8b1a7c40']))?.d).toBe('6f1c2a8e-4b7d-1e0a-9c3f-2d5e8b1a7c40')
  })

  it('a d is printable ASCII and at most 128 bytes, so an naddr can always be made from it (the crash a 4000-character d caused)', () => {
    expect(listingFromEvent(changed(['d', 'x'.repeat(128)]))?.d).toHaveLength(128)
    for (const d of ['x'.repeat(129), 'x'.repeat(4000), 'x'.repeat(1_000_000), '', 'caf\u00e9', 'tab\there', 'new\nline', '\u202eevil', '\u{1F600}']) {
      expect(listingFromEvent(changed(['d', d])), JSON.stringify(d.slice(0, 20))).toBeNull()
    }
    // The first d is the address, as for any addressable event.
    expect(listingFromEvent({ ...LISTING, tags: [...LISTING.tags, ['d', 'second']] })?.d).toBe(LISTING.tags[0][1])
  })

  it('shows only https pictures of an image type, and never an encrypted file', () => {
    const only = (imeta: string[]): FeedEvent => ({ ...LISTING, tags: [...LISTING.tags.filter((t) => t[0] !== 'imeta'), ['imeta', ...imeta]] })
    expect(listingFromEvent(only(['url http://cdn.example.com/a.gif', 'm image/gif']))?.preview).toBeUndefined()
    expect(listingFromEvent(only(['url javascript:alert(1)', 'm image/gif']))?.preview).toBeUndefined()
    expect(listingFromEvent(only(['url data:image/gif;base64,R0lG', 'm image/gif']))?.preview).toBeUndefined()
    expect(listingFromEvent(only(['url https://cdn.example.com/a.svg', 'm image/svg+xml']))?.thumb).toBeUndefined()
    expect(listingFromEvent(only(['url https://cdn.example.com/a.html', 'm text/html']))?.thumb).toBeUndefined()
    expect(listingFromEvent(only(['url https://cdn.example.com/a.gif']))?.preview).toBeUndefined()
    expect(listingFromEvent(only(['url https://cdn.example.com/a.gif.enc', 'm image/gif', 'encrypted aes-256-gcm']))?.preview).toBeUndefined()
    expect(listingFromEvent(only(['url https://cdn.example.com/a.webp', 'm image/webp', 'dim 0x9']))?.thumb).toEqual({ url: 'https://cdn.example.com/a.webp', mime: 'image/webp' })
    // A picture that is not https leaves the listing listed, without the picture.
    expect(listingFromEvent(only(['url http://cdn.example.com/a.gif', 'm image/gif']))?.title).toBe('Brass Orrery')
  })

  it('the feed carries listings apart from objects, leaves hidden and malformed ones out, and leaves public objects as they were', async () => {
    const pub = obj('chair', 1792000100)
    const hidden = { ...changed(['encrypted', 'aes-256-gcm', 'x', 'cyberspace:region'], ['d', 'hid']), id: 'h'.padStart(64, '0') }
    const http = { ...changed(['encrypted', 'aes-256-gcm', 'x', 'http://keys.example.com/'], ['d', 'plain']), id: 'p'.padStart(64, '0') }
    const priceless = { ...changed(['price'], ['d', 'free']), id: 'f'.padStart(64, '0') }
    const { subscribe } = relays({ 'wss://r': { events: [pub, LISTING, hidden, http, priceless] } })
    const states: FeedState[] = []
    const feed = createFeed({ relays: ['wss://r'], subscribe, onChange: (s) => states.push(s) })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    const s = feed.state()
    expect(s.objects.map((o) => o.d)).toEqual(['chair'])
    // A public object is read exactly as before: the same fields, no `type`, the same shape.
    const { shard, ...rest } = s.objects[0]
    const { shard: alone, ...want } = objectFromEvent(pub)!
    expect(rest).toEqual({ ...want, seen: ['wss://r'] })
    expect(shard.vertices).toEqual(alone.vertices)
    expect(s.listings.map((l) => l.title)).toEqual(['Brass Orrery'])
    expect(s.listings[0].seen).toEqual(['wss://r'])
    expect(feedItems(s).map((i) => (isListing(i) ? `sale:${i.d}` : i.d))).toEqual(['chair', `sale:${LISTING.tags[0][1]}`])
    expect(states.every((st) => Array.isArray(st.listings))).toBe(true)
  })

  it('a listing its author deleted is not shown, and a newer public version of the same address replaces it', async () => {
    const d = LISTING.tags[0][1]
    const del: FeedEvent = { id: 'e'.padStart(64, '0'), pubkey: LISTING.pubkey, created_at: LISTING.created_at + 1, kind: 5, tags: [['a', `33331:${LISTING.pubkey}:${d}`]], content: '' }
    const run = async (events: FeedEvent[]): Promise<FeedState> => {
      const subscribe: Subscribe = (_url, f, h) => { setTimeout(() => { for (const e of answer(events, f)) h.onevent(e); h.oneose() }, 0); return { close: () => {} } }
      const feed = createFeed({ relays: ['r'], subscribe, onChange: () => {} })
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(10)
      await p
      return feed.state()
    }
    expect((await run([LISTING, del])).listings).toEqual([])
    const unsealed = { ...obj(d, LISTING.created_at + 5, LISTING.pubkey, 'orrery') }
    const s = await run([LISTING, unsealed])
    expect(s.listings).toEqual([])
    expect(s.objects.map((o) => o.d)).toEqual([d])
  })
})

describe("where a listing is bought: the seller's app (NIP-89)", () => {
  const APP_PK = 'e1'.repeat(32)
  const NADDR = 'naddr1test'
  /** A listing published with an app that names itself in a client tag. */
  const withApp = (keyService = 'https://keys.example.com/request-key'): FeedEvent => changed(
    ['encrypted', 'aes-256-gcm', LISTING.tags[1][2], keyService],
    ['client', 'Sno Shop', `31990:${APP_PK}:snoshop`, 'wss://relay.snoshop.example'],
  )
  /** The app's handler (kind 31990), as a relay would send it. Signatures are the client's to check. */
  const handler = (over: Partial<FeedEvent> & { tags?: string[][] } = {}): FeedEvent => ({
    id: 'f'.repeat(64), pubkey: APP_PK, created_at: 1792000000, kind: 31990,
    content: JSON.stringify({ name: 'Sno Shop', display_name: 'The Sno Shop' }),
    tags: [['d', 'snoshop'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr'], ['web', 'https://shop.snoshop.example/e/<bech32>', 'nevent']],
    ...over,
  })

  it('reads the app from the client tag, else from an a tag naming a 31990, never from a placement', () => {
    expect(listingFromEvent(withApp())!.app).toEqual({ address: `31990:${APP_PK}:snoshop`, pubkey: APP_PK, d: 'snoshop', name: 'Sno Shop', relay: 'wss://relay.snoshop.example' })
    expect(listingFromEvent(LISTING)!.app).toEqual({ address: '31990:d7d8109ee43657ce6056ada4653006bbb641f31e50e85243681c2724507811ec:Fanfares', pubkey: 'd7d8109ee43657ce6056ada4653006bbb641f31e50e85243681c2724507811ec', d: 'Fanfares' })
    expect(listingApp([['a', `33331:${APP_PK}:chair`]])).toBeUndefined()
    expect(listingApp([['client', 'Just a name']])).toBeUndefined()
    expect(listingApp([['client', 'X', `31990:${APP_PK}:x`, 'http://not-a-relay']])?.relay).toBeUndefined()
    expect(listingApp([null as unknown as string[], ['client', 5 as unknown as string, `31990:${APP_PK}:x`]])).toEqual({ address: `31990:${APP_PK}:x`, pubkey: APP_PK, d: 'x' })
    expect(listingApp([['client', 'X', 5 as unknown as string], ['a', 7 as unknown as string]])).toBeUndefined()
    expect(handlerFilter({ pubkey: APP_PK, d: 'snoshop' })).toEqual({ kinds: [31990], authors: [APP_PK], '#d': ['snoshop'], limit: 5 })
  })

  it("a valid handler: its naddr page, its display name, and the link's own domain", () => {
    const link = sellerLink(listingFromEvent(withApp())!, NADDR, handler())
    expect(link).toEqual({ label: 'Sno Shop', url: 'https://shop.snoshop.example/item/naddr1test', domain: 'snoshop.example' })
    // display_name when there is no name; the client tag's name when the content has neither; long names cut.
    expect(sellerLink(listingFromEvent(withApp())!, NADDR, handler({ content: JSON.stringify({ display_name: 'Display' }) })).label).toBe('Display')
    expect(sellerLink(listingFromEvent(withApp())!, NADDR, handler({ content: '' })).label).toBe('Sno Shop')
    const long = sellerLink(listingFromEvent(withApp())!, NADDR, handler({ content: JSON.stringify({ name: 'A Very Long Name For A Shop That Sells Things' }) })).label
    expect(long.length).toBeLessThanOrEqual(SELLER_LABEL_MAX)
    expect(long.endsWith('…')).toBe(true)
    // An untyped web template counts; an nevent one does not.
    expect(sellerLink(listingFromEvent(withApp())!, NADDR, handler({ tags: [['d', 'snoshop'], ['k', '33331'], ['web', 'https://any.example/<bech32>']] })).url).toBe('https://any.example/naddr1test')
    expect(sellerLink(listingFromEvent(withApp())!, NADDR, handler({ tags: [['d', 'snoshop'], ['k', '33331'], ['web', 'https://any.example/<bech32>', 'nevent']] })).url).toBe('https://njump.me/naddr1test')
  })

  it("a handler by the wrong key, for another d, of another kind, or without k 33331 is ignored: the fallback stands", () => {
    const l = listingFromEvent(withApp())!
    const fallback = { label: 'example.com', url: 'https://njump.me/naddr1test', domain: 'njump.me' }
    expect(sellerLink(l, NADDR, handler({ pubkey: 'e2'.repeat(32) }))).toEqual(fallback)
    expect(sellerLink(l, NADDR, handler({ tags: [['d', 'other'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']] }))).toEqual(fallback)
    expect(sellerLink(l, NADDR, handler({ kind: 31989 }))).toEqual(fallback)
    expect(sellerLink(l, NADDR, handler({ tags: [['d', 'snoshop'], ['k', '30023'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']] }))).toEqual(fallback)
    expect(sellerLink(l, NADDR, handler({ tags: [['d', 'snoshop'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']] }))).toEqual(fallback)
    expect(sellerLink(l, NADDR, null)).toEqual(fallback)
  })

  it('a web template that is not https, or has no <bech32>, is ignored', () => {
    const l = listingFromEvent(withApp())!
    for (const web of ['http://shop.snoshop.example/<bech32>', 'javascript:alert("<bech32>")', 'https://user:pw@shop.snoshop.example/<bech32>', 'https://shop.snoshop.example/item']) {
      expect(sellerLink(l, NADDR, handler({ tags: [['d', 'snoshop'], ['k', '33331'], ['web', web, 'naddr']] })).url, web).toBe('https://njump.me/naddr1test')
    }
  })

  it("no handler and a Fanfares key service: Fanfares' naddr page", () => {
    for (const ks of ['https://api.fanfares.live/request-key', 'https://staging.api.fanfares.live/request-key']) {
      expect(sellerLink(listingFromEvent(withApp(ks))!, NADDR)).toEqual({ label: 'Fanfares', url: 'https://fanfares.io/naddr/naddr1test', domain: 'fanfares.io' })
    }
    expect(sellerLink(listingFromEvent(LISTING)!, NADDR, null).label).toBe('Fanfares')
  })

  it("no handler and another key service: njump, labelled with the key service's domain, the domain beside it njump's own", () => {
    expect(sellerLink(listingFromEvent(withApp('https://keys.sno.example.co.uk/request-key'))!, NADDR)).toEqual({ label: 'example.co.uk', url: 'https://njump.me/naddr1test', domain: 'njump.me' })
    // A lookalike host is named by its own registrable domain, never by the name it hides behind.
    expect(sellerLink(listingFromEvent(withApp('https://api.fanfares.live.evil.example/request-key'))!, NADDR).label).toBe('evil.example')
  })

  it('the registrable domain: last two labels, three under a listed shared suffix, the host for an IP', () => {
    expect(registrableDomain('https://shop.snoshop.example/x')).toBe('snoshop.example')
    expect(registrableDomain('https://fanfares.io/naddr/x')).toBe('fanfares.io')
    expect(registrableDomain('https://evil.github.io/x')).toBe('evil.github.io')
    expect(registrableDomain('https://a.b.example.co.uk/')).toBe('example.co.uk')
    expect(registrableDomain('https://203.0.113.9/x')).toBe('203.0.113.9')
    expect(registrableDomain('not a url')).toBe('')
  })

  it('a country second level is a suffix, not a name; ports, IDNs, IPs and a trailing dot read as the host the URL opens', () => {
    expect(registrableDomain('https://shop.co.il/')).toBe('shop.co.il')
    expect(registrableDomain('https://a.shop.com.pl/')).toBe('shop.com.pl')
    expect(registrableDomain('https://a.co.example/')).toBe('co.example')
    expect(registrableDomain('https://fanfares.io:8443/x')).toBe('fanfares.io')
    expect(registrableDomain('https://shop.fánfares.io/')).toBe('xn--fnfares-hwa.io')
    expect(registrableDomain('https://0x7f.1/')).toBe('127.0.0.1')
    expect(registrableDomain('https://[::1]:8080/')).toBe('[::1]')
    expect(registrableDomain('https://fanfares.io./')).toBe('fanfares.io')
    expect(registrableDomain('https://api.fanfares.live.evil.example/')).toBe('evil.example')
  })

  it('the domain is the URL the template opens, however the template is written', () => {
    const l = listingFromEvent(withApp())!
    const web = (w: string): ReturnType<typeof sellerLink> => sellerLink(l, NADDR, handler({ tags: [['d', 'snoshop'], ['k', '33331'], ['web', w, 'naddr']] }))
    // Backslashes are slashes in an https URL, so this opens evil.example, and says so.
    expect(web('https:\\\\evil.example\\<bech32>')).toMatchObject({ url: 'https://evil.example/naddr1test', domain: 'evil.example' })
    // The naddr as the host is a host: shown as the domain, not hidden.
    expect(web('https://<bech32>/')).toMatchObject({ url: 'https://naddr1test/', domain: 'naddr1test' })
    expect(web('https://fanfares.io@evil.example/<bech32>').url).toBe('https://njump.me/naddr1test')
    expect(web('<bech32>').url).toBe('https://njump.me/naddr1test')
  })

  it('a label loses direction and invisible characters, and is cut by character, never through an emoji', () => {
    const l = listingFromEvent(withApp())!
    const named = (name: string): string => sellerLink(l, NADDR, handler({ content: JSON.stringify({ name }) })).label
    expect(named('\u202eoi.serafnaf\u2066\u061c\ufeff\u00ad\u2060x')).toBe('oi.serafnafx')
    // Exactly the bound is kept whole; one past it is cut to the bound, the ellipsis included.
    expect(named(`${'a'.repeat(SELLER_LABEL_MAX - 2)}\u{1F600}\u{1F600}`)).toBe(`${'a'.repeat(SELLER_LABEL_MAX - 2)}\u{1F600}\u{1F600}`)
    const cut = named(`${'a'.repeat(SELLER_LABEL_MAX - 2)}\u{1F600}\u{1F600}\u{1F600}`)
    expect(cut).toBe(`${'a'.repeat(SELLER_LABEL_MAX - 2)}\u{1F600}…`)
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(cut)).toBe(false)
    expect(Array.from(named('\u{1F600}'.repeat(100))).length).toBe(SELLER_LABEL_MAX)
  })

  it('a handler that is not well formed is no handler, and never throws', () => {
    const l = listingFromEvent(withApp())!
    const bad = [
      handler({ tags: [null as unknown as string[], ['d', 'snoshop'], ['k', '33331'], ['web', 'https://x.example/<bech32>']] }),
      handler({ tags: [['d', 'snoshop'], ['k', '33331'], ['web', 5 as unknown as string]] }),
      handler({ content: 5 as unknown as string }),
      handler({ tags: 'x' as unknown as string[][] }),
    ]
    for (const h of bad) expect(sellerLink(l, NADDR, h).url).toBe('https://njump.me/naddr1test')
  })
})

describe('hostile events never throw', () => {
  it('a tag holding a number, a null or an object is refused, as a listing and as an object', () => {
    const edits: string[][][] = [
      [['title', 5 as unknown as string]],
      [['client', 5 as unknown as string, `31990:${'e1'.repeat(32)}:x`]],
      [['imeta', 5 as unknown as string, null as unknown as string]],
      [['price', 100 as unknown as string, 'SATS']],
    ]
    for (const e of edits) {
      const ev = changed(...e)
      expect(() => listingFromEvent(ev), JSON.stringify(e)).not.toThrow()
      expect(listingFromEvent(ev)).toBeNull()
    }
    const nulled = { ...LISTING, tags: [null as unknown as string[], ...LISTING.tags] }
    expect(listingFromEvent(nulled)).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), tags: [null as unknown as string[], ['d', 'a']] })).toBeNull()
    expect(objectFromEvent({ ...obj('a', 1), content: 5 as unknown as string })).toBeNull()
  })

  it('a ciphertext of megabytes is read without overflowing the regex stack', () => {
    const big = 'A'.repeat(12 << 20)
    expect(() => listingFromEvent(changed(['encrypted', 'aes-256-gcm', big, 'https://keys.example.com/k']))).not.toThrow()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', big, 'https://keys.example.com/k']))).not.toBeNull()
    expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', `${big}!`, 'https://keys.example.com/k']))).toBeNull()
    for (const bad of ['AAA', 'AAAAA===', '====', 'A===', 'AA=A']) {
      expect(listingFromEvent(changed(['encrypted', 'aes-256-gcm', `${LISTING.tags[1][2]}${bad}`, 'https://keys.example.com/k'])), bad).toBeNull()
    }
  })

  it('a feed with a malformed event still shows the rest', async () => {
    const good = obj('chair', 2)
    const bad = { ...obj('lamp', 3), tags: [['d', 'lamp'], ['title', 5 as unknown as string]] }
    const worse = { ...obj('desk', 4), tags: [null as unknown as string[]] }
    const { subscribe } = relays({ r1: { events: [worse, bad, good] } })
    let last: FeedState | null = null
    const feed = createFeed({ relays: ['r1'], subscribe, onChange: (st) => { last = st } })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(200)
    await p
    expect(last!.objects.map((o) => o.d)).toEqual(['chair'])
    feed.close()
  })
})

describe('credit for a copy (the NIP-18 q tag; ruled 2026-10-08)', () => {
  it('writes and reads back the original address, and is not an a or e tag (those mean placements)', () => {
    const tags = creditTags({ address: `33331:${PK}:chair`, relay: 'wss://relay.example' })
    expect(tags).toEqual([['q', `33331:${PK}:chair`, 'wss://relay.example']])
    expect(tags.some((t) => t[0] === 'a' || t[0] === 'e')).toBe(false)
    const c = readCredit([['d', 'x'], ...tags])
    expect(c).toEqual({ address: `33331:${PK}:chair`, relay: 'wss://relay.example' })
    expect(creditAuthor(c!)).toBe(PK)
  })

  it('adds the p tag naming the author only for a public remix, never by default', () => {
    const credit = { address: `33331:${PK}:chair` }
    expect(creditTags(credit)).toEqual([['q', `33331:${PK}:chair`, '']])
    expect(creditTags(credit, { notify: true })).toEqual([['q', `33331:${PK}:chair`, ''], ['p', PK]])
    // An address that does not name a key gets no p.
    expect(creditTags({ address: '33331:nope:chair' }, { notify: true })).toEqual([['q', '33331:nope:chair', '']])
  })

  it('a remixed model remembers its credit beside the format, and the payload never carries it', () => {
    const model = objectFromEvent(obj('chair', 1))!.shard
    expect(creditOf(model)).toBeUndefined()
    const remix = withCredit(model, { address: `33331:${PK}:chair` })
    expect(creditOf(remix)).toEqual({ address: `33331:${PK}:chair` })
    // An edit that spreads the model keeps it.
    expect(creditOf({ ...remix, name: 'my chair' })).toEqual({ address: `33331:${PK}:chair` })
    // The wire never sees it: the credit is a tag, not a payload field.
    expect(JSON.stringify(toPayload(remix))).not.toContain('credit')
  })

  it('ignores a q tag that quotes something other than an object', () => {
    expect(readCredit([['q', 'ff'.repeat(32)]])).toBeNull()
    expect(readCredit([])).toBeNull()
  })
})
