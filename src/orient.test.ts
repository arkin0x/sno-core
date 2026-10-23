import { describe, expect, it } from 'vitest'
import { orientFaces, orientShard } from './orient.js'
import { newell, type P3 } from './triangulate.js'
import { compile, STAMPS } from './stamps.js'
import { fromPayload, toRender, ticksOf } from './shards.js'
import { STAIR_RUN } from './stairRun.fixture.js'

const outwardCount = (pts: P3[], faces: Array<[number, number, number]>): { outward: number; inward: number } => {
  const c = pts.reduce<P3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
  let outward = 0, inward = 0
  for (const f of faces) {
    const [a, b, d] = f.map((i) => pts[i])
    const n = newell([a, b, d])
    const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]
    const dot = n[0] * m[0] + n[1] * m[1] + n[2] * m[2]
    if (dot > 1e-9) outward++; else if (dot < -1e-9) inward++
  }
  return { outward, inward }
}

describe('orientFaces', () => {
  it('turns every closed stamp fully outward, whatever it was authored as', () => {
    for (const k of STAMPS) {
      const s = compile(k, 2, 0, [0, 0, 0])
      if (s.faces.length === 0) continue
      const before = outwardCount(s.points, s.faces)
      const after = outwardCount(s.points, orientFaces(s.points, s.faces))
      if (before.outward + before.inward === s.faces.length) {
        // A closed shape: all outward afterwards.
        expect(after.inward, k).toBe(0)
        expect(after.outward, k).toBe(s.faces.length)
      }
    }
  })
  it('agrees across a shared edge and faces a flat plate up', () => {
    const pts: P3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    // Two triangles of one square, wound against each other.
    const faces: Array<[number, number, number]> = [[0, 1, 2], [0, 3, 2]]
    const out = orientFaces(pts, faces)
    const n0 = newell(out[0].map((i) => pts[i])), n1 = newell(out[1].map((i) => pts[i]))
    expect(Math.sign(n0[1])).toBe(Math.sign(n1[1]))
    expect(n0[1]).toBeGreaterThan(0)
  })
  it('leaves the stored faces alone', () => {
    const pts: P3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 1]]
    const faces: Array<[number, number, number]> = [[0, 2, 1]]
    orientFaces(pts, faces)
    expect(faces[0]).toEqual([0, 2, 1])
  })
})

/**
 * arkinox's arch (2026-09-07): two pillars with a lintel built by hand across
 * their tops. The pillars' top squares stayed under the lintel, so each of
 * their edges carries three faces, and the old walk carried agreement across
 * them and turned the whole right pillar's outer faces inward.
 */
const ARCH_P = [[-4,0,-1],[-3,0,-1],[-3,0,0],[-4,0,0],[-4,4,-1],[-3,4,-1],[-3,4,0],[-4,4,0],[3,0,-1],[4,0,-1],[4,0,0],[3,0,0],[3,4,-1],[4,4,-1],[4,4,0],[3,4,0],[3,5,0],[3,5,-1],[4,5,-1],[4,5,0],[-4,4,0],[-4,4,-1],[-3,5,-1],[-3,5,0]]
const ARCH_T = [[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[0,0,60],[60,60,60],[60,60,60],[0,0,60],[0,0,60]]
const ARCH_F: Array<[number, number, number]> = [[0,1,2],[0,2,3],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,2,6],[1,6,5],[8,10,11],[12,13,14],[12,14,15],[8,9,13],[8,13,12],[8,11,15],[8,15,12],[20,21,22],[22,23,20],[20,21,4],[4,7,20],[7,6,20],[23,20,6],[6,23,16],[16,15,6],[19,16,14],[16,15,14],[19,13,14],[19,18,13],[16,17,19],[18,17,19],[22,23,16],[16,17,22],[18,12,13],[18,17,12],[5,22,17],[12,17,5],[22,21,5],[4,5,21],[15,12,6],[5,6,12],[9,8,10],[14,13,9],[14,9,10],[15,14,10],[15,11,10]]
const archPoints = (): P3[] => ARCH_P.map((p, i) => [p[0] + ARCH_T[i][0] / 120, p[1] + ARCH_T[i][1] / 120, 0 - (p[2] + ARCH_T[i][2] / 120)])

describe('orientShard', () => {
  it('turns every outer face of the arch outward', () => {
    const pts = archPoints()
    const { faces } = orientShard(pts, ARCH_F)
    const n = (i: number): P3 => { const m = newell(faces[i].map((v) => pts[v])); const l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l] }
    const expectDir = (i: number, d: P3): void => { const m = n(i); expect(m[0]).toBeCloseTo(d[0], 5); expect(m[1]).toBeCloseTo(d[1], 5); expect(m[2]).toBeCloseTo(d[2], 5) }
    // Right pillar: bottom down, +X side out, inner side toward the opening, both z sides out.
    expectDir(43, [0, -1, 0]); expectDir(12, [0, -1, 0])
    expectDir(44, [1, 0, 0]); expectDir(45, [1, 0, 0])
    expectDir(17, [-1, 0, 0]); expectDir(18, [-1, 0, 0])
    expectDir(46, [0, 0, -1]); expectDir(47, [0, 0, -1])
    expectDir(15, [0, 0, 1]); expectDir(16, [0, 0, 1])
    // Left pillar the same way round.
    expectDir(0, [0, -1, 0]); expectDir(8, [-1, 0, 0]); expectDir(10, [1, 0, 0]); expectDir(4, [0, 0, 1]); expectDir(6, [0, 0, -1])
    // The lintel's top up and its underside down.
    expectDir(31, [0, 1, 0]); expectDir(33, [0, 1, 0]); expectDir(41, [0, -1, 0]); expectDir(42, [0, -1, 0])
  })

  it('keeps two blocks stamped one on the other outward', () => {
    const lower = compile('block', 1, 0, [0, 0, 0])
    const upper = compile('block', 1, 0, [0, 120, 0])
    const points: P3[] = [...lower.points, ...upper.points].map((p) => [p[0] / 120, p[1] / 120, 0 - p[2] / 120])
    const faces: Array<[number, number, number]> = [...lower.faces, ...upper.faces.map((f) => [f[0] + lower.points.length, f[1] + lower.points.length, f[2] + lower.points.length] as [number, number, number])]
    const { faces: out } = orientShard(points, faces)
    out.forEach((f) => {
      const m = newell(f.map((v) => points[v]))
      const c = f.reduce((a, v) => [a[0] + points[v][0] / 3, a[1] + points[v][1] / 3, a[2] + points[v][2] / 3], [0, 0, 0])
      // The square between the two, where the blocks meet, has no outside to face.
      if (Math.abs(c[1] - 1) < 1e-9) return
      // Outward from the joined column's middle, at (0.5, 1, -0.5).
      expect((c[0] - 0.5) * m[0] + (c[1] - 1) * m[1] + (c[2] + 0.5) * m[2]).toBeGreaterThan(0)
    })
  })
})

/**
 * Solids wound one at a time (arkinox, 2026-10-12). XOR's avatar is a stella
 * octangula, two tetrahedra pushed through each other, and AUTO turned all
 * eight of its faces inward: the middle of each face sits inside the other
 * tetrahedron, and a shard-wide ray vote read that as pointing in.
 */
describe('orientShard, one solid at a time', () => {
  type F = [number, number, number]
  /** Every face's normal points away from `c`, the middle of its own solid. */
  const allOutwardFrom = (pts: P3[], faces: F[], c: P3): boolean =>
    faces.every((f) => {
      const [a, b, d] = f.map((i) => pts[i])
      const n = newell([a, b, d])
      const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]
      return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 1e-9
    })
  const shift = (faces: F[], k: number): F[] => faces.map((f) => [f[0] + k, f[1] + k, f[2] + k])
  const flipped = (f: F): F => [f[0], f[2], f[1]]
  /** A tetrahedron's four faces, every other one wound the wrong way. */
  const tetraFaces = (k = 0): F[] => shift([[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], k).map((f, i) => (i % 2 ? flipped(f) : f))
  const cubePoints = (o: P3 = [0, 0, 0], s = 1): P3[] =>
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) => [o[0] + p[0] * s, o[1] + p[1] * s, o[2] + p[2] * s])
  /** A unit cube's twelve triangles, wound outward. */
  const CUBE: F[] = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]

  it('winds a single tetrahedron outward', () => {
    const pts: P3[] = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]]
    const faces = orientFaces(pts, tetraFaces())
    expect(allOutwardFrom(pts, faces, [0.5, 0.5, 0.5])).toBe(true)
  })

  it('winds a cube outward from all inward', () => {
    const pts = cubePoints()
    const faces = orientFaces(pts, CUBE.map(flipped))
    expect(allOutwardFrom(pts, faces, [0.5, 0.5, 0.5])).toBe(true)
  })

  it('winds both tetrahedra of a stella octangula outward', () => {
    // Alternate corners of a cube: two tetrahedra through each other, no
    // corner or edge shared, eight faces in all.
    const pts: P3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1], [-1, 1, 1], [1, -1, 1], [1, 1, -1]]
    for (const start of [[...tetraFaces(0), ...tetraFaces(4)], [...tetraFaces(0), ...tetraFaces(4)].map(flipped)]) {
      const { faces } = orientShard(pts, start)
      expect(faces).toHaveLength(8)
      expect(allOutwardFrom(pts, faces, [0, 0, 0])).toBe(true)
    }
  })

  it('winds two disjoint cubes each by itself', () => {
    const pts = [...cubePoints([0, 0, 0]), ...cubePoints([5, 0, 0])]
    const faces = orientFaces(pts, [...CUBE.map(flipped), ...shift(CUBE, 8)])
    expect(allOutwardFrom(pts, faces.slice(0, 12), [0.5, 0.5, 0.5])).toBe(true)
    expect(allOutwardFrom(pts, faces.slice(12), [5.5, 0.5, 0.5])).toBe(true)
  })

  it('winds two cubes pushed through each other each by itself', () => {
    const pts = [...cubePoints([0, 0, 0], 2), ...cubePoints([1, 1, 1], 2)]
    const faces = orientFaces(pts, [...CUBE, ...shift(CUBE, 8).map(flipped)])
    expect(allOutwardFrom(pts, faces.slice(0, 12), [1, 1, 1])).toBe(true)
    expect(allOutwardFrom(pts, faces.slice(12), [2, 2, 2])).toBe(true)
  })

  it('turns back the one flipped face of a cube', () => {
    const pts = cubePoints()
    for (let k = 0; k < CUBE.length; k++) {
      const faces = orientFaces(pts, CUBE.map((f, i) => (i === k ? flipped(f) : f)))
      expect(faces).toEqual(CUBE)
    }
  })

  it('keeps an open shell as before: a lidless box faces out, a lone plate faces up', () => {
    // The cube without its top (faces 6 and 7, the y = 1 side).
    const open = CUBE.filter((_, i) => i !== 6 && i !== 7)
    const pts = cubePoints()
    for (const start of [open, open.map(flipped)]) {
      expect(allOutwardFrom(pts, orientFaces(pts, start), [0.5, 0.5, 0.5])).toBe(true)
    }
    const plate: P3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    const up = orientFaces(plate, [[0, 1, 2], [0, 2, 3]])
    for (const f of up) expect(newell(f.map((i) => plate[i]))[1]).toBeGreaterThan(0)
  })

  it('leaves degenerate faces as they came, and they do not open a closed solid', () => {
    const pts: P3[] = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 0, 0]]
    // A repeated corner, and corners on a line along the tetrahedron's 0-1 edge.
    const junk: F[] = [[0, 0, 3], [0, 4, 1], [1, 0, 4]]
    const faces = orientFaces(pts, [...tetraFaces().map(flipped), ...junk])
    expect(allOutwardFrom(pts, faces.slice(0, 4), [0.5, 0.5, 0.5])).toBe(true)
    expect(faces.slice(4)).toEqual(junk)
    expect(orientShard(pts, junk).faces).toEqual(junk)
  })
})

/**
 * The guess winds faces and never hides one (DECK-0003 §1.4: a reader draws
 * every face). It used to report faces "inside a join" by counting what rays
 * from each face's middle crossed, both benches left those undrawn, and on
 * shapes that are not one closed solid the count is wrong: arkinox's Stair
 * run lost the lower triangle of each low riser (2026-10-23).
 */
/** orientShard's faces for the Stair run under 0.1.18, which still had the report. */
const STAIR_RUN_WOUND_0_1_18: Array<[number, number, number]> = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,5,1],[0,4,5],[1,6,2],[1,5,6],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[8,9,10],[8,10,11],[12,14,13],[12,15,14],[8,13,9],[8,12,13],[9,14,10],[9,13,14],[11,10,14],[11,14,15],[8,11,15],[8,15,12],[16,17,18],[16,18,19],[20,22,21],[20,23,22],[16,21,17],[16,20,21],[17,22,18],[17,21,22],[19,18,22],[19,22,23],[16,19,23],[16,23,20],[24,25,26],[24,26,27],[28,30,29],[28,31,30],[24,29,25],[24,28,29],[25,30,26],[25,29,30],[27,26,30],[27,30,31],[24,27,31],[24,31,28],[32,33,34],[32,34,35],[36,38,37],[36,39,38],[32,37,33],[32,36,37],[33,38,34],[33,37,38],[35,34,38],[35,38,39],[32,35,39],[32,39,36],[40,41,42],[40,42,43],[44,46,45],[44,47,46],[40,45,41],[40,44,45],[41,46,42],[41,45,46],[43,42,46],[43,46,47],[40,43,47],[40,47,44]]

describe('orientShard says nothing about drawing', () => {
  const stairs = fromPayload(STAIR_RUN, 'stair-run')!
  const pts = stairs.vertices.map((v) => toRender(ticksOf(v)))

  it('reads the Stair run as deployed: 48 vertices, 72 faces', () => {
    expect(stairs.vertices).toHaveLength(48)
    expect(stairs.faces).toHaveLength(72)
  })

  it('returns no report of which faces to leave out', () => {
    expect(orientShard(pts, stairs.faces)).not.toHaveProperty('interior')
  })

  it('winds the Stair run exactly as 0.1.18 did: the report went, the winding did not change', () => {
    expect(orientShard(pts, stairs.faces).faces).toEqual(STAIR_RUN_WOUND_0_1_18)
    // Rewound first, all of it or every other face, it comes back the same: the guess winds, it does not echo.
    expect(orientShard(pts, stairs.faces.map(([a, b, c]) => [a, c, b] as [number, number, number])).faces).toEqual(STAIR_RUN_WOUND_0_1_18)
    expect(orientShard(pts, stairs.faces.map(([a, b, c], i) => (i % 2 ? [a, c, b] : [a, b, c]) as [number, number, number])).faces).toEqual(STAIR_RUN_WOUND_0_1_18)
  })

  it('has no report for the arch or a stamped pair of blocks either', () => {
    expect(orientShard(archPoints(), ARCH_F)).not.toHaveProperty('interior')
    const lower = compile('block', 1, 0, [0, 0, 0]), upper = compile('block', 1, 0, [0, 120, 0])
    const points: P3[] = [...lower.points, ...upper.points].map((p) => [p[0] / 120, p[1] / 120, 0 - p[2] / 120])
    const faces = [...lower.faces, ...upper.faces.map((f) => [f[0] + lower.points.length, f[1] + lower.points.length, f[2] + lower.points.length] as [number, number, number])]
    expect(orientShard(points, faces)).not.toHaveProperty('interior')
  })
})
