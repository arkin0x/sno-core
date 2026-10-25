/**
 * parts.ts - one object placing others (DECK-0003 §1.10).
 *
 * The payload side (reading and writing `refs` and `parts`, rules 11 and 12)
 * lives in shards.ts with the rest of the wire. This is what a reader does
 * with them once read: fetch each placed object, follow its own parts no
 * deeper than four levels, treat a loop as missing, and say where each one
 * stands. Fetching is the client's, passed in, because this package does no
 * networking; the rules about what to do with what comes back are here, so
 * both clients draw the same thing.
 *
 * Anything that cannot be drawn becomes a placeholder, never a rejection of
 * the parent: another author's event is not this object's to guarantee.
 *
 * An object may also carry the objects it places, in `objects` (§1.10). The
 * table of the object being drawn is looked in first, at every depth, then the
 * table of the event the placing object travels in when it was fetched as its
 * own; an address a table holds is never fetched, even when its entry is bad.
 * Only keys under the pubkey of the event a table travels in count, and a
 * reader that does not know that pubkey honours none.
 */

import { MAX_UNIT, PART_REACH, addressesIn, fromPayload, mirrorTurn, readObjects, ticksOf, toPayload, toRender, type Part, type Ref, type ShardModel } from './shards.js'

/** How many levels of placement a reader follows from the object it draws (§1.10). */
export const MAX_PART_DEPTH = 4

/** Why a placement is drawn as a placeholder. */
export type Missing =
  /** The fetch found nothing, or failed. */
  | 'unreachable'
  /** Something came back and failed §1.9. */
  | 'invalid'
  /** More than MAX_PART_DEPTH levels down. */
  | 'deep'
  /** The object is already one of its own parents. */
  | 'cycle'
  /** Its unit plus the step leaves 0..84. */
  | 'scale'
  /** Past MAX_PLACED, the most placements one resolve draws. */
  | 'budget'

/**
 * The most placements one resolve draws, at every depth together, placeholders
 * for loops and for levels past the depth bound included; past it, what is
 * left of each object's placements is one placeholder ('budget'), so a resolve
 * returns at most this many placements plus one marker per object cut short. Four levels of a few dozen placements each multiply fast: a
 * 3.4 KB table was measured placing 838,000 objects (204 MB before a single
 * mesh). A reader MAY bound its own work this way (DECK-0003 §1.10, §6).
 */
export const MAX_PLACED = 20_000

/** A placement with what it places, or why it is a placeholder. */
export interface Placed {
  part: Part
  ref: Ref
  /** The placed object, or null for a placeholder. */
  model: ShardModel | null
  missing?: Missing
  /**
   * True when a table answered for this placement (§1.10): the object was drawn
   * from, or its bad entry is a placeholder from, the `objects` of the object
   * being drawn or of a fetched object above it. Absent when it was fetched.
   */
  carried?: true
  /** Its own placements, resolved the same way. */
  children: Placed[]
}

/**
 * What a fetch hands back when it knows whose event it read: the payload, and
 * the pubkey of the event, so that an object fetched by `e` keeps its own table
 * (§1.10: keys only under the pubkey of the event a table travels in). A fetch
 * by `a` needs none, since the address names its author.
 */
export class Fetched {
  constructor(readonly payload: unknown, readonly pubkey: string) {}
}

/**
 * What a client passes in: the payload the reference names (parsed JSON), or a
 * Fetched with the event's pubkey, or null when there is none.
 */
export type FetchRef = (ref: Ref) => Promise<unknown>

/** One string per placed object, whatever relay hint came with it: for caching and for finding loops. */
export function refKey(ref: Ref): string {
  return `${ref[0]}:${ref[1]}`
}

/** An `a` target's three parts, for a relay filter: kind, author and `d`. */
export function parseAddress(target: string): { kind: number; pubkey: string; d: string } | null {
  // A `d` is any string, as NIP-01 allows, line breaks included (the `s` flag),
  // as the reference reads it (sno-reference.py, re.S).
  const m = /^(\d+):([0-9a-f]{64}):(.*)$/s.exec(target)
  return m ? { kind: Number(m[1]), pubkey: m[2], d: m[3] } : null
}

/**
 * The tags a public kind 33331 carrying this object SHOULD also have, one per
 * reference, unchanged (§1.10), so a relay can answer "what places this
 * object" with `#a` or `#e`. Only references a placement uses.
 */
export function refTags(s: Pick<ShardModel, 'refs' | 'parts'>): string[][] {
  if (!s.refs || !s.parts) return []
  const used = new Set(s.parts.map((p) => p.ref))
  return s.refs.filter((_, i) => used.has(i)).map((r) => r.filter((x): x is string => typeof x === 'string'))
}

/** The pubkey an address names, or null when the target is not one. */
function pubkeyOf(target: string): string | null {
  return parseAddress(target)?.pubkey ?? null
}

/**
 * The table `s` carries (§1.10), as a reader uses it: only keys under `author`,
 * the pubkey of the event it travels in (a key under any other pubkey is
 * ignored and its address fetched). Null, an author nobody knows, honours no
 * key at all: never every key. Never refuses: a table that is not one reads
 * as empty. The values are unchecked payloads.
 */
export function carriedTable(s: Pick<ShardModel, 'objects'>, author: string | null): Record<string, unknown> {
  const t = s.objects
  if (!author || !t || typeof t !== 'object' || Array.isArray(t)) return {}
  // Not copied: read only, and resolved once per draw.
  return Object.fromEntries(Object.entries(t).filter(([k, v]) => {
    const a = v === undefined ? null : parseAddress(k)
    return a !== null && a.kind === 33331 && a.pubkey === author
  }))
}

/**
 * `model` as read from an event whose pubkey is `pubkey` (or null when it is not
 * known): `author` set, and only the table keys under it kept, so that every
 * draw after this takes the table as it is (§1.10). For a signed event that is
 * its pubkey; for an unsigned item in a bag, the bag's signer, never the
 * item's own claim. The same model when nothing changes.
 *
 * Never pass the local user's pubkey for a payload that was not read from an
 * event that user signed (text pasted, a file, an import): anyone can write
 * keys under anyone's name, so such a payload's table is trusted for no one;
 * pass null.
 */
export function withAuthor(model: ShardModel, pubkey: string | null): ShardModel {
  const kept = model.objects ? carriedTable(model, pubkey) : null
  const sameTable = !model.objects || Object.keys(kept ?? {}).length === Object.keys(model.objects).length
  if (sameTable && (model.author ?? null) === pubkey) return model
  const { objects: _all, author: _was, ...bare } = model
  return { ...bare, ...(pubkey ? { author: pubkey } : {}), ...(kept && Object.keys(kept).length ? { objects: kept } : {}) }
}

/**
 * One entry of a table read as a model, checked by §1.9 on its own, with any
 * `objects` of its own ignored (a table is flat), and with the id
 * `a:<address>`, the reference's key, as a fetched object has. Undefined when the table does
 * not hold `address`, null when it holds a bad entry, which is a placeholder
 * for each placement naming it and is still not fetched.
 */
export function carriedModel(
  table: Record<string, unknown>,
  address: string,
  read: (payload: unknown, key: string) => ShardModel | null = fromPayload,
): ShardModel | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(table, address)) return undefined
  const entry = table[address]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  // Read under the reference's key, as a fetched object is, so a model has the
  // same id whichever way it came; and from the same object every time for the
  // same entry (flatOf), so a reader that keeps models by payload (`read`)
  // finds the one it made.
  return read(flatOf(entry), `a:${address}`)
}

/** An entry without a table of its own (a table is flat), the same object for the same entry. */
const flats = new WeakMap<object, object>()
function flatOf(entry: object): object {
  if (!('objects' in entry)) return entry
  let flat = flats.get(entry)
  if (!flat) {
    const { objects: _nested, ...rest } = entry as Record<string, unknown>
    flats.set(entry, (flat = rest))
  }
  return flat
}

/** How resolveParts is called. */
export interface ResolveOptions {
  /** The model as a published object: it counts as the first parent, so an object placing itself is a loop. */
  self?: Ref
  /**
   * The pubkey of the event `model` travels in (or of its author, for an object
   * not yet published): only keys of its table under it count (§1.10). Null
   * says it is not known, and no key counts. Left out, it is `model.author`
   * (withAuthor), else the pubkey an `a` `self` names, else null: a table is
   * never honoured on no one's word.
   */
  author?: string | null
  /**
   * How a payload, fetched or from a table, becomes a model: `fromPayload` by
   * default. A client that keeps one model per payload object for the whole
   * app passes its own; it must answer as fromPayload does, null for a payload
   * §1.9 refuses.
   */
  read?: (payload: unknown, key: string) => ShardModel | null
  /**
   * The placements this resolve may still draw, shared: pass one object to
   * several resolves and they draw MAX_PLACED, or whatever `left` starts at,
   * between them (a client resolving every shard around a walker at once).
   * Left out, each call has MAX_PLACED of its own.
   */
  budget?: { left: number }
}

/**
 * Every placement of `model`, resolved. One fetch per distinct object, however
 * many times it is placed: a floor of 129 tiles fetches the tile once.
 *
 * Each placement's address is looked up first in `model`'s own table, at any
 * depth, then in the table of the event the placing object travels in when
 * that is another one (an object fetched by its `a` address, whose keys must be
 * under that address's pubkey; an object fetched by `e`, under the pubkey the
 * fetch says in a Fetched, and none when it does not say), and only what
 * neither holds is fetched (§1.10). No more than MAX_PLACED placements are
 * drawn, the rest placeholders. The third argument may be a bare `self`
 * reference, as it was before tables existed.
 */
export async function resolveParts(model: ShardModel, fetch: FetchRef, options?: Ref | ResolveOptions): Promise<Placed[]> {
  const opts: ResolveOptions = Array.isArray(options) ? { self: options } : options ?? {}
  const self = opts.self
  const author = opts.author !== undefined ? opts.author : model.author ?? (self && self[0] === 'a' ? pubkeyOf(self[1]) : null)
  const read = opts.read ?? fromPayload
  const root = carriedTable(model, author)
  const budget = opts.budget ?? { left: MAX_PLACED }
  const fetched = new Map<string, Promise<{ model: ShardModel; table?: Record<string, unknown> } | Missing>>()
  const load = (ref: Ref) => {
    const key = refKey(ref)
    let got = fetched.get(key)
    if (!got) {
      got = fetch(ref).then(
        (answer) => {
          const payload = answer instanceof Fetched ? answer.payload : answer
          const m = payload == null ? null : read(payload, key)
          if (!m) return payload == null ? 'unreachable' as const : 'invalid' as const
          // The fetched object's own table, keys only under its own pubkey:
          // the address's for an `a`, the event's (if the fetch said) for an `e`.
          const pk = ref[0] === 'a' ? pubkeyOf(ref[1]) : answer instanceof Fetched ? answer.pubkey : null
          return pk ? { model: m, table: carriedTable(m, pk) } : { model: m }
        },
        () => 'unreachable' as const,
      )
      fetched.set(key, got)
    }
    return got
  }
  // One parse per entry per table, however often it is placed.
  const parsed = new Map<Record<string, unknown>, Map<string, ShardModel | null>>()
  const fromTable = (table: Record<string, unknown>, address: string): ShardModel | null | undefined => {
    let seen = parsed.get(table)
    if (!seen) { seen = new Map(); parsed.set(table, seen) }
    if (seen.has(address)) return seen.get(address)
    const got = carriedModel(table, address, read)
    if (got !== undefined) seen.set(address, got)
    return got
  }
  /** `own` is the table of the event `m` travels in, when that is not the root's. */
  const walk = async (m: ShardModel, depth: number, chain: Set<string>, own?: Record<string, unknown>): Promise<Placed[]> => {
    const refs = m.refs ?? []
    const all = m.parts ?? []
    // Every placement counts toward the budget, a placeholder too, before
    // anything else is decided: a loop or a level past the depth bound is
    // drawn, so it is paid for. Counted here, synchronously, for the whole
    // level at once, so nothing below can start before its share is taken.
    // Once the budget is spent, the rest of this object's placements are one
    // placeholder, not one each: a reader never maps more than it draws.
    const taken = all.slice(0, Math.max(0, budget.left))
    budget.left -= taken.length
    const over = (part: Part): Placed => ({ part, ref: refs[part.ref], model: null, missing: 'budget', children: [] })
    const drawn = await Promise.all(taken.map(async (part): Promise<Placed> => {
      const ref = refs[part.ref]
      const key = refKey(ref)
      if (chain.has(key)) return { part, ref, model: null, missing: 'cycle', children: [] }
      if (depth > MAX_PART_DEPTH) return { part, ref, model: null, missing: 'deep', children: [] }
      let got: ShardModel | null | undefined
      // The table of the event the placed object travels in, for its own placements.
      let table: Record<string, unknown> | undefined
      if (ref[0] === 'a') {
        got = fromTable(root, ref[1])
        if (got === undefined && own) { got = fromTable(own, ref[1]); table = own }
      }
      const carried = got !== undefined
      if (got === undefined) {
        const answer = await load(ref)
        if (typeof answer === 'string') return { part, ref, model: null, missing: answer, children: [] }
        got = answer.model
        table = answer.table
      }
      const mark = carried ? { carried: true as const } : {}
      if (got === null) return { part, ref, model: null, missing: 'invalid', ...mark, children: [] }
      if (got.unit + part.step < 0 || got.unit + part.step > MAX_UNIT) return { part, ref, model: null, missing: 'scale', ...mark, children: [] }
      const children = got.parts ? await walk(got, depth + 1, new Set([...chain, key]), table) : []
      return { part, ref, model: got, ...mark, children }
    }))
    return taken.length < all.length ? [...drawn, over(all[taken.length])] : drawn
  }
  return walk(model, 1, new Set(self ? [refKey(self)] : []))
}

/**
 * The payload an object is carried as in a table: its own payload with its own
 * `objects` taken off, because a table is flat (§1.10).
 */
export function carriedPayload(object: ShardModel): Record<string, unknown> {
  const { objects: _nested, ...flat } = toPayload(object) as unknown as Record<string, unknown>
  return flat
}

/**
 * `root` carrying `object` under `address` (§1.10), replacing any entry there.
 * A writer flattens: whatever `object` carries itself goes into `root`'s table
 * too, under keys the table does not already hold (the root's table is looked
 * in first, so an entry it holds already is the one that is drawn), and only
 * keys under the pubkey `address` names, the writer's own (a publisher MUST
 * write no other). `address` is not checked against `root`'s refs here.
 */
export function carryObject(root: ShardModel, address: string, object: ShardModel): ShardModel {
  const table: Record<string, unknown> = { ...(root.objects ?? {}) }
  const writer = pubkeyOf(address)
  for (const [k, v] of Object.entries(readObjects(object.objects) ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(table, k) && k !== address && pubkeyOf(k) === writer) table[k] = v
  }
  table[address] = carriedPayload(object)
  return { ...root, objects: Object.fromEntries(Object.entries(table)) }
}

/** `root` without the entry for `address`; the table goes when it is empty. */
export function uncarry(root: ShardModel, address: string): ShardModel {
  if (!root.objects || !Object.prototype.hasOwnProperty.call(root.objects, address)) return root
  const rest = Object.entries(root.objects).filter(([k]) => k !== address)
  const { objects: _gone, ...bare } = root
  return rest.length ? { ...bare, objects: Object.fromEntries(rest) } : bare
}

/** What a writer's lookup says about one address: the object, and whether to carry it or only look inside it. */
export interface CarryChoice {
  object: ShardModel
  /** True: carry it in the root's table. False: leave it a reference, but carry what it places where `lookup` says so. */
  carry: boolean
}

/**
 * `root` carrying every object `lookup` chooses, at any depth, flattened into
 * `root`'s one table (§1.10): the writer's half of the rule a reader follows.
 * Walks `root`'s placements and then the placements of each object `lookup`
 * returns, no deeper than MAX_PART_DEPTH, each address at the shallowest depth
 * any placement reaches it (an address met first deep down and again nearer
 * the top is walked again from there, so what it places is carried too), and
 * never into an address already among the parents. An address the table already holds is
 * kept as it is (and walked through), so an edited copy is never replaced by
 * the object it was copied from. `lookup` is given the reference as written,
 * relay hint included, and returns null for one to leave alone, for example
 * someone else's object or a live link. The caller checks the size.
 * Synchronous, so a writer can carry and check the size before anything else
 * in its flow yields: a lookup answers from what is in hand.
 *
 * With `prune`, entries of the table that the walk did not reach go, since no
 * placement draws them and they would be carried to every reader for nothing
 * (§1.10). A reference `lookup` left alone is not walked into, so an entry
 * reached only through one is dropped too, which is why pruning is asked for
 * rather than done: a table another client wrote may carry objects placed
 * beneath a reference this writer does not walk.
 */
export function carryAll(
  root: ShardModel,
  lookup: (ref: Ref) => CarryChoice | null,
  options: { prune?: boolean } = {},
): ShardModel {
  let out = root
  // The shallowest depth each address was walked at, and what it was walked as.
  const shallowest = new Map<string, number>()
  const walked = new Map<string, ShardModel | null>()
  const visit = (m: ShardModel, depth: number, chain: Set<string>): void => {
    if (depth > MAX_PART_DEPTH) return
    const used = new Set((m.parts ?? []).map((p) => p.ref))
    for (const [i, ref] of (m.refs ?? []).entries()) {
      if (!used.has(i) || ref[0] !== 'a' || chain.has(ref[1])) continue
      const before = shallowest.get(ref[1])
      if (before !== undefined && before <= depth) continue
      shallowest.set(ref[1], depth)
      let next = walked.get(ref[1])
      if (next === undefined) {
        // Asked once per address, however often it is met.
        const held = out.objects ? carriedModel(out.objects, ref[1]) : undefined
        next = held ?? null
        if (held === undefined) {
          const choice = lookup(ref)
          if (choice?.carry) out = carryObject(out, ref[1], choice.object)
          next = choice ? choice.object : null
        }
        walked.set(ref[1], next)
      }
      if (next) visit(next, depth + 1, new Set([...chain, ref[1]]))
    }
  }
  visit(root, 1, new Set())
  if (options.prune) for (const k of Object.keys(out.objects ?? {})) if (!shallowest.has(k)) out = uncarry(out, k)
  return out
}

/** Cosine and sine of whole degrees, exact at the quarter turns so a 90 keeps a part on the lattice. */
function cs(deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return [1, 0]
  if (d === 90) return [0, 1]
  if (d === 180) return [-1, 0]
  if (d === 270) return [0, -1]
  const r = (d * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}

/** A row-major 3x3. */
export type M3 = [number, number, number, number, number, number, number, number, number]

/**
 * The rotation a turn names: about X, then Y, then Z, all fixed axes, so
 * Rz Ry Rx. The same formula serves the wire's frame and the model's,
 * because mirroring each factor through Z is exactly mirrorTurn.
 */
export function turnMatrix(t: [number, number, number]): M3 {
  const [ca, sa] = cs(t[0]), [cb, sb] = cs(t[1]), [cc, sc] = cs(t[2])
  const rx: M3 = [1, 0, 0, 0, ca, -sa, 0, sa, ca]
  const ry: M3 = [cb, 0, sb, 0, 1, 0, -sb, 0, cb]
  const rz: M3 = [cc, -sc, 0, sc, cc, 0, 0, 0, 1]
  return mul(rz, mul(ry, rx))
}

/** Whole degrees 0..359. */
const whole = (rad: number): number => ((Math.round((rad * 180) / Math.PI) % 360) + 360) % 360

/**
 * The turn a rotation matrix is, back in whole degrees about X, then Y, then
 * Z. At a quarter turn about Y, X and Z turn about the same line and only
 * their sum is fixed, so the Z turn is taken as 0 there.
 */
export function turnFromMatrix(r: M3): [number, number, number] {
  const sy = -r[6]
  if (Math.abs(sy) < 1 - 1e-9) return [whole(Math.atan2(r[7], r[8])), whole(Math.asin(sy)), whole(Math.atan2(r[3], r[0]))]
  return sy > 0 ? [whole(Math.atan2(r[1], r[4])), 90, 0] : [whole(Math.atan2(-r[1], r[4])), 270, 0]
}
/** Row-major 3x3 product. */
function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

/**
 * Where a placed object stands, as a 4x4 matrix in column-major order (what
 * three.js `Matrix4.fromArray` takes), in the frame renderers draw in: the
 * wire's (shards.ts toRender). It carries a point of the placed object, as
 * `toRender` gives it in the placed object's own model units, to the parent's
 * model units. Then the parent's own scale applies to both alike.
 *
 * The turn is about the parent's X, then Y, then Z (§1.10), so its matrix is
 * Rz Ry Rx. The scale is 2^(its unit + step - the parent's unit): the placed
 * object is drawn at 2^(its unit + step) base units per model unit, and the
 * parent's model unit is 2^(its unit).
 */
export function partMatrix(part: Part, parentUnit: number, placedUnit: number): number[] {
  const r = turnMatrix(mirrorTurn(part.turn))
  const s = 2 ** (placedUnit + part.step - parentUnit)
  const [tx, ty, tz] = toRender(part.at)
  return [
    r[0] * s, r[3] * s, r[6] * s, 0,
    r[1] * s, r[4] * s, r[7] * s, 0,
    r[2] * s, r[5] * s, r[8] * s, 0,
    tx, ty, tz, 1,
  ]
}

/**
 * A placement turned a quarter about a pivot, the way the workshop's TURN
 * turns points: in the plane of axes `a` and `b`, taking `a` toward `b`.
 * Its origin swings about the pivot exactly as a vertex would, and its own
 * turn takes the same quarter, so a placed object turns with the points
 * around it. Model frame in, model frame out. Null when the origin would
 * leave the 64-unit bound.
 */
export function quarterTurnPart(part: Part, a: 0 | 1 | 2, b: 0 | 1 | 2, pivot: [number, number]): Part | null {
  const at = [...part.at] as [number, number, number]
  const da = part.at[a] - pivot[0], db = part.at[b] - pivot[1]
  at[a] = pivot[0] - db
  at[b] = pivot[1] + da
  if (at.some((n) => n < -PART_REACH || n > PART_REACH)) return null
  // Q takes the a axis to the b axis and the b axis to minus a.
  const q = [1, 0, 0, 0, 1, 0, 0, 0, 1] as M3
  q[a * 3 + a] = 0; q[b * 3 + b] = 0
  q[b * 3 + a] = 1; q[a * 3 + b] = -1
  return { ...part, at, turn: turnFromMatrix(mul(q, turnMatrix(part.turn))) }
}

/**
 * The object with one more placement, naming `ref`. A reference already in
 * `refs` is reused rather than repeated (§1.10: refs names each object once).
 * Returns the new placement's index too.
 */
export function addPart(s: ShardModel, ref: Ref, place: Omit<Part, 'ref'>): { shard: ShardModel; index: number } {
  const refs = [...(s.refs ?? [])]
  let i = refs.findIndex((r) => refKey(r) === refKey(ref))
  if (i < 0) { i = refs.length; refs.push(ref) }
  const parts = [...(s.parts ?? []), { ...place, ref: i }]
  return { shard: { ...s, refs, parts }, index: parts.length - 1 }
}

/** Whether a raw payload places anything by `e`, which is always fetched. */
function placesByEvent(raw: unknown): boolean {
  const refs = raw && typeof raw === 'object' ? (raw as { refs?: unknown }).refs : undefined
  return Array.isArray(refs) && refs.some((r) => Array.isArray(r) && r[0] === 'e')
}

/**
 * The object without the placements at `indices`; references no placement uses
 * any more go, and the rest renumber. A carried object (§1.10) whose reference
 * goes goes with it, unless something left can still reach it: another entry
 * of the table, or any placement that is fetched, since what a fetched object
 * places is looked up in this table too and cannot be seen from here.
 */
export function removeParts(s: ShardModel, indices: Iterable<number>): ShardModel {
  const gone = new Set(indices)
  const kept = (s.parts ?? []).filter((_, i) => !gone.has(i))
  const used = [...new Set(kept.map((p) => p.ref))].sort((x, y) => x - y)
  const renumber = new Map(used.map((old, k) => [old, k]))
  const refs = used.map((i) => (s.refs ?? [])[i])
  const parts = kept.map((p) => ({ ...p, ref: renumber.get(p.ref) as number }))
  const { refs: _r, parts: _p, ...rest } = s
  let out: ShardModel = parts.length ? { ...rest, refs, parts } : rest
  const table = out.objects
  if (table) {
    // What the table reaches from some addresses, following its own entries.
    const reach = (from: string[]): Set<string> => {
      const seen = new Set<string>()
      const queue = [...from]
      while (queue.length) {
        const a = queue.pop() as string
        if (seen.has(a)) continue
        seen.add(a)
        if (Object.prototype.hasOwnProperty.call(table, a)) queue.push(...addressesIn(table[a]))
      }
      return seen
    }
    const addresses = (rs: Ref[]): string[] => rs.filter((r) => r[0] === 'a').map((r) => r[1])
    const still = reach(addresses(refs))
    // A placement still standing that is fetched (an `e`, or an `a` the table
    // does not hold) may place anything, beneath it where this cannot see, and
    // the root's table answers there too: then nothing is dropped.
    const fetchedStill = refs.some((r) => r[0] === 'e') ||
      [...still].some((a) => !Object.prototype.hasOwnProperty.call(table, a)) ||
      [...still].some((a) => Object.prototype.hasOwnProperty.call(table, a) && placesByEvent(table[a]))
    // Only what the removed placements reached, and only when every placement
    // left is one this can see into.
    if (!fetchedStill) for (const a of reach(addresses(s.refs ?? []))) if (!still.has(a)) out = uncarry(out, a)
  }
  return out
}

/** An axis-aligned box in the frame renderers draw in, in the object's own model units. */
export interface Bounds { min: [number, number, number]; max: [number, number, number] }

/**
 * What the object occupies once its parts are placed: its own vertices, each
 * placed object's bounds carried through its placement, and a placeholder's
 * unit cube, centred on where it stands. What a preview frames and what a
 * parent's extent grows to hold (§1.10). Null for nothing at all.
 */
export function placedBounds(s: ShardModel, placed: Placed[]): Bounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const take = (p: number[]): void => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]) } }
  for (const v of s.vertices) take(toRender(ticksOf(v)))
  for (const p of placed) {
    const inner: Bounds | null = p.model ? placedBounds(p.model, p.children) : { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }
    if (!inner) continue
    const m = partMatrix(p.part, s.unit, p.model ? p.model.unit : s.unit)
    for (const x of [inner.min[0], inner.max[0]]) for (const y of [inner.min[1], inner.max[1]]) for (const z of [inner.min[2], inner.max[2]]) {
      take([0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]))
    }
  }
  return min[0] === Infinity ? null : { min, max }
}
