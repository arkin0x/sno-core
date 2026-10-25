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

/** What a client passes in: the payload the reference names (parsed JSON), or null when there is none. */
export type FetchRef = (ref: Ref) => Promise<unknown>

/** One string per placed object, whatever relay hint came with it: for caching and for finding loops. */
export function refKey(ref: Ref): string {
  return `${ref[0]}:${ref[1]}`
}

/** An `a` target's three parts, for a relay filter: kind, author and `d`. */
export function parseAddress(target: string): { kind: number; pubkey: string; d: string } | null {
  const m = /^(\d+):([0-9a-f]{64}):(.*)$/.exec(target)
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
 * the pubkey of the event it travels in, when that is known (a key under any
 * other pubkey is ignored and its address fetched). Never refuses: a table
 * that is not one reads as empty. The values are unchecked payloads.
 */
export function carriedTable(s: Pick<ShardModel, 'objects'>, author?: string): Record<string, unknown> {
  const t = s.objects
  if (!t || typeof t !== 'object' || Array.isArray(t)) return {}
  // Not copied: read only, and resolved once per draw.
  return Object.fromEntries(Object.entries(t).filter(([k, v]) => v !== undefined && /^33331:[0-9a-f]{64}:/.test(k) && (!author || pubkeyOf(k) === author)))
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
  // The entry itself when it carries no table, so a reader that keeps models by
  // payload (`read`) finds the same one every time.
  // Read under the reference's key, as a fetched object is, so a model has the
  // same id whichever way it came.
  const key = `a:${address}`
  if (!('objects' in entry)) return read(entry, key)
  const { objects: _nested, ...flat } = entry as Record<string, unknown>
  return read(flat, key)
}

/** How resolveParts is called. */
export interface ResolveOptions {
  /** The model as a published object: it counts as the first parent, so an object placing itself is a loop. */
  self?: Ref
  /**
   * The pubkey of the event `model` travels in (or of its author, for an object
   * not yet published), so that keys of its table under any other pubkey are
   * ignored (§1.10). Defaults to the pubkey `self` names. When neither is known
   * every key is honoured, which is only right for a caller that checked.
   */
  author?: string
  /**
   * How a payload, fetched or from a table, becomes a model: `fromPayload` by
   * default. A client that keeps one model per payload object for the whole
   * app passes its own; it must answer as fromPayload does, null for a payload
   * §1.9 refuses.
   */
  read?: (payload: unknown, key: string) => ShardModel | null
}

/**
 * Every placement of `model`, resolved. One fetch per distinct object, however
 * many times it is placed: a floor of 129 tiles fetches the tile once.
 *
 * Each placement's address is looked up first in `model`'s own table, at any
 * depth, then in the table of the event the placing object travels in when
 * that is another one (an object fetched by its `a` address, whose keys must be
 * under that address's pubkey; an object fetched by `e` brings no table, since
 * its author is not known here), and only what neither holds is fetched
 * (§1.10). The third argument may be a bare `self` reference, as it was before
 * tables existed.
 */
export async function resolveParts(model: ShardModel, fetch: FetchRef, options?: Ref | ResolveOptions): Promise<Placed[]> {
  const opts: ResolveOptions = Array.isArray(options) ? { self: options } : options ?? {}
  const self = opts.self
  const author = opts.author ?? (self && self[0] === 'a' ? pubkeyOf(self[1]) ?? undefined : undefined)
  const read = opts.read ?? fromPayload
  const root = carriedTable(model, author)
  const fetched = new Map<string, Promise<{ model: ShardModel; table?: Record<string, unknown> } | Missing>>()
  const load = (ref: Ref) => {
    const key = refKey(ref)
    let got = fetched.get(key)
    if (!got) {
      got = fetch(ref).then(
        (payload) => {
          const m = payload == null ? null : read(payload, key)
          if (!m) return payload == null ? 'unreachable' as const : 'invalid' as const
          // The fetched object's own table, keys only under its own pubkey.
          const pk = ref[0] === 'a' ? pubkeyOf(ref[1]) : null
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
    return Promise.all((m.parts ?? []).map(async (part): Promise<Placed> => {
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
 * in first, so an entry it holds already is the one that is drawn). `address`
 * is not checked against `root`'s refs here; `toPayload` writes only what a
 * placement reaches.
 */
export function carryObject(root: ShardModel, address: string, object: ShardModel): ShardModel {
  const table: Record<string, unknown> = { ...(root.objects ?? {}) }
  for (const [k, v] of Object.entries(readObjects(object.objects) ?? {})) if (!Object.prototype.hasOwnProperty.call(table, k) && k !== address) table[k] = v
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
 * returns, no deeper than MAX_PART_DEPTH, each address once, and never into an
 * address already among the parents. An address the table already holds is
 * kept as it is (and walked through), so an edited copy is never replaced by
 * the object it was copied from. `lookup` is given the reference as written,
 * relay hint included, and returns null for one to leave alone, for example
 * someone else's object or a live link. The caller checks the size.
 *
 * Entries of the table that the walk did not reach go, since no placement
 * draws them and they would be carried to every reader for nothing (§1.10).
 * An address `lookup` left alone is not walked into, so a carried object
 * reached only through someone else's object is dropped too.
 */
export async function carryAll(
  root: ShardModel,
  lookup: (ref: Ref) => CarryChoice | null | Promise<CarryChoice | null>,
): Promise<ShardModel> {
  let out = root
  const done = new Set<string>()
  const visit = async (m: ShardModel, depth: number, chain: Set<string>): Promise<void> => {
    if (depth > MAX_PART_DEPTH) return
    const used = new Set((m.parts ?? []).map((p) => p.ref))
    for (const [i, ref] of (m.refs ?? []).entries()) {
      if (!used.has(i) || ref[0] !== 'a' || chain.has(ref[1]) || done.has(ref[1])) continue
      done.add(ref[1])
      const held = out.objects ? carriedModel(out.objects, ref[1]) : undefined
      let next: ShardModel | null = held ?? null
      if (held === undefined) {
        const choice = await lookup(ref)
        if (!choice) continue
        if (choice.carry) out = carryObject(out, ref[1], choice.object)
        next = choice.object
      }
      if (next) await visit(next, depth + 1, new Set([...chain, ref[1]]))
    }
  }
  await visit(root, 1, new Set())
  for (const k of Object.keys(out.objects ?? {})) if (!done.has(k)) out = uncarry(out, k)
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

/**
 * The object without the placements at `indices`; references no placement uses
 * any more go, and the rest renumber. A carried object (§1.10) whose reference
 * goes goes with it, unless another entry of the table still places it.
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
    // Only what the removed placements reached: an entry neither reaches may be
    // placed beneath a fetched object, which this cannot see.
    for (const a of reach(addresses(s.refs ?? []))) if (!still.has(a)) out = uncarry(out, a)
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
