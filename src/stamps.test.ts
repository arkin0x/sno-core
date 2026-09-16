/**
 * What these prove: every stamp is a clean piece of geometry before it ever
 * reaches a shard, and every stamp does the job the bench asks of it.
 *
 * The bug the winding half of this file was written for: half of a block's
 * twelve triangles were listed the other way round. The box was closed and its
 * points were right, so it looked correct in a viewer that draws both sides of
 * a face and looked torn in one that does not, which is what a bench is
 * (ShardMesh draws fronts in colour and backs in grey). Every solid stamp had
 * it, worst of all the pyramid, whose four sides all faced inward.
 *
 * Winding is not a rendering detail here. An object published as SNO is read
 * by tools that have never seen the client that made it, and a front face is
 * the only thing that tells them which side of a surface is the outside.
 *
 * The rest is behaviour: every stamp is a valid shard at every size, stays
 * inside the grid wherever it is tapped, turns with FACING, lands where its
 * ghost stood, and two stamps that touch lose the wall between them rather
 * than paying for it.
 */

import { describe, expect, it } from 'vitest'
import { FACED, MAX_SIZE, MIN_SIZE, STAMPS, compile, landing, onPlane, preview, stamp, type Facing, type StampKind } from './stamps.js'
import { GRID_HALF, MAX_VERTICES, TICKS_PER_UNIT as T, newShard, ticksOf, validFace, validPoint, type ShardModel } from './shards.js'

const red: [number, number, number] = [1, 0, 0]
const empty = (): ShardModel => ({ ...newShard('t'), mode: 'solid' })

const SIZES = Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => MIN_SIZE + i)
const FACINGS: Facing[] = [0, 1, 2, 3]
/** The ones that enclose a volume, as against the flat ones drawn on the level. */
const SOLID: StampKind[] = ['block', 'column', 'pyramid', 'wedge']

type V3 = [number, number, number]

function geometry(kind: StampKind, size: number, facing: Facing): { points: V3[]; faces: Array<[number, number, number]> } {
  const g = preview(kind, size, facing, [1, 1, 1])
  return { points: g.vertices.map((v) => ticksOf(v) as V3), faces: g.faces }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
const dot = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

/** Twice the area of a triangle, as a vector along its normal. */
function areaVector(a: V3, b: V3, c: V3): V3 {
  return cross(sub(b, a), sub(c, a))
}

describe.each(STAMPS)('the %s stamp', (kind) => {
  it.each(SIZES)('at size %i has no degenerate or repeated triangle', (size) => {
    const { points, faces } = geometry(kind, size, 0)
    for (const f of faces) {
      const key = f.map((i) => points[i].join(','))
      expect(new Set(key).size, `triangle ${f.join(',')} has a repeated corner`).toBe(3)
      expect(areaVector(points[f[0]], points[f[1]], points[f[2]]).some((n) => n !== 0), `triangle ${f.join(',')} has no area`).toBe(true)
    }
    const keys = faces.map((f) => f.map((i) => points[i].join(',')).sort().join('|'))
    expect(new Set(keys).size, 'the same three corners appear twice').toBe(keys.length)
  })

  it.each(SIZES)('at size %i carries no vertex it does not use', (size) => {
    const { points, faces } = geometry(kind, size, 0)
    // A shape with no faces is a loop: its closing point repeats the first on
    // purpose, so LINES draws it shut. Anything with faces has no such excuse.
    if (faces.length === 0) return
    const used = new Set(faces.flat())
    expect(used.size, 'a vertex no triangle refers to').toBe(points.length)
    const seen = points.map((p) => p.join(','))
    expect(new Set(seen).size, 'two vertices at the same place').toBe(seen.length)
  })
})

describe.each(SOLID)('the %s stamp encloses a volume', (kind) => {
  it.each(SIZES)('at size %i is closed: every edge used once each way', (size) => {
    const { faces } = geometry(kind, size, 0)
    const edges = new Map<string, number>()
    for (const f of faces) {
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
        edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1)
      }
    }
    for (const [e, n] of edges) {
      const [a, b] = e.split('>')
      expect(n, `edge ${e} appears ${n} times in the same direction`).toBe(1)
      expect(edges.get(`${b}>${a}`), `edge ${e} has no partner facing the other way, so there is a hole`).toBe(1)
    }
  })

  it.each(FACINGS)('facing %i has every triangle facing outward', (facing) => {
    for (const size of SIZES) {
      const { points, faces } = geometry(kind, size, facing)
      const used = [...new Set(faces.flat())]
      const middle = [0, 1, 2].map((a) => used.reduce((sum, i) => sum + points[i][a], 0) / used.length) as V3
      for (const f of faces) {
        const [a, b, c] = f.map((i) => points[i])
        const outward = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - middle[k]) as V3
        // These are all convex, so away from the middle is away from the shape.
        expect(dot(areaVector(a, b, c), outward), `${kind} size ${size} facing ${facing}: triangle ${f.join(',')} faces inward`).toBeGreaterThan(0)
      }
    }
  })
})

describe('the flat stamps tile their outline exactly', () => {
  it.each(['star', 'arrow'] as StampKind[])('%s leaves no hole and no overlap', (kind) => {
    for (const size of SIZES) {
      const { points, faces } = geometry(kind, size, 0)
      // On the level, so the outline's area is its shoelace sum over X and Z,
      // and the triangles must add up to exactly that: less is a hole, more is
      // an overlap. The outline is the points in the order they were made.
      const loop = points
      let twiceOutline = 0
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length]
        twiceOutline += a[0] * b[2] - b[0] * a[2]
      }
      const twiceTris = faces.reduce((sum, f) => {
        const [a, b, c] = f.map((i) => points[i])
        return sum + ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]))
      }, 0)
      expect(Math.abs(twiceTris), `${kind} at size ${size}`).toBe(Math.abs(twiceOutline))
    }
  })
})

describe('the cull between touching stamps', () => {
  // The reason each side is split along the diagonal its neighbour would
  // choose: two boxes that share a wall must produce the same pair of
  // triangles there, or the wall stays inside the object as two coincident
  // surfaces. Reversing a side to face outward had to keep that diagonal, and
  // this is what says it did.
  it('drops the wall where two blocks meet, both copies of it', () => {
    const one = stamp(empty(), 'block', 2, 0, [0, 0, 0], [1, 1, 1])
    expect(one).not.toBeNull()
    // The next block along X, exactly one block away, so they share a face.
    const two = stamp(one!.shard, 'block', 2, 0, [2 * T, 0, 0], [1, 1, 1])
    expect(two).not.toBeNull()
    // Two triangles gone from each side of the shared wall.
    expect(two!.culled).toBe(4)
    expect(two!.shard.faces.length).toBe(12 + 12 - 4)
  })

  it('leaves both whole when they do not touch', () => {
    const one = stamp(empty(), 'block', 2, 0, [0, 0, 0], [1, 1, 1])
    const two = stamp(one!.shard, 'block', 2, 0, [6 * T, 0, 0], [1, 1, 1])
    expect(two!.culled).toBe(0)
    expect(two!.shard.faces.length).toBe(24)
  })
})

describe('stamps', () => {
  it('every kind at every size is integer, inside the grid, with faces that exist', () => {
    for (const kind of STAMPS) for (let size = 1; size <= 4; size++) {
      const s = compile(kind, size, 0, [0, 0, 0])
      expect(s.points.length, `${kind} ${size}`).toBeGreaterThan(0)
      for (const p of s.points) expect(validPoint(p), `${kind} ${size} ${p}`).toBe(true)
      for (const f of s.faces) expect(validFace(f, s.points.length), `${kind} ${size} ${f}`).toBe(true)
    }
  })

  it('has the expected budgets', () => {
    const count = (k: StampKind, s = 1) => { const c = compile(k, s, 0, [0, 0, 0]); return [c.points.length, c.faces.length] }
    expect(count('block')).toEqual([8, 12])
    expect(count('column')).toEqual([8, 12])
    expect(count('pyramid')).toEqual([5, 6])
    expect(count('wedge')).toEqual([6, 8])
    expect(count('ring')).toEqual([9, 0])
    // Seven points, not eight: a shape with faces no longer carries a copy of
    // its first point. That copy exists only so LINES can shut a loop, and a
    // shape that is drawn as triangles never needed it (stamps.ts `flat`).
    expect(count('arrow')).toEqual([7, 5])
    expect(count('star')[1]).toBeGreaterThanOrEqual(6)
  })

  it('closes a loop only when there are no faces to draw instead', () => {
    // The closing point is for LINES, which has no other way to shut a loop.
    // A shape with triangles is drawn as triangles, and a repeated point there
    // is a second vertex sitting exactly on the first: budget spent on nothing,
    // and one more corner for a selection or a colour to land on by accident.
    const { points: ring, faces: ringFaces } = compile('ring', 2, 0, [0, 0, 0])
    expect(ringFaces).toHaveLength(0)
    expect(ring[ring.length - 1]).toEqual(ring[0])
    for (const kind of ['star', 'arrow'] as StampKind[]) {
      const { points, faces } = compile(kind, 2, 0, [0, 0, 0])
      expect(faces.length, kind).toBeGreaterThan(0)
      expect(points[points.length - 1], kind).not.toEqual(points[0])
    }
  })

  it('stands on the level and centres on the tap', () => {
    const { points } = compile('block', 2, 0, [3 * T, -2 * T, 1 * T])
    expect(Math.min(...points.map((p) => p[1]))).toBe(-2 * T)
    expect(Math.max(...points.map((p) => p[1]))).toBe(0)
    expect(Math.min(...points.map((p) => p[0]))).toBe(2 * T)
    expect(Math.max(...points.map((p) => p[0]))).toBe(4 * T)
  })

  it('is pushed back inside the grid when tapped at the edge', () => {
    for (const kind of STAMPS) {
      const { points } = compile(kind, 4, 0, [GRID_HALF * T, GRID_HALF * T, GRID_HALF * T])
      for (const p of points) expect(validPoint(p), `${kind} ${p}`).toBe(true)
    }
  })

  it('turns the faced shapes a quarter turn about Y and leaves the rest alone', () => {
    const tip = (f: Facing) => { const { points } = compile('arrow', 1, f, [0, 0, 0]); return points.reduce((a, b) => (Math.hypot(b[0], b[2]) > Math.hypot(a[0], a[2]) ? b : a)) }
    expect(tip(0)).toEqual([3 * T, 0, 0])
    expect(tip(1)).toEqual([0, 0, 3 * T])
    expect(tip(2)).toEqual([-3 * T, 0, 0])
    expect(tip(3)).toEqual([0, 0, -3 * T])
    for (const kind of STAMPS) if (!FACED[kind]) expect(compile(kind, 2, 3, [0, 0, 0])).toEqual(compile(kind, 2, 0, [0, 0, 0]))
  })

  it('appends its own vertices in the given color and keeps the shard valid', () => {
    const one = stamp(empty(), 'pyramid', 1, 0, [0, 0, 0], red)!
    expect(one.shard.vertices).toHaveLength(5)
    expect(one.shard.vertices.every((v) => v.c.join() === '1,0,0')).toBe(true)
    expect(one.shard.faces).toHaveLength(6)
    expect(one.culled).toBe(0)
    for (const f of one.shard.faces) expect(validFace(f, 5)).toBe(true)
  })

  it('drops the wall between two blocks that touch, on both sides', () => {
    const a = stamp(empty(), 'block', 1, 0, [0, 0, 0], red)!
    const b = stamp(a.shard, 'block', 1, 0, [T, 0, 0], [0, 0, 1])!
    expect(b.shard.vertices).toHaveLength(16)
    expect(b.culled).toBe(4)
    expect(b.shard.faces).toHaveLength(24 - 4)
    // Stacked, the same: the top of one and the bottom of the other.
    const c = stamp(a.shard, 'block', 1, 0, [0, T, 0], red)!
    expect(c.culled).toBe(4)
    // Diagonal neighbours share an edge, not a wall: nothing to drop.
    const d = stamp(a.shard, 'block', 1, 0, [T, T, 0], red)!
    expect(d.culled).toBe(0)
  })

  it('never merges vertices, so a seam between colors stays crisp', () => {
    const a = stamp(empty(), 'block', 1, 0, [0, 0, 0], red)!
    const b = stamp(a.shard, 'block', 1, 0, [T, 0, 0], [0, 0, 1])!
    const at = b.shard.vertices.filter((v) => ticksOf(v).join() === `${T},0,0`)
    expect(at).toHaveLength(2)
    expect(at.map((v) => v.c.join()).sort()).toEqual(['0,0,1', '1,0,0'])
  })

  it('refuses a stamp that would not fit the budget', () => {
    const full: ShardModel = { ...empty(), vertices: Array.from({ length: MAX_VERTICES - 4 }, (_, i) => ({ p: [i % 17 - 8, 0, 0] as [number, number, number], c: red })) }
    expect(stamp(full, 'pyramid', 1, 0, [0, 0, 0], red)).toBeNull()
    expect(stamp(full, 'block', 1, 0, [0, 0, 0], red)).toBeNull()
  })

  it('previews as a solid when it has faces and as lines when it does not', () => {
    expect(preview('block', 1, 0, red).mode).toBe('solid')
    expect(preview('ring', 1, 0, red).mode).toBe('lines')
  })
})

describe('ghost placement', () => {
  const red: [number, number, number] = [1, 0, 0]
  it('the preview moved to its landing is exactly the stamp, edge pushes included', () => {
    for (const kind of STAMPS) {
      for (const origin of [[0, 0, 0], [GRID_HALF * T, 0, GRID_HALF * T], [-GRID_HALF * T, 3 * T, 2 * T]] as Array<[number, number, number]>) {
        const at = landing(kind, 4, 1, origin)
        const ghost = preview(kind, 4, 1, red).vertices.map((v) => { const t = ticksOf(v); return [t[0] + at[0], t[1] + at[1], t[2] + at[2]] })
        expect(ghost).toEqual(compile(kind, 4, 1, origin).points)
      }
    }
  })
  it('lands on the aim unless the grid edge pushes it back', () => {
    expect(landing('block', 2, 0, [T, 0, T])).toEqual([T, 0, T])
    expect(landing('block', 4, 0, [GRID_HALF * T, 0, GRID_HALF * T])[0]).toBeLessThan(GRID_HALF * T)
  })
})

describe('onPlane', () => {
  it('turns up along the plane normal by a proper rotation, and leaves the floor alone', () => {
    const up: [number, number, number] = [0, 120, 0]
    expect(onPlane([up], 1)).toEqual([up])
    expect(onPlane([up], 0)).toEqual([[120, 0, 0]])
    expect(onPlane([up], 2)).toEqual([[0, 0, 120]])
    // Right-handed: x cross y stays z after the turn.
    const [x, y, z] = onPlane([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 2)
    const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    expect(cross).toEqual(z)
  })
})
