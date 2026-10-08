import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECT_DEADLINE_MS, FEED_PAGE, READ_DEADLINE_MS, SNO_KIND, createFeed, creditAuthor, creditTags, feedFilter,
  objectFromEvent, readCredit, readEach, type FeedEvent, type FeedFilter, type FeedState, type Subscribe,
} from './feed.js'

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
function answer(events: FeedEvent[], f: FeedFilter): FeedEvent[] {
  return events
    .filter((e) => f.kinds.includes(e.kind) && (!f.authors || f.authors.includes(e.pubkey)) && (f.until === undefined || e.created_at <= f.until))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit)
}

/**
 * Relays in memory. Each answers after `delay` ms, or never (`hang`), and
 * records every filter it was asked.
 */
function relays(spec: Record<string, { events: FeedEvent[]; delay?: number; hang?: boolean; noEose?: boolean }>): { subscribe: Subscribe; asked: Record<string, FeedFilter[]> } {
  const asked: Record<string, FeedFilter[]> = {}
  const subscribe: Subscribe = (url, filter, h) => {
    const r = spec[url]
    ;(asked[url] ??= []).push(filter)
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
})

describe('readEach: each relay on its own', () => {
  it('paints from a fast relay at once, and one hung relay costs only its connect deadline (snocrash #22)', async () => {
    const { subscribe } = relays({ fast: { events: [obj('a', 10)], delay: 50 }, hung: { events: [] } })
    const got: string[] = []
    const handle = readEach(['fast', 'hung'], feedFilter(), subscribe, (ev, url) => got.push(`${url}:${ev.id}`), {
      // The hung relay never finishes connecting.
      prepare: (url) => (url === 'hung' ? new Promise<boolean>(() => {}) : Promise.resolve(true)),
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
    for (let i = 0; i < 8 && !feed.state().exhausted; i++) {
      const p = feed.more()
      await vi.advanceTimersByTimeAsync(200)
      await p
    }
    // Every object, none skipped, newest first.
    expect(last!.objects.map((o) => o.d)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'q0', 'b6', 'b7', 'b8', 'b9', 'q1', 'q2'])
    expect(last!.exhausted).toBe(true)
    // Each relay's second page starts below its own oldest: the busy one's at
    // 99, the quiet one's at 50. One shared cursor (the lowest, 50) would have
    // sent the busy relay to 49 and skipped b2 to b9.
    expect(asked.busy[1].until).toBe(98)
    expect(asked.quiet[1].until).toBe(49)
  })

  it('stops asking a relay that answered with less than a page', async () => {
    const { subscribe, asked } = relays({ r: { events: [obj('a', 5)] } })
    const feed = createFeed({ relays: ['r'], subscribe, pageSize: 3, onChange: () => {} })
    const p = feed.more()
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(feed.state().exhausted).toBe(true)
    await feed.more()
    expect(asked.r).toHaveLength(1)
  })
})

describe('credit for a copy (proposed: the NIP-18 q tag)', () => {
  it('writes and reads back the original address, and is not an a or e tag (those mean placements)', () => {
    const tags = creditTags({ address: `33331:${PK}:chair`, relay: 'wss://relay.example' })
    expect(tags).toEqual([['q', `33331:${PK}:chair`, 'wss://relay.example']])
    expect(tags.some((t) => t[0] === 'a' || t[0] === 'e')).toBe(false)
    const c = readCredit([['d', 'x'], ...tags])
    expect(c).toEqual({ address: `33331:${PK}:chair`, relay: 'wss://relay.example' })
    expect(creditAuthor(c!)).toBe(PK)
  })

  it('ignores a q tag that quotes something other than an object', () => {
    expect(readCredit([['q', 'ff'.repeat(32)]])).toBeNull()
    expect(readCredit([])).toBeNull()
  })
})
