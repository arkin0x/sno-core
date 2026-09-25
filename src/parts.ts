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
 */

import { MAX_UNIT, PART_REACH, fromPayload, mirrorTurn, ticksOf, toRender, type Part, type Ref, type ShardModel } from './shards.js'

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

/**
 * Every placement of `model`, resolved. `self`, when the model is itself a
 * published object, counts as the first parent, so an object that places
 * itself is a loop at once. One fetch per distinct object, however many
 * times it is placed: a floor of 129 tiles fetches the tile once.
 */
export async function resolveParts(model: ShardModel, fetch: FetchRef, self?: Ref): Promise<Placed[]> {
  const cache = new Map<string, Promise<ShardModel | Missing>>()
  const load = (ref: Ref): Promise<ShardModel | Missing> => {
    const key = refKey(ref)
    let got = cache.get(key)
    if (!got) {
      got = fetch(ref).then(
        (payload) => (payload == null ? 'unreachable' : fromPayload(payload, key) ?? 'invalid'),
        () => 'unreachable' as const,
      )
      cache.set(key, got)
    }
    return got
  }
  const walk = async (m: ShardModel, depth: number, chain: Set<string>): Promise<Placed[]> => {
    const refs = m.refs ?? []
    return Promise.all((m.parts ?? []).map(async (part): Promise<Placed> => {
      const ref = refs[part.ref]
      const key = refKey(ref)
      const miss = (missing: Missing): Placed => ({ part, ref, model: null, missing, children: [] })
      if (chain.has(key)) return miss('cycle')
      if (depth > MAX_PART_DEPTH) return miss('deep')
      const got = await load(ref)
      if (typeof got === 'string') return miss(got)
      if (got.unit + part.step < 0 || got.unit + part.step > MAX_UNIT) return miss('scale')
      const children = got.parts ? await walk(got, depth + 1, new Set([...chain, key])) : []
      return { part, ref, model: got, children }
    }))
  }
  return walk(model, 1, new Set(self ? [refKey(self)] : []))
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

/** The object without the placements at `indices`; references no placement uses any more go, and the rest renumber. */
export function removeParts(s: ShardModel, indices: Iterable<number>): ShardModel {
  const gone = new Set(indices)
  const kept = (s.parts ?? []).filter((_, i) => !gone.has(i))
  const used = [...new Set(kept.map((p) => p.ref))].sort((x, y) => x - y)
  const renumber = new Map(used.map((old, k) => [old, k]))
  const refs = used.map((i) => (s.refs ?? [])[i])
  const parts = kept.map((p) => ({ ...p, ref: renumber.get(p.ref) as number }))
  const { refs: _r, parts: _p, ...rest } = s
  return parts.length ? { ...rest, refs, parts } : rest
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
