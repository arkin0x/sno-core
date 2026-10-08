/**
 * feed.ts - published objects, read from relays: the Shard Feed's data layer.
 *
 * Both clients show everyone's published SNO objects (DECK-0003 §3.1, kind
 * 33331), newest first: snocrash on its front page, ONOSENDAI inside the
 * Builder's PLACE OBJECT picker. Each used to read them its own way, and the
 * reliability fixes reached one and not the other. This is the one copy of
 * what a feed read is:
 *
 * - **Which events:** `feedFilter`, kind 33331, optionally one author, paged
 *   with `until`. Never a tag filter: the cyberspace relay (strfry) refuses a
 *   filter with more than three (`too many tags in filter`), and a feed needs
 *   none.
 * - **Reading relays one at a time:** `readEach`. Each relay is prepared
 *   (connected, authenticated) and asked on its own, with a deadline for the
 *   connection and one for the read. Waiting for every relay's handshake
 *   before asking any of them let one hung socket leave the whole feed empty
 *   (snocrash #22, 2026-09-28); here the first relay to answer paints.
 * - **What an object is:** `objectFromEvent`, through `fromPayload`. An
 *   object is addressable, one per author and `d`, so only the newest event
 *   for each address counts, whichever relay sent it and in whatever order.
 * - **Paging:** `createFeed`, a page at a time as the reader scrolls, each
 *   relay followed to its own end so a dense relay cannot make a sparse one
 *   skip events.
 *
 * Like parts.ts, this package does no networking: the client passes in how
 * to subscribe to one relay, and keeps its own pool, auth and relay list.
 * The rules about what to ask and what to do with what comes back are here,
 * so both clients show the same feed.
 *
 * Also here, because both clients write it: the tag that credits the
 * original when an object is copied (`creditTags`, `readCredit`).
 */

import { fromPayload, type ShardModel } from './shards.js'

/** A standalone SNO object (DECK-0003 §3.1). */
export const SNO_KIND = 33331

/** How many objects a page asks each relay for. */
export const FEED_PAGE = 40

/**
 * Where published objects are read from by default: the cyberspace relay and
 * the general relays snocrash publishes to. A client adds its own.
 */
export const FEED_RELAYS: readonly string[] = [
  'wss://cyberspace.nostr1.com',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

/** How long a relay's read stays open, from when it is asked, if it never says it is finished. */
export const READ_DEADLINE_MS = 6000

/** How long a relay gets to open its socket before a read goes on without it. */
export const CONNECT_DEADLINE_MS = 3000

/**
 * How long a relay's auth challenge gets to be answered, on its own clock
 * after the connect. A local key signs at once; an extension or a bunker may
 * be a person approving it, and an auth-gated relay (the cyberspace relay
 * gates reads) skipped for being slow is a feed missing most of its objects.
 */
export const AUTH_DEADLINE_MS = 15000

/** The fields of a nostr event this module reads. */
export interface FeedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

/** An object someone published, with the event it came from. */
export interface FeedObject {
  id: string
  pubkey: string
  createdAt: number
  /** The `d` tag: this object's identity, stable across its edits. */
  d: string
  /** `33331:<pubkey>:<d>`, the address an `a` tag names. */
  address: string
  shard: ShardModel
  /** The event it was read from, as the relay sent it: what a client keeps, republishes or references. */
  event: FeedEvent
  /** The relays it was read from (createFeed), for a reference's relay hint. */
  seen?: string[]
}

/** A relay filter (NIP-01), as narrow as a feed needs. */
export interface FeedFilter {
  kinds: number[]
  authors?: string[]
  until?: number
  limit: number
}

/** The filter for one page of the feed. No tag filters, ever (see the header). */
export function feedFilter(opts: { authors?: string[]; until?: number; limit?: number } = {}): FeedFilter {
  const filter: FeedFilter = { kinds: [SNO_KIND], limit: opts.limit ?? FEED_PAGE }
  if (opts.authors && opts.authors.length > 0) filter.authors = [...opts.authors]
  if (opts.until !== undefined) filter.until = opts.until
  return filter
}

/** An object's address, `33331:<pubkey>:<d>`. */
export function objectAddress(pubkey: string, d: string): string {
  return `${SNO_KIND}:${pubkey}:${d}`
}

/** The object an event carries, or null when it is not one or is malformed. */
export function objectFromEvent(ev: FeedEvent): FeedObject | null {
  if (ev.kind !== SNO_KIND) return null
  const d = ev.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  // A hidden object (DECK-0003 §3.4) is sealed to a place: its content is a
  // preview, not a payload, and it is not the feed's to show.
  if (ev.tags.some((t) => t[0] === 'encrypted')) return null
  let shard: ShardModel | null = null
  try { shard = fromPayload(JSON.parse(ev.content), `${ev.pubkey}:${d}`) } catch { return null }
  // An object may be nothing but the arrangement of others (§1.9 rule 13).
  if (!shard || (shard.vertices.length === 0 && !shard.parts?.length)) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, d, address: objectAddress(ev.pubkey, d), shard, event: ev }
}

/* --------------------------------------------------------------------------
 * Reading relays one at a time
 * ------------------------------------------------------------------------ */

/** What a subscription to one relay reports. */
export interface RelayHandlers {
  onevent: (ev: FeedEvent) => void
  /** The relay has sent everything it has for the filter. */
  oneose: () => void
  /** The relay closed the subscription, or the connection dropped. */
  onclose: (reason?: string) => void
}

/**
 * How a client subscribes to one relay: its pool, its auth. Returns how to
 * close it. Generic over the filter, so a client can read other filters (a
 * `#d` lookup, profiles) through the same per-relay reader; the feed's own
 * reads use FeedFilter.
 */
export type Subscribe<F = FeedFilter> = (url: string, filter: F, handlers: RelayHandlers) => { close: () => void }

export interface ReadOptions {
  /** Each relay's read deadline, counted from when it is asked. */
  deadlineMs?: number
  /** Each relay's deadline to open (`connect`). */
  connectMs?: number
  /** Each relay's allowance to authenticate (`auth`), on its own clock after the connect. */
  authMs?: number
  /** Open a relay. False (or a rejection, or `connectMs` passing) means it cannot be read now. */
  connect?: (url: string) => Promise<boolean | void>
  /**
   * Answer the relay's auth challenge, if it sends one. Best effort: a
   * rejection or `authMs` passing does not stop the read, since a relay that
   * does not gate reads answers anyway and one that does closes the request.
   */
  auth?: (url: string) => Promise<unknown>
}

/** How one relay's part of a read ended. */
export type RelayEnd = 'eose' | 'closed' | 'unreachable' | 'deadline'

export interface ReadHandle {
  /** Resolves when every relay has finished, with how each one ended. */
  done: Promise<Map<string, RelayEnd>>
  /** Give up now. Safe to call twice. */
  close: () => void
}

/**
 * Read one filter from several relays, each on its own, handing each event
 * over as it lands with the relay it came from.
 *
 * Each relay runs on its own clocks: `connectMs` to open, `authMs` to answer
 * a challenge, then `deadlineMs` to finish once asked. No relay waits on
 * another, and a slow signer does not eat into the read's own time.
 *
 * The same event may arrive from more than one relay; the caller decides
 * what to do about that, because the right answer depends on what it is
 * collecting.
 */
export function readEach<F = FeedFilter>(
  relays: readonly string[],
  filter: F,
  subscribe: Subscribe<F>,
  onevent: (ev: FeedEvent, url: string) => void,
  opts: ReadOptions = {},
): ReadHandle {
  const urls = [...new Set(relays)]
  const ends = new Map<string, RelayEnd>()
  const subs = new Map<string, { close: () => void }>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let finished = false
  let settle: (ends: Map<string, RelayEnd>) => void = () => {}
  const done = new Promise<Map<string, RelayEnd>>((resolve) => { settle = resolve })

  const stop = (): void => {
    if (finished) return
    finished = true
    for (const t of timers) clearTimeout(t)
    for (const url of urls) if (!ends.has(url)) ends.set(url, 'deadline')
    for (const sub of subs.values()) { try { sub.close() } catch { /* already closed */ } }
    settle(ends)
  }
  const end = (url: string, how: RelayEnd): void => {
    if (finished || ends.has(url)) return
    ends.set(url, how)
    const sub = subs.get(url)
    if (sub && how === 'deadline') { try { sub.close() } catch { /* already closed */ } }
    if (ends.size >= urls.length) stop()
  }
  if (urls.length === 0) stop()

  for (const url of urls) {
    void (async () => {
      const opened = opts.connect ? await within(opts.connect(url).then((r) => r !== false, () => false), opts.connectMs ?? CONNECT_DEADLINE_MS, false) : true
      if (finished) return
      if (!opened) { end(url, 'unreachable'); return }
      if (opts.auth) await within(opts.auth(url).then(() => true, () => true), opts.authMs ?? AUTH_DEADLINE_MS, true)
      if (finished) return
      try {
        subs.set(url, subscribe(url, filter, {
          onevent: (ev) => { if (!finished && !ends.has(url)) onevent(ev, url) },
          oneose: () => end(url, 'eose'),
          onclose: () => end(url, 'closed'),
        }))
      } catch {
        end(url, 'unreachable')
        return
      }
      const t = setTimeout(() => end(url, 'deadline'), opts.deadlineMs ?? READ_DEADLINE_MS)
      timers.add(t)
    })()
  }
  return { done, close: stop }
}

/** A promise, or `fallback` once `ms` passes without it. */
async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })
  try {
    return await Promise.race([p, late])
  } finally {
    clearTimeout(timer)
  }
}

/* --------------------------------------------------------------------------
 * The feed, a page at a time
 * ------------------------------------------------------------------------ */

export interface FeedState {
  /** Newest first, one per address. */
  objects: FeedObject[]
  /** A page is being read. */
  loading: boolean
  /** Every relay has been read to its end: there is nothing older. */
  exhausted: boolean
}

export interface FeedOptions {
  relays: readonly string[]
  subscribe: Subscribe
  /** Only these authors' objects (a MINE view); everyone's when absent. */
  authors?: string[]
  pageSize?: number
  read?: ReadOptions
  /** Called as objects arrive (batched) and when a page ends. */
  onChange: (state: FeedState) => void
  /** How long arrivals are gathered before `onChange`; 120 ms. */
  batchMs?: number
}

export interface Feed {
  /** Read the next page; does nothing while one is being read or when exhausted. */
  more: () => Promise<void>
  state: () => FeedState
  /** Stop any read in progress; later pages are not read. */
  close: () => void
}

/**
 * A feed that pages as it is asked to.
 *
 * Each relay is followed to its own end. A page asks every relay still open
 * for `pageSize` objects from that relay's own oldest second so far, that
 * second included, so events sharing it past the page's end are not lost; a
 * page that brings nothing new steps one second past it, and a second such
 * page means the relay ignores `until`, so it is not asked again. A relay
 * that answers with fewer than it was asked for and says it is finished, or
 * runs out its time without a single event, has nothing older. One that
 * cannot be read at all is asked again next page, and left out after a
 * second miss. Following each relay on its own cursor is what keeps a busy
 * relay from pushing a quiet one's objects past the next page's `until`.
 */
export function createFeed(opts: FeedOptions): Feed {
  const size = opts.pageSize ?? FEED_PAGE
  const newest = new Map<string, FeedEvent>()
  const parsed = new Map<string, FeedObject | null>()
  /** Which relays sent each event. */
  const seenOn = new Map<string, Set<string>>()
  /** Each relay's oldest event so far; absent before its first page. */
  const cursor = new Map<string, number>()
  /**
   * Whether a relay's next page asks from its oldest second inclusive (the
   * usual case: events in that second past the page's end are not lost) or
   * from the second before (after a page that brought nothing new, the
   * second is spent).
   */
  const inclusive = new Map<string, boolean>()
  /** Event ids each relay has sent, to tell a new page from a repeat. */
  const sentBy = new Map<string, Set<string>>()
  /** How many pages in a row a relay could not be read at all. */
  const misses = new Map<string, number>()
  const open = new Set(opts.relays)
  let loading = false
  let closed = false
  const reading = new Set<ReadHandle>()
  let batch: ReturnType<typeof setTimeout> | undefined

  const objects = (): FeedObject[] => {
    const out: FeedObject[] = []
    for (const ev of newest.values()) {
      if (!parsed.has(ev.id)) parsed.set(ev.id, objectFromEvent(ev))
      const o = parsed.get(ev.id)
      if (o) out.push({ ...o, seen: [...(seenOn.get(ev.id) ?? [])] })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
  }
  const state = (): FeedState => ({ objects: objects(), loading, exhausted: open.size === 0 })
  const emit = (): void => { batch = undefined; if (!closed) opts.onChange(state()) }

  const more = async (): Promise<void> => {
    if (loading || closed || open.size === 0) return
    loading = true
    emit()
    // Relays that share a cursor share a read; a first page has none.
    const groups = new Map<number | undefined, string[]>()
    for (const url of open) {
      const c = cursor.get(url)
      const until = c === undefined ? undefined : inclusive.get(url) === false ? c - 1 : c
      groups.set(until, [...(groups.get(until) ?? []), url])
    }
    const counts = new Map<string, number>()
    const fresh = new Map<string, number>()
    const reads = [...groups].map(([until, urls]) => {
      const handle = readEach(urls, feedFilter({ authors: opts.authors, until, limit: size }), opts.subscribe, (ev, url) => {
        if (ev.kind !== SNO_KIND) return
        counts.set(url, (counts.get(url) ?? 0) + 1)
        const mine = sentBy.get(url) ?? new Set<string>()
        if (!mine.has(ev.id)) { mine.add(ev.id); fresh.set(url, (fresh.get(url) ?? 0) + 1) }
        sentBy.set(url, mine)
        const seen = seenOn.get(ev.id) ?? new Set<string>()
        seen.add(url)
        seenOn.set(ev.id, seen)
        const prevOldest = cursor.get(url)
        if (prevOldest === undefined || ev.created_at < prevOldest) cursor.set(url, ev.created_at)
        const d = ev.tags.find((t) => t[0] === 'd')?.[1]
        if (!d) return
        const key = `${ev.pubkey}:${d}`
        const held = newest.get(key)
        // Relays repeat each other and an older edit can arrive after a newer
        // one: the newest event for an address is the object.
        if (held && (held.created_at > ev.created_at || (held.created_at === ev.created_at && held.id <= ev.id))) return
        newest.set(key, ev)
        if (batch === undefined) batch = setTimeout(emit, opts.batchMs ?? 120)
      }, opts.read)
      reading.add(handle)
      return handle.done.finally(() => { reading.delete(handle) })
    })
    const results = await Promise.all(reads)
    for (const ends of results) {
      for (const [url, how] of ends) {
        const got = counts.get(url) ?? 0
        if ((how === 'unreachable' || how === 'closed') && got === 0) {
          // Could not be read at all: asked again next page, and left out
          // only after a second miss in a row, so one slow connect on first
          // load does not cost a relay for the session.
          const n = (misses.get(url) ?? 0) + 1
          misses.set(url, n)
          if (n >= 2) open.delete(url)
          continue
        }
        misses.delete(url)
        // Finished with less than a page, or ran out its time with nothing at
        // all (a relay that never sends EOSE): nothing older to ask for.
        if ((how === 'eose' && got < size) || (how === 'deadline' && got === 0)) { open.delete(url); continue }
        if ((fresh.get(url) ?? 0) === 0) {
          // Events, but every one a repeat: either more than a page share the
          // boundary second, so step past it, or the relay ignores `until`
          // and would send the same page forever, so stop asking it.
          if (inclusive.get(url) === false) open.delete(url)
          else inclusive.set(url, false)
        } else {
          inclusive.set(url, true)
        }
      }
    }
    loading = false
    clearTimeout(batch)
    emit()
  }

  return {
    more,
    state,
    close: () => { closed = true; clearTimeout(batch); for (const r of reading) r.close() },
  }
}

/* --------------------------------------------------------------------------
 * Credit for a copy
 * ------------------------------------------------------------------------ */

/**
 * Whose object a copy was made from (DECK-0003, crediting; ruled by arkinox,
 * 2026-10-08).
 *
 * Every copy and remix carries the NIP-18 quote tag naming the original's
 * address, `["q", "33331:<pubkey>:<d>", "<relay hint>"]`. `q` because it is
 * the standard tag for "this is based on that", it is indexable (a relay can
 * answer "what copies my object"), and it is not `a` or `e`, which on a kind
 * 33331 mean "this object places that one" (§1.10) and would be misread as a
 * placement.
 *
 * A PUBLIC remix (published as its own kind 33331) also carries
 * `["p", "<original author>"]`, so the author's clients tell them. A copy
 * sealed in a bag carries only the `q`: a notification there would point at
 * a hidden placement.
 */
export interface Credit {
  /** `33331:<pubkey>:<d>` of the original. */
  address: string
  /** A relay the original was seen on, if known. */
  relay?: string
}

/**
 * The tags a copy carries to credit its original: the `q` always, and with
 * `notify` (a public remix only, never a copy sealed in a bag) the `p` that
 * tells the original's author.
 */
export function creditTags(credit: Credit, opts: { notify?: boolean } = {}): string[][] {
  const tags = [['q', credit.address, credit.relay ?? '']]
  const author = creditAuthor(credit)
  if (opts.notify && /^[0-9a-f]{64}$/.test(author)) tags.push(['p', author])
  return tags
}

/** The original a copy credits, or null when its tags credit none. */
export function readCredit(tags: readonly string[][]): Credit | null {
  const t = tags.find((tag) => tag[0] === 'q' && /^33331:[0-9a-f]{64}:/.test(tag[1] ?? ''))
  if (!t) return null
  return t[2] ? { address: t[1], relay: t[2] } : { address: t[1] }
}

/** The pubkey of the author a credit names. */
export function creditAuthor(credit: Credit): string {
  return credit.address.split(':')[1] ?? ''
}

/**
 * A model made from someone else's object (a REMIX) remembers it: kept on the
 * stored model beside the format's fields, never in the payload, and written
 * with `creditTags` by whatever the model goes out as (a copy in a bag: the
 * `q`; a public remix: the `q` and the `p`). Both clients keep their models
 * as JSON and edit them by spreading, so the field survives edits and reloads.
 */
export function withCredit(model: ShardModel, credit: Credit): ShardModel {
  return { ...model, credit } as ShardModel
}

/** Whose object a model was made from, or undefined for an original. */
export function creditOf(model: ShardModel): Credit | undefined {
  return (model as ShardModel & { credit?: Credit }).credit
}
