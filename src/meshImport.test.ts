/**
 * meshImport.test.ts - 3D files in, ordinary shards out.
 *
 * Every fixture is written in code (meshFixtures.fixture.ts). Each test checks
 * the thing that would be wrong without the import: the shard exists, it is
 * valid by the format's own reader (DECK-0003 §1.9, through fromPayload), its
 * fronts look out, its colors are palette colors, and it fits the budget.
 */

import { describe, expect, it } from 'vitest'
import {
  CUBE_COLORS, CUBE_POINTS, CUBE_QUADS, CUBE_TRIS, blob, cubeTris, glb, gltfJson, materialise, mtlText, objText,
  plyAscii, plyBinary, stlAscii, stlBinary, viscam, vox, type V3,
} from './meshFixtures.fixture.js'
import { importMesh, detectFormat, readMesh, type ImportFile, type ImportResponse } from './importFile.js'
import { IMPORT_MAX_FILE_BYTES, MeshImportError, makeClock, type ImportMesh } from './mesh.js'
import { IMPORT_BUDGET_BYTES, IMPORT_DEFAULT_COLOR, importFitFor, meshToShard, payloadBytes } from './meshToShard.js'
import { parsePly } from './ply.js'
import { parseStl } from './stl.js'
import { parseGltf } from './gltf.js'
import { parseVox } from './vox.js'
import { parseObj } from './obj.js'
import { TICKS_PER_UNIT as T, fromPayload, ticksOf, toPayload, unpackTicks, validFace, type ShardModel } from './shards.js'
import { BUILT_IN, indexOf, toBytes } from './snoPalette.js'

const clock = () => makeClock(60_000)
const file = (name: string, bytes: Uint8Array): ImportFile => ({ name, bytes })
const ok = (r: ImportResponse): Extract<ImportResponse, { ok: true }> => {
  if (!r.ok) throw new Error(`import failed: ${r.error}`)
  return r
}
const run = (name: string, bytes: Uint8Array, options = {}) => ok(importMesh({ files: [file(name, bytes)], options }))

/** The shard's positions on the wire, in units: Y up, +Z toward the viewer (§2). */
function wirePositions(s: ShardModel): V3[] {
  const p = toPayload(s)
  const rest = unpackTicks(p.ticks, p.vertices.length)!
  return p.vertices.map((v, i) => v.map((n, a) => n + rest[i][a] / T) as V3)
}

/** Six times the signed volume, by the faces' winding: positive when every front looks out. */
function wireVolume(s: ShardModel): number {
  const p = wirePositions(s)
  let v = 0
  for (const [a, b, c] of s.faces) {
    const A = p[a], B = p[b], C = p[c]
    v += A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])
  }
  return v
}

/** What every imported shard must be: readable by the format's own reader, the same after the trip, and within the grid. */
function expectValid(s: ShardModel, budget = IMPORT_BUDGET_BYTES): void {
  const wire = JSON.parse(JSON.stringify(toPayload(s)))
  const back = fromPayload(wire, s.id)
  expect(back).not.toBeNull()
  expect(back!.vertices.map(ticksOf)).toEqual(s.vertices.map(ticksOf))
  expect(back!.faces).toEqual(s.faces)
  expect(s.extent).toBeGreaterThanOrEqual(1)
  expect(s.extent).toBeLessThanOrEqual(64)
  for (const v of s.vertices) for (const t of ticksOf(v)) expect(Math.abs(t)).toBeLessThanOrEqual(s.extent * T)
  for (const f of s.faces) expect(validFace(f, s.vertices.length)).toBe(true)
  // Every color is exactly a palette entry, so the trip to the wire is exact.
  for (const v of s.vertices) expect(BUILT_IN.some((c) => c.join() === toBytes(v.c).join())).toBe(true)
  expect(payloadBytes(s)).toBeLessThanOrEqual(budget)
}

/** The box the shard's vertices span, in ticks, in the model frame. */
function box(s: ShardModel): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const v of s.vertices) ticksOf(v).forEach((t, a) => { min[a] = Math.min(min[a], t); max[a] = Math.max(max[a], t) })
  return { min, max }
}

const index = (s: ShardModel, i: number): number => indexOf(BUILT_IN, toBytes(s.vertices[i].c))

describe('PLY', () => {
  const cube = { points: CUBE_POINTS, colors: CUBE_COLORS, faces: CUBE_QUADS }

  it('reads ASCII with vertex colors: eight corners, twelve triangles, fronts out, exact palette colors', () => {
    const { shard, report, format } = run('cube.ply', plyAscii(cube))
    expect(format).toBe('ply')
    expect(shard.vertices).toHaveLength(8)
    expect(shard.faces).toHaveLength(12)
    expect(shard.mode).toBe('solid')
    expect(wireVolume(shard)).toBeGreaterThan(0)
    expect(new Set(shard.vertices.map((_, i) => index(shard, i)))).toEqual(new Set([238, 235, 239, 225]))
    expect(report.simplified).toBe(false)
    expect(report.summary).toBe('Imported 12 faces')
    expectValid(shard)
  })

  it('reads binary little and big endian to the same shard as ASCII, float colors too', () => {
    const ascii = run('cube.ply', plyAscii(cube)).shard
    for (const bytes of [plyBinary(cube, true), plyBinary(cube, false), plyBinary({ ...cube, floatColors: true }, true), plyAscii({ ...cube, floatColors: true })]) {
      const s = run('cube.ply', bytes).shard
      expect(s.vertices.map(ticksOf)).toEqual(ascii.vertices.map(ticksOf))
      expect(s.vertices.map((v) => v.c)).toEqual(ascii.vertices.map((v) => v.c))
      expect(s.faces).toEqual(ascii.faces)
    }
  })

  it('splits quads into triangles in their own winding, and reads past an element it does not use', () => {
    const s = run('quads.ply', plyAscii({ points: CUBE_POINTS, faces: CUBE_QUADS, extraEdges: [[0, 1], [1, 2]] })).shard
    expect(s.faces).toHaveLength(12)
    expect(wireVolume(s)).toBeGreaterThan(0)
    // No color in the file: the default color.
    expect(s.vertices.every((v) => v.c.join() === IMPORT_DEFAULT_COLOR.join())).toBe(true)
  })

  it('splits a concave polygon by ear clipping, not a fan that folds over itself', () => {
    // An L, six corners, flat on the floor, wound to face up.
    const L: V3[] = [[0, 0, 0], [0, 0, -2], [1, 0, -2], [1, 0, -1], [2, 0, -1], [2, 0, 0]]
    const s = run('L.ply', plyAscii({ points: L, faces: [[0, 5, 4, 3, 2, 1]] })).shard
    expect(s.faces).toHaveLength(4)
    // Every triangle faces the same way as the polygon: up, in the wire frame.
    const p = wirePositions(s)
    for (const [a, b, c] of s.faces) {
      const u = p[b].map((v, k) => v - p[a][k]), w = p[c].map((v, k) => v - p[a][k])
      expect(u[2] * w[0] - u[0] * w[2]).toBeGreaterThan(0)
    }
  })

  it('carries face colors as hard seams', () => {
    const faceColors: V3[] = CUBE_QUADS.map((_, i) => (i % 2 ? [255, 0, 0] : [0, 0, 255]))
    const s = run('seams.ply', plyBinary({ points: CUBE_POINTS, faces: CUBE_QUADS, faceColors }, true)).shard
    expect(s.facecolors).toHaveLength(12)
    const idx = s.facecolors!.map((c) => indexOf(BUILT_IN, toBytes(c)))
    expect(new Set(idx)).toEqual(new Set([238, 239]))
    expectValid(s)
  })

  it('reads a point cloud as POINTS', () => {
    const points: V3[] = Array.from({ length: 50 }, (_, i) => [Math.cos(i), i / 10, Math.sin(i)])
    const colors: V3[] = points.map((_, i) => [i * 5, 255 - i * 5, 128])
    const { shard, report } = run('cloud.ply', plyBinary({ points, colors }, true))
    expect(shard.mode).toBe('points')
    expect(shard.faces).toHaveLength(0)
    expect(shard.vertices).toHaveLength(50)
    expect(report.points).toBe(true)
    expect(report.summary).toBe('Imported 50 points')
    expectValid(shard)
  })

  it('round-trips a snocrash PLY export: ASCII floats in units and uchar colors', () => {
    // snocrash's toPly writes "x y z r g b" per vertex and "3 a b c" per face.
    const text = ['ply', 'format ascii 1.0', 'comment name tetra', 'comment unit 0', 'comment written by snocrash', 'element vertex 4',
      'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue',
      'element face 4', 'property list uchar int vertex_index', 'end_header',
      '0 0 0 255 0 0', '2 0 0 0 255 0', '1 0 -2 0 0 255', '1 2 -1 255 255 255',
      '3 0 2 1', '3 0 1 3', '3 1 2 3', '3 0 3 2', ''].join('\n')
    const s = run('tetra.ply', new TextEncoder().encode(text), { fit: 2 * T }).shard
    expect(s.vertices).toHaveLength(4)
    expect(s.faces).toHaveLength(4)
    expectValid(s)
  })
})

describe('the fit', () => {
  it('scales the largest side to `fit` ticks, keeps proportions, centers X and Z, and stands on Y = 0', () => {
    // A box 4 wide, 2 tall, 1 deep, far from the origin.
    const pts: V3[] = CUBE_POINTS.map((p) => [100 + p[0] * 4, 50 + p[1] * 2, -30 + p[2]])
    const s = run('box.ply', plyAscii({ points: pts, faces: CUBE_QUADS }), { fit: 8 * T }).shard
    const { min, max } = box(s)
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([8 * T, 4 * T, 2 * T])
    expect(min[1]).toBe(0)
    expect(min[0] + max[0]).toBe(0)
    expect(min[2] + max[2]).toBe(0)
  })

  it('turns a Z-up file (STL) onto Y up by a rotation: tall in Z becomes tall in Y, fronts still out', () => {
    const s = run('tower.stl', stlBinary(cubeTris([1, 1, 3])), { fit: 8 * T }).shard
    const { min, max } = box(s)
    expect(max[1] - min[1]).toBe(8 * T)
    expect(max[0] - min[0]).toBe(Math.round((8 * T) / 3))
    expect(wireVolume(s)).toBeGreaterThan(0)
  })

  it('brings a file in at half the grid\'s reach: 4 units on the default grid, larger on a larger grid', () => {
    expect(importFitFor(8)).toBe(4 * T)
    expect(importFitFor(64)).toBe(32 * T)
    expect(importFitFor(1)).toBe(T)
    const s = run('cube.ply', plyAscii({ points: CUBE_POINTS, faces: CUBE_QUADS })).shard
    expect(box(s).max[1]).toBe(4 * T)
  })

  it('never reaches past the 64-unit position bound, however large the fit asked', () => {
    const s = run('cube.ply', plyAscii({ points: CUBE_POINTS, faces: CUBE_QUADS }), { fit: 10_000 * T }).shard
    expect(s.extent).toBeLessThanOrEqual(64)
    expectValid(s)
  })
})

describe('quantize and clean', () => {
  const mesh = (positions: number[], triangles: number[], extra: Partial<ImportMesh> = {}): ImportMesh => ({
    positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles), up: 'y', ...extra,
  })

  it('merges vertices that land on one tick, and drops faces that collapse, lie on a line, or repeat', () => {
    // A square of two triangles, plus: a near-duplicate corner (0.0001 off),
    // a triangle using it that collapses, a sliver on a line, and a repeat
    // of the first triangle wound the other way.
    const pos = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0.0001, 0, 0, 0.5, 0, 0]
    const tris = [0, 1, 2, 0, 2, 3, 0, 4, 1, 0, 5, 1, 0, 2, 1]
    const { shard } = meshToShard(mesh(pos, tris), { fit: T })
    expect(shard.faces).toHaveLength(2)
    expect(shard.vertices).toHaveLength(4)
    expectValid(shard)
  })

  it('refuses a mesh whose every face is too thin to keep', () => {
    const pos = [0, 0, 0, 1, 0, 0, 2, 0, 0]
    expect(() => meshToShard(mesh(pos, [0, 1, 2]))).toThrow(MeshImportError)
  })

  it('snaps colors to the nearest palette entry, and to the shard\'s own palette when it has one', () => {
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const near = Float32Array.from([250 / 255, 5 / 255, 5 / 255, 1, 0, 0, 1, 0, 0])
    const built = meshToShard(mesh(pos, [0, 1, 2], { colors: near })).shard
    expect(built.vertices.map((v) => indexOf(BUILT_IN, toBytes(v.c)))).toEqual([238, 238, 238])
    const own: Array<[number, number, number]> = [[0, 0, 0], [200, 0, 0], [0, 200, 0]]
    const custom = meshToShard(mesh(pos, [0, 1, 2], { colors: near }), { palette: own }).shard
    expect(custom.vertices.map((v) => toBytes(v.c))).toEqual([[200, 0, 0], [200, 0, 0], [200, 0, 0]])
  })

  it('leaves out face colors that only repeat what the corners already show', () => {
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const red = Float32Array.from([1, 0, 0])
    const s = meshToShard(mesh(pos, [0, 1, 2], { triangleColors: red })).shard
    expect(s.facecolors).toBeUndefined()
    expect(s.vertices.every((v) => indexOf(BUILT_IN, toBytes(v.c)) === 238)).toBe(true)
  })
})

describe('simplifying to fit', () => {
  const { points, colors, tris } = blob(120, 160) // 38,400 triangles

  it('simplifies a dense mesh until it fits the budget, keeping as much as fits, and says so in one line', () => {
    const bytes = plyBinary({ points, colors, faces: tris }, true)
    const { shard, report } = run('blob.ply', bytes)
    expect(report.simplified).toBe(true)
    expect(report.inputCount).toBe(38_400)
    expect(report.count).toBe(shard.faces.length)
    expect(report.count).toBeGreaterThan(500)
    expect(report.summary).toMatch(/^Imported 38,400 faces as [\d,]+ \(simplified to fit\)$/)
    expect(report.bytes).toBe(payloadBytes(shard))
    // Near the budget, not far under it: the finest cell that fits was found.
    expect(report.bytes).toBeGreaterThan(IMPORT_BUDGET_BYTES * 0.6)
    expect(wireVolume(shard)).toBeGreaterThan(0)
    expectValid(shard)
  })

  it('honors a smaller budget and a face cap', () => {
    const bytes = plyBinary({ points, faces: tris }, true)
    const small = run('blob.ply', bytes, { budget: 8_000 }).shard
    expectValid(small, 8_000)
    const capped = run('blob.ply', bytes, { maxFaces: 300 })
    expect(capped.shard.faces.length).toBeLessThanOrEqual(300)
    expect(capped.report.simplified).toBe(true)
  })

  it('simplifies a dense point cloud too', () => {
    const cloud: V3[] = Array.from({ length: 30_000 }, (_, i) => [Math.sin(i * 0.37) * 3, Math.cos(i * 0.11) * 2, Math.sin(i * 0.07)])
    const { shard, report } = run('cloud.ply', plyBinary({ points: cloud }, false))
    expect(report.simplified).toBe(true)
    expect(shard.mode).toBe('points')
    expectValid(shard)
  })

  it('stops a conversion that runs out of time with a sentence, not a hang', () => {
    const m = parsePly(plyBinary({ points, faces: tris }, true), clock())
    let calls = 0
    const expired = (): void => { if (++calls > 1000) throw new MeshImportError('That file took too long to read. Try a smaller or simpler one.') }
    expect(() => meshToShard(m, { clock: expired })).toThrow(/too long/)
  })
})

describe('STL', () => {
  it('reads ASCII and binary to the same welded cube', () => {
    const a = run('cube.stl', stlAscii(cubeTris())).shard
    const b = run('cube.stl', stlBinary(cubeTris())).shard
    for (const s of [a, b]) {
      expect(s.vertices).toHaveLength(8)
      expect(s.faces).toHaveLength(12)
      expect(wireVolume(s)).toBeGreaterThan(0)
      expectValid(s)
    }
    expect(b.vertices.map(ticksOf)).toEqual(a.vertices.map(ticksOf))
  })

  it('tells a binary file whose header starts with "solid" from ASCII by its size', () => {
    expect(detectFormat('x.stl', stlBinary(cubeTris()))).toBe('stl')
    expect(parseStl(stlBinary(cubeTris()), clock()).triangles.length).toBe(36)
  })

  it('reads VisCAM per-facet colors and Materialise part and facet colors', () => {
    const vis = cubeTris().map((_, i) => (i < 6 ? viscam(255, 0, 0) : viscam(0, 0, 255)))
    const v = run('vis.stl', stlBinary(cubeTris(), vis)).shard
    expect(new Set(v.facecolors!.map((c) => indexOf(BUILT_IN, toBytes(c))))).toEqual(new Set([238, 239]))

    // Materialise: the part is green (COLOR= in the header); two facets are red of their own.
    const header = new Uint8Array(80)
    header.set(new TextEncoder().encode('COLOR='))
    header.set([0, 255, 0, 255], 6)
    const attrs = cubeTris().map((_, i) => (i < 2 ? materialise(255, 0, 0) : 0x8000))
    const bytes = stlBinary(cubeTris(), attrs, '')
    bytes.set(header, 0)
    const m = run('mat.stl', bytes).shard
    const idx = m.facecolors!.map((c) => indexOf(BUILT_IN, toBytes(c)))
    expect(idx.filter((i) => i === 238)).toHaveLength(2)
    expect(idx.filter((i) => i === 235)).toHaveLength(10)
  })
})

describe('OBJ', () => {
  it('reads an OBJ with its MTL: each material\'s Kd colors its faces as seams', () => {
    const materials = CUBE_QUADS.map((_, i) => (i < 3 ? 'red' : 'blue'))
    const obj = objText(CUBE_POINTS, CUBE_QUADS, { materials, mtllib: 'cube.mtl' })
    const mtl = mtlText({ red: [255, 0, 0], blue: [0, 0, 255] })
    const r = ok(importMesh({ files: [file('cube.obj', obj), file('cube.mtl', mtl)] }))
    expect(r.format).toBe('obj')
    expect(r.shard.faces).toHaveLength(12)
    expect(new Set(r.shard.facecolors!.map((c) => indexOf(BUILT_IN, toBytes(c))))).toEqual(new Set([238, 239]))
    expect(wireVolume(r.shard)).toBeGreaterThan(0)
    expectValid(r.shard)
  })

  it('reads an OBJ alone in the default color, negative indices and vertex colors too', () => {
    const plain = run('cube.obj', objText(CUBE_POINTS, CUBE_QUADS, { materials: CUBE_QUADS.map(() => 'missing'), mtllib: 'gone.mtl' })).shard
    expect(plain.vertices.every((v) => v.c.join() === IMPORT_DEFAULT_COLOR.join())).toBe(true)
    const neg = run('cube.obj', objText(CUBE_POINTS, CUBE_QUADS, { negative: true })).shard
    expect(neg.faces).toEqual(plain.faces)
    const colored = run('cube.obj', objText(CUBE_POINTS, CUBE_QUADS, { colors: CUBE_COLORS })).shard
    expect(new Set(colored.vertices.map((_, i) => index(colored, i)))).toEqual(new Set([238, 235, 239, 225]))
  })
})

describe('glTF', () => {
  const cube = { points: CUBE_POINTS, indices: CUBE_TRIS.flat() }

  it('reads a GLB with COLOR_0, its fronts out', () => {
    const r = run('cube.glb', glb({ primitives: [{ ...cube, colors: CUBE_COLORS }] }))
    expect(r.format).toBe('gltf')
    expect(r.shard.faces).toHaveLength(12)
    expect(wireVolume(r.shard)).toBeGreaterThan(0)
    // Linear 1.0 and 0.0 are sRGB 1.0 and 0.0, so the corners stay exact.
    expect(new Set(r.shard.vertices.map((_, i) => index(r.shard, i)))).toEqual(new Set([238, 235, 239, 225]))
    expectValid(r.shard)
  })

  it('colors faces by material base color, applies node transforms, and keeps fronts out through a mirror', () => {
    const spec = {
      primitives: [{ ...cube, baseColor: [1, 0, 0, 1] as [number, number, number, number] }, { ...cube, baseColor: [0, 0, 1, 1] as [number, number, number, number] }],
      nodes: [{ translation: [-3, 0, 0] as V3 }, { translation: [3, 0, 0] as V3, scale: [-1, 1, 1] as V3 }],
    }
    const s = run('two.glb', glb(spec), { fit: 8 * T }).shard
    expect(s.faces).toHaveLength(24)
    expect(new Set(s.facecolors?.map((c) => indexOf(BUILT_IN, toBytes(c))) ?? s.vertices.map((_, i) => index(s, i)))).toEqual(new Set([238, 239]))
    expect(wireVolume(s)).toBeGreaterThan(0)
    const { min, max } = box(s)
    expect(max[0] - min[0]).toBe(8 * T) // 7 units wide, fitted
    expectValid(s)
  })

  it('reads a .gltf with a data URI, and one with its .bin picked beside it', () => {
    const { gltf } = gltfJson({ primitives: [cube] })
    expect(run('cube.gltf', gltf).shard.faces).toHaveLength(12)
    const { gltf: named, bin } = gltfJson({ primitives: [cube] }, 'cube%20data.bin')
    const r = ok(importMesh({ files: [file('cube.gltf', named), file('cube data.bin', bin)] }))
    expect(r.shard.faces).toHaveLength(12)
  })

  it('never fetches: a buffer at a web address is refused, and so is one that was not picked', () => {
    const { gltf } = gltfJson({ primitives: [cube] }, 'https://example.com/cube.bin')
    const r = importMesh({ files: [file('cube.gltf', gltf)] })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/never fetches/) })
    const { gltf: local } = gltfJson({ primitives: [cube] }, 'cube.bin')
    expect(importMesh({ files: [file('cube.gltf', local)] })).toEqual({ ok: false, error: expect.stringMatching(/Pick that file/) })
  })

  it('refuses Draco with a sentence', () => {
    const r = importMesh({ files: [file('d.glb', glb({ primitives: [cube], extensionsRequired: ['KHR_draco_mesh_compression'] }))] })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Draco/) })
  })

  it('reads a strip and a points-only file', () => {
    const strip = run('strip.glb', glb({ primitives: [{ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], mode: 5 }] })).shard
    expect(strip.faces).toHaveLength(2)
    const pts = run('pts.glb', glb({ primitives: [{ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], mode: 0 }] })).shard
    expect(pts.mode).toBe('points')
    expect(pts.vertices).toHaveLength(3)
  })
})

describe('MagicaVoxel', () => {
  const cube2: Array<[number, number, number, number]> = []
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) cube2.push([x, y, z, 1])

  it('meshes a 2x2x2 block of one color greedily: six faces of two triangles, on the lattice exactly', () => {
    const s = run('block.vox', vox([{ size: [2, 2, 2], voxels: cube2 }], { 1: [255, 0, 0] }), { fit: 8 * T }).shard
    expect(s.faces).toHaveLength(12)
    expect(s.vertices).toHaveLength(8)
    expect(wireVolume(s)).toBeGreaterThan(0)
    // Two voxels across into 8 units: four whole units each, so every corner is whole.
    expect(s.vertices.every((v) => !v.t)).toBe(true)
    expect(box(s).max[1]).toBe(8 * T)
    expect(s.vertices.every((v) => indexOf(BUILT_IN, toBytes(v.c)) === 238)).toBe(true)
    expectValid(s)
  })

  it('keeps colors crisp with face colors, places models by the scene graph, and reads the default palette', () => {
    const two = [{ size: [1, 1, 1] as V3, voxels: [[0, 0, 0, 1]] as Array<[number, number, number, number]> }, { size: [1, 1, 1] as V3, voxels: [[0, 0, 0, 2]] as Array<[number, number, number, number]> }]
    const s = run('pair.vox', vox(two, { 1: [255, 0, 0], 2: [0, 0, 255] }, [[0, 0, 0], [3, 0, 0]])).shard
    expect(s.faces).toHaveLength(24)
    const { min, max } = box(s)
    expect(max[0] - min[0]).toBeGreaterThan(max[2] - min[2]) // side by side along X
    expect(wireVolume(s)).toBeGreaterThan(0)
    const plain = run('plain.vox', vox([{ size: [2, 2, 2], voxels: cube2 }]))
    expect(plain.shard.faces).toHaveLength(12)
    expectValid(plain.shard)
  })
})

describe('malformed and hostile files', () => {
  const fails = (name: string, bytes: Uint8Array, pattern?: RegExp): void => {
    const r = importMesh({ files: [file(name, bytes)] })
    expect(r.ok).toBe(false)
    if (!r.ok && pattern) expect(r.error).toMatch(pattern)
  }
  const cubePly = plyBinary({ points: CUBE_POINTS, colors: CUBE_COLORS, faces: CUBE_QUADS }, true)

  it('refuses a truncated binary PLY at every length, with a sentence', () => {
    for (let n = 0; n < cubePly.length; n += 3) {
      const r = importMesh({ files: [file('cut.ply', cubePly.slice(0, n))] })
      expect(r.ok, `cut at ${n}`).toBe(false)
    }
  })

  it('refuses a header that promises more than the file holds, and a huge declared count, before allocating', () => {
    const text = new TextDecoder().decode(cubePly.slice(0, 400))
    const header = text.slice(0, text.indexOf('end_header') + 11)
    const body = cubePly.slice(header.length)
    const lie = (from: string, to: string): Uint8Array => { const h = new TextEncoder().encode(header.replace(from, to)); const out = new Uint8Array(h.length + body.length); out.set(h); out.set(body, h.length); return out }
    // A count off by one still parses, into garbage; what is left over (or runs out) gives it away.
    fails('more.ply', lie('element vertex 8', 'element vertex 9'), /cut short|counts are wrong/)
    fails('fewer.ply', lie('element vertex 8', 'element vertex 7'), /cut short|counts are wrong|points at vertex|corners/)
    fails('huge.ply', lie('element vertex 8', 'element vertex 4294967295'), /4,294,967,295 vertices/)
    fails('faces.ply', lie('element face 6', 'element face 4000000000'), /cut short/)
  })

  it('refuses a face that points past the vertices, and a list count past the end', () => {
    fails('bad.ply', plyAscii({ points: CUBE_POINTS, faces: [[0, 1, 99]] }), /vertex 99/)
    const text = ['ply', 'format ascii 1.0', 'element vertex 3', 'property float x', 'property float y', 'property float z', 'element face 1', 'property list uint int vertex_indices', 'end_header', '0 0 0', '1 0 0', '0 1 0', '4000000000 0 1 2'].join('\n')
    fails('list.ply', new TextEncoder().encode(text), /corners/)
  })

  it('drops NaN vertices and the faces that use them, and refuses a file with nothing else', () => {
    const pts: V3[] = [...CUBE_POINTS, [NaN, 0, 0]]
    const s = run('nan.ply', plyAscii({ points: pts, faces: [...CUBE_QUADS, [0, 1, 8]] })).shard
    expect(s.faces).toHaveLength(12)
    fails('allnan.ply', plyAscii({ points: [[NaN, NaN, NaN], [NaN, 0, 0]] }), /no vertices that are numbers/)
    fails('inf.ply', plyAscii({ points: [[-1e308, 0, 0], [1e308, 0, 0]] }), /too large/)
  })

  it('refuses an STL whose count disagrees with its size, a GLB cut short, and a .vox chunk past its end', () => {
    const stl = stlBinary(cubeTris())
    fails('cut.stl', stl.slice(0, 84 + 50 * 5 + 7), /cut short/)
    const g = glb({ primitives: [{ points: CUBE_POINTS, indices: CUBE_TRIS.flat() }] })
    fails('cut.glb', g.slice(0, g.length - 10), /cut short/)
    const v = vox([{ size: [2, 2, 2], voxels: [[0, 0, 0, 1]] }])
    fails('cut.vox', v.slice(0, v.length - 3))
  })

  it('refuses an OBJ line too long to be a face before splitting it, and reads past a giant MTL line', () => {
    const giant = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf' + ' 1'.repeat(200_000) + '\n')
    fails('giant.obj', giant, /line too long/)
    const obj = objText(CUBE_POINTS, CUBE_QUADS, { materials: CUBE_QUADS.map(() => 'red'), mtllib: 'cube.mtl' })
    const mtl = new TextEncoder().encode('newmtl red\nKd 1 0 0\n# ' + 'x'.repeat(100_000) + '\n')
    const r = ok(importMesh({ files: [file('cube.obj', obj), file('cube.mtl', mtl)] }))
    expect(r.shard.vertices.every((v) => indexOf(BUILT_IN, toBytes(v.c)) === 238)).toBe(true)
  })

  it('refuses garbage, an empty file, a file over the size cap, and only a companion', () => {
    fails('noise.bin.ply', new Uint8Array(500).map((_, i) => (i * 7919) % 251), /PLY|header/)
    fails('empty.stl', new Uint8Array(0), /empty/)
    fails('big.stl', new Uint8Array(IMPORT_MAX_FILE_BYTES + 1), /MB/)
    fails('cube.mtl', mtlText({ a: [1, 2, 3] }), /Pick a 3D file/)
    fails('readme.txt', new TextEncoder().encode('hello there'), /not a file import reads/)
  })

  /**
   * Fuzz: every binary format, mutated at random, must come back as a valid
   * shard or a MeshImportError, never another exception and never a hang.
   */
  it('survives random byte mutations of every binary format', () => {
    let seed = 12345
    const rand = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n }
    const sources: Array<[string, Uint8Array]> = [
      ['f.ply', cubePly],
      ['f.ply', plyBinary({ points: CUBE_POINTS, faces: CUBE_QUADS }, false)],
      ['f.stl', stlBinary(cubeTris(), cubeTris().map(() => viscam(10, 200, 30)))],
      ['f.glb', glb({ primitives: [{ points: CUBE_POINTS, indices: CUBE_TRIS.flat(), colors: CUBE_COLORS }] })],
      ['f.vox', vox([{ size: [2, 2, 2], voxels: [[0, 0, 0, 1], [1, 1, 1, 2]] }], { 1: [255, 0, 0] }, [[0, 0, 0]])],
      ['f.obj', objText(CUBE_POINTS, CUBE_QUADS)],
    ]
    const parsers: Record<string, (b: Uint8Array) => unknown> = {
      ply: (b) => parsePly(b, clock()), stl: (b) => parseStl(b, clock()), glb: (b) => parseGltf(b, clock()), vox: (b) => parseVox(b, clock()), obj: (b) => parseObj(b, clock()),
    }
    for (const [name, src] of sources) {
      const parse = parsers[name.slice(2)]
      for (let k = 0; k < 400; k++) {
        const b = src.slice()
        const edits = 1 + rand(6)
        for (let e = 0; e < edits; e++) b[rand(b.length)] = rand(256)
        const cut = rand(4) === 0 ? b.slice(0, rand(b.length)) : b
        try {
          meshToShard(parse(cut) as ImportMesh, { clock: clock() })
        } catch (err) {
          if (!(err instanceof MeshImportError)) throw new Error(`${name} mutation ${k} threw ${(err as Error).name}: ${(err as Error).message}`)
        }
        const r = importMesh({ files: [file(name, cut)] })
        if (r.ok) expectValid(r.shard)
      }
    }
  })
})

describe('format detection', () => {
  it('knows each format by its bytes before its name', () => {
    expect(detectFormat('model.bin', glb({ primitives: [{ points: CUBE_POINTS }] }))).toBe('gltf')
    expect(detectFormat('x', vox([{ size: [1, 1, 1], voxels: [[0, 0, 0, 1]] }]))).toBe('vox')
    expect(detectFormat('x', plyAscii({ points: CUBE_POINTS }))).toBe('ply')
    expect(detectFormat('x', stlAscii(cubeTris()))).toBe('stl')
    expect(detectFormat('x', objText(CUBE_POINTS, CUBE_QUADS))).toBe('obj')
    expect(readMesh([file('a.ply', plyAscii({ points: CUBE_POINTS }))], clock()).name).toBe('a')
  })
})
