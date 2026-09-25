/**
 * winding.ts - which way a face looks, as the author says.
 *
 * A face's front is the side the right-hand normal of its corners, in order,
 * points to, in the wire's frame (DECK-0003 §1.4). Zero bytes: the order of
 * three indices already on the wire. A reader obeys it; this module is how an
 * author sets it.
 *
 *   FLIP FACE     one face turned round.
 *   FLIP SURFACE  a face turned round, and every face joined to it across a
 *                 clean edge turned to agree with it, out to where the
 *                 surface ends.
 *   AUTO          the whole shard rewound by the outward guess (orient.ts).
 *   windAdded     new faces wound by the guess as they are made, unless they
 *                 join an existing surface, in which case they agree with it.
 *
 * Everything here reads points through `toRender`, the wire's frame. The
 * model frame is the wire's with Z negated, a mirror, and a face that looks
 * out in one looks in in the other.
 *
 * Pure: each returns a new shard and leaves the one it was given alone. Face
 * order never changes, so `facecolors` and any face index held elsewhere
 * (the workshop's selected face) still point at the same face.
 */

import { orientShard } from './orient.js'
import { ticksOf, toRender, type ShardModel } from './shards.js'
import type { P3 } from './triangulate.js'

type Face = [number, number, number]

const key = (a: number, b: number): string => (a < b ? `${a}>${b}` : `${b}>${a}`)
const edgesOf = (f: Face): Array<[number, number]> => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]
const reversed = (f: Face): Face => [f[0], f[2], f[1]]
/** Whether `f` runs the edge a to b in that direction. */
const runs = (f: Face, a: number, b: number): boolean => edgesOf(f).some(([p, q]) => p === a && q === b)

/** The shard's points in the wire's frame, where winding is read. */
export function wirePoints(s: Pick<ShardModel, 'vertices'>): P3[] {
  return s.vertices.map((v) => toRender(ticksOf(v)))
}

/** Which faces lie on each edge, whichever way they run it. */
function edgeMap(faces: Face[]): Map<string, number[]> {
  const on = new Map<string, number[]>()
  faces.forEach((f, i) => {
    for (const [a, b] of edgesOf(f)) on.set(key(a, b), [...(on.get(key(a, b)) ?? []), i])
  })
  return on
}

/**
 * Walks out from `seeds` across clean edges (exactly two faces on them),
 * turning each face reached so that it agrees with the face it was reached
 * from: two faces wound the same way run their shared edge in opposite
 * directions. Only faces `may` allows are reached. Rewrites `faces` in place.
 */
function spread(faces: Face[], seeds: number[], may: (i: number) => boolean): void {
  const on = edgeMap(faces)
  const seen = new Set<number>(seeds)
  const queue = [...seeds]
  while (queue.length) {
    const i = queue.shift() as number
    for (const [a, b] of edgesOf(faces[i])) {
      const both = on.get(key(a, b)) as number[]
      if (both.length !== 2) continue
      const j = both[0] === i ? both[1] : both[0]
      if (seen.has(j) || !may(j)) continue
      seen.add(j)
      if (runs(faces[j], a, b)) faces[j] = reversed(faces[j])
      queue.push(j)
    }
  }
}

/**
 * The surface a face belongs to: it, and every face reachable from it across
 * clean edges. An edge with three or more faces on it is where solids touch
 * (orient.ts), and a surface stops there, as it stops at an open edge.
 */
export function surfaceOf(faces: Face[], i: number): number[] {
  const copy = faces.map((f) => [...f] as Face)
  const out: number[] = []
  spread(copy, [i], (j) => { out.push(j); return true })
  return [i, ...out].sort((a, b) => a - b)
}

/** FLIP FACE: one face turned round. */
export function flipFace(s: ShardModel, i: number): ShardModel {
  if (i < 0 || i >= s.faces.length) return s
  const faces = s.faces.map((f, j) => (j === i ? reversed(f) : f))
  return { ...s, faces }
}

/**
 * FLIP SURFACE: the face turned round, and its surface turned to agree with
 * it. A surface whose faces disagreed among themselves (a stamp's, before
 * winding was kept) comes out agreeing, all facing where the flipped face now
 * faces.
 */
export function flipSurface(s: ShardModel, i: number): ShardModel {
  if (i < 0 || i >= s.faces.length) return s
  const faces = s.faces.map((f) => [...f] as Face)
  faces[i] = reversed(faces[i])
  spread(faces, [i], () => true)
  return { ...s, faces }
}

/** AUTO: every face wound by the outward guess, whatever it was. */
export function windOutward(s: ShardModel): ShardModel {
  if (s.faces.length === 0) return s
  return { ...s, faces: orientShard(wirePoints(s), s.faces).faces }
}

/**
 * The faces from index `from` on are new: wound by the outward guess, except
 * that a new face joined across a clean edge to an older one agrees with the
 * older one, which the author may have turned on purpose. The older faces
 * are never touched.
 */
export function windAdded(s: ShardModel, from: number): ShardModel {
  if (from >= s.faces.length) return s
  const guessed = orientShard(wirePoints(s), s.faces).faces
  const faces = s.faces.map((f, i) => (i < from ? f : guessed[i]))
  const older = Array.from({ length: Math.min(from, faces.length) }, (_, i) => i)
  spread(faces, older, (j) => j >= from)
  return { ...s, faces }
}
