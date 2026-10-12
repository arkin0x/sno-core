/**
 * orient.ts - the guess at which way each face looks out.
 *
 * Winding is a face's front (DECK-0003 §1.4, since 2026-09-24): the side the
 * right-hand normal of its corners, in order, points to. A reader obeys it and
 * never guesses. The guess lives here for the author's side only: new faces
 * are wound by it as they are made, and AUTO rewinds a whole shard by it
 * (winding.ts). Stamps compile with half a block's triangles wound inward,
 * and hand-picked corners and FILL wind whichever way the taps went, so
 * without it every new face would be a coin toss.
 *
 * This pass rewinds a copy; the faces it is given are untouched.
 *
 * The faces fall into solids first: faces reachable from each other across
 * shared edges, of any count. Each solid is wound on its own, by its own
 * geometry, so two solids pushed through each other (XOR's stella octangula)
 * never vote on each other (arkinox, 2026-10-12).
 *
 * Within a solid, faces that share a clean edge (one with exactly two faces on
 * it) are made to agree, since a shared edge runs opposite ways in two
 * consistently wound faces; that groups the faces into patches. A closed
 * solid, every edge clean, is one patch, and its signed volume decides it:
 * positive when the faces look out. Any other patch is turned as a whole by
 * what its faces can see: a ray from a face's middle along its normal crosses
 * the rest of its solid an even number of times when the normal points out
 * and an odd number when it points in. The patch goes the way most of its
 * area votes. A patch whose rays cross nothing (a flat plate, an open shell)
 * faces up, or along +X or +Z when it stands more that way.
 *
 * The points must be in the wire's frame (shards.ts toRender), because that
 * is the frame the format's winding rule is stated in (DECK-0003 §1.4): the
 * client's model frame is the wire's with Z negated, a mirror, and a face
 * wound outward in one is wound inward in the other.
 *
 * Edges with three or more faces on them do not carry agreement across. They
 * are where solids touch: a block built on a block leaves the square between
 * them inside the join, with the lower block's top, the upper block's sides
 * and the lower block's sides all meeting on its edges. Passing agreement
 * through such an edge is what used to turn a whole side of a shape inward,
 * depending on which face the walk happened to reach first. A face whose
 * rays cross an odd number of faces of the whole shard both ways is inside a
 * solid; it is reported so the bench can leave it undrawn, where it would only
 * fight the face it sits against. Degenerate faces (a repeated corner, or
 * corners on a line) are left as they came.
 */

import { newell, type P3 } from './triangulate.js'

type Face = [number, number, number]

export interface Oriented {
  /** The faces, rewound. */
  faces: Face[]
  /** Which faces sit inside the solid, with faces on both sides of them. */
  interior: boolean[]
}

const key = (a: number, b: number): string => (a < b ? `${a}>${b}` : `${b}>${a}`)

const EPS = 1e-9
/**
 * Whether a ray from `o` along `d` meets triangle abc ahead of its start
 * (Moller and Trumbore). Rays run at a slight slant to the axes, so on the
 * axis-aligned shapes the bench makes they cross faces, not edges.
 */
function hit(o: P3, d: P3, a: P3, b: P3, c: P3): boolean {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
  if (Math.abs(det) < EPS) return false
  const inv = 1 / det
  const t = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inv
  if (u < 0 || u > 1) return false
  const q = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]]
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv
  if (v < 0 || u + v > 1) return false
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
  return dist > 1e-7
}

/** How many other faces a ray from face `i`'s middle crosses along `dir`. */
function crossings(points: P3[], faces: Face[], i: number, origin: P3, dir: P3): number {
  let n = 0
  for (let j = 0; j < faces.length; j++) {
    if (j === i) continue
    const f = faces[j]
    if (hit(origin, dir, points[f[0]], points[f[1]], points[f[2]])) n++
  }
  return n
}

/** A slant that no axis-aligned edge lies along, added to every ray. */
const SLANT: P3 = [0.0173, 0.0311, 0.0237]

export function orientShard(points: P3[], faces: Face[]): Oriented {
  const out: Face[] = faces.map((f) => [f[0], f[1], f[2]])
  const n = out.length
  const interior = new Array<boolean>(n).fill(false)
  if (n === 0) return { faces: out, interior }

  const flip = (f: Face): void => { const t = f[1]; f[1] = f[2]; f[2] = t }
  const hasDirected = (f: Face, a: number, b: number): boolean =>
    (f[0] === a && f[1] === b) || (f[1] === a && f[2] === b) || (f[2] === a && f[0] === b)
  const edges = (f: Face): Array<[number, number]> => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]

  // Each face's middle, slanted ray direction and area. A degenerate face (a
  // repeated corner, or corners on a line) has no way round to find; it is
  // left as it came and takes no part in the walk, so it cannot join two
  // faces that do not meet or open a closed solid (arkinox, 2026-10-12).
  const mid: P3[] = [], dir: P3[] = [], area: number[] = [], degenerate: boolean[] = []
  for (let i = 0; i < n; i++) {
    const f = out[i]
    const [a, b, c] = f.map((v) => points[v])
    const m = newell([a, b, c])
    const len = Math.hypot(m[0], m[1], m[2])
    degenerate.push(f[0] === f[1] || f[1] === f[2] || f[2] === f[0] || !(len > 1e-12))
    const nm: P3 = len > 0 ? [m[0] / len, m[1] / len, m[2] / len] : [0, 1, 0]
    area.push(len / 2)
    mid.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3])
    dir.push([nm[0] + SLANT[0], nm[1] + SLANT[1], nm[2] + SLANT[2]])
  }
  const back = (d: P3): P3 => [-d[0], -d[1], -d[2]]

  // Which faces lie on each edge, whichever way they run it.
  const byEdge = new Map<string, number[]>()
  out.forEach((f, i) => {
    if (degenerate[i]) return
    for (const [a, b] of edges(f)) byEdge.set(key(a, b), [...(byEdge.get(key(a, b)) ?? []), i])
  })

  // Interior is a fact about the whole shard: a square buried between two
  // blocks is buried whether or not the blocks share corners.
  for (let i = 0; i < n; i++) {
    if (degenerate[i]) continue
    interior[i] = crossings(points, out, i, mid[i], dir[i]) % 2 === 1 && crossings(points, out, i, mid[i], back(dir[i])) % 2 === 1
  }

  // Which way round is decided one connected solid at a time: the faces
  // reachable from each other across shared edges, of any count. Solids that
  // only pass through each other share no edge and never vote on each other.
  // XOR's avatar, a stella octangula (two tetrahedra pushed through each
  // other), came out all inward under a shard-wide vote: the middle of every
  // face sits inside the other tetrahedron, so its outward ray crossed one
  // face of it and read as pointing in (arkinox, 2026-10-12).
  const component = new Array<number>(n).fill(-1)
  const members: number[][] = []
  for (let s = 0; s < n; s++) {
    if (degenerate[s] || component[s] >= 0) continue
    const c = members.length
    const list = [s]
    component[s] = c
    for (let k = 0; k < list.length; k++) {
      for (const [a, b] of edges(out[list[k]])) {
        for (const j of byEdge.get(key(a, b)) ?? []) {
          if (component[j] < 0) { component[j] = c; list.push(j) }
        }
      }
    }
    members.push(list)
  }

  const seen = new Array<boolean>(n).fill(false)
  for (const list of members) {
    // Closed: every edge of the solid has exactly two faces on it.
    const closed = list.every((i) => edges(out[i]).every(([a, b]) => (byEdge.get(key(a, b)) ?? []).length === 2))
    const sub = list.map((i) => out[i])
    // What a face's rays cross each way, counting only this solid's faces.
    let fwd: Map<number, number> | null = null, bwd: Map<number, number> | null = null
    const sight = (): void => {
      if (fwd) return
      fwd = new Map(); bwd = new Map()
      list.forEach((i, k) => {
        fwd!.set(i, crossings(points, sub, k, mid[i], dir[i]))
        bwd!.set(i, crossings(points, sub, k, mid[i], back(dir[i])))
      })
    }

    const patch: number[] = []
    for (const start of list) {
      if (seen[start]) continue
      const queue = [start]
      seen[start] = true
      patch.length = 0
      while (queue.length) {
        const i = queue.shift() as number
        patch.push(i)
        for (const [a, b] of edges(out[i])) {
          const on = byEdge.get(key(a, b)) ?? []
          if (on.length !== 2) continue
          for (const j of on) {
            if (j === i || seen[j]) continue
            if (hasDirected(out[j], a, b)) flip(out[j])
            seen[j] = true
            queue.push(j)
          }
        }
      }

      // A closed solid is one patch, and its signed volume says which way
      // it is wound: positive when the faces look out. Exact, and blind to
      // anything else in the shard (arkinox, 2026-10-12).
      let inward: boolean | null = null
      if (closed) {
        let volume = 0
        for (const i of patch) {
          const [a, b, c] = out[i].map((v) => points[v])
          volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        }
        if (Math.abs(volume) > 1e-9) inward = volume < 0
      }

      if (inward === null) {
        // The patch as a whole, by what its faces see of their own solid. A
        // face's ray was cast as it was wound at the start; a face the walk
        // flipped now faces the other way, so its vote turns with it.
        sight()
        let vote = 0
        for (const i of patch) {
          const f = fwd!.get(i)! % 2, b = bwd!.get(i)! % 2
          if (f === 1 && b === 1) continue
          const turned = hasDirected(out[i], faces[i][0], faces[i][1]) ? 1 : -1
          const outward = f === 0 && b === 1 ? 1 : f === 1 && b === 0 ? -1 : 0
          vote += turned * outward * area[i]
        }
        if (vote !== 0) inward = vote < 0
      }

      if (inward === null) {
        // Nothing to see: an open sheet or shell faces up, or along +X or +Z
        // when it stands more that way. Never by volume: an open sheet's
        // signed volume is measured from the origin, so it says only which
        // side of the origin the sheet sits: arkinox's Disco Floor base
        // plate, one step below it, came out facing down and showed its dark
        // inside through every gap (2026-09-24).
        let nx = 0, ny = 0, nz = 0
        for (const i of patch) {
          const m = newell(out[i].map((v) => points[v])); nx += m[0]; ny += m[1]; nz += m[2]
        }
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
        inward = ay >= ax && ay >= az ? ny < 0 : ax >= az ? nx < 0 : nz < 0
      }
      if (inward) for (const i of patch) flip(out[i])
    }
  }
  return { faces: out, interior }
}

/** The faces rewound outward; see orientShard. */
export function orientFaces(points: P3[], faces: Face[]): Face[] {
  return orientShard(points, faces).faces
}
