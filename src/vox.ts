/**
 * vox.ts - reading a MagicaVoxel .vox file into a mesh.
 *
 * MagicaVoxel is the format SNO is "the same idea one level up" from
 * (DECK-0003 Appendix B.1): a grid and a 256-color palette. A voxel model
 * lands on the SNO lattice exactly, every voxel the same whole number of
 * ticks (meshToShard.ts, `lattice`), so nothing about its shape is rounded.
 *
 * What is read: every model (SIZE and XYZI), the palette (RGBA, or the
 * default when a file has none), and the scene graph (nTRN, nGRP, nSHP) with
 * each transform's translation and rotation, so a scene of several models
 * comes in arranged as it was built. Materials, layers, cameras and the rest
 * are read past.
 *
 * The surface is meshed greedily: only faces between a voxel and empty space
 * are kept, and neighboring faces of one color on one plane are merged into
 * one rectangle, two triangles. A 16 by 16 wall of one color is two faces
 * rather than 512. Each rectangle is wound to look outward and carries its
 * voxel's color as a face color, so color edges stay crisp (§1.4a).
 *
 * MagicaVoxel is Z up.
 */

import { MeshImportError, PolygonBuilder, finishMesh, grow64, type Clock, type ImportMesh } from './mesh.js'

/** Whether these bytes are a .vox file. */
export function looksLikeVox(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x56 && bytes[1] === 0x4f && bytes[2] === 0x58 && bytes[3] === 0x20
}

/** The most voxels a file may hold, and the largest box its scene may span, in voxels. */
const MAX_VOXELS = 2_000_000
const MAX_VOLUME = 32 * 1024 * 1024

/**
 * MagicaVoxel's default palette, for a file that carries none: a six-level
 * color cube, white first, then ramps of red, green, blue and gray. Entry 0
 * is never drawn (it means empty).
 */
function defaultPalette(): Uint8Array {
  const out = new Uint8Array(256 * 3)
  const steps = [0xff, 0xcc, 0x99, 0x66, 0x33, 0x00]
  let i = 1
  for (const r of steps) for (const g of steps) for (const b of steps) {
    if (i > 215) break
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b; i++
  }
  const ramp = [0xee, 0xdd, 0xbb, 0xaa, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11]
  for (const ch of [0, 1, 2]) for (const v of ramp) { if (i < 256) { out[i * 3 + ch] = v; i++ } }
  for (const v of ramp) { if (i < 256) { out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v; i++ } }
  return out
}

interface Model { sx: number; sy: number; sz: number; voxels: Uint8Array }
type Node =
  | { kind: 'trn'; child: number; r: number[]; t: [number, number, number] }
  | { kind: 'grp'; children: number[] }
  | { kind: 'shp'; models: number[] }

/** A 3x3 integer rotation, row-major, from MagicaVoxel's packed byte. */
function rotation(byte: number): number[] {
  const first = byte & 3, second = (byte >> 2) & 3
  if (first > 2 || second > 2 || first === second) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const third = 3 - first - second
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  m[first] = byte & 16 ? -1 : 1
  m[3 + second] = byte & 32 ? -1 : 1
  m[6 + third] = byte & 64 ? -1 : 1
  return m
}

/** A .vox file as a mesh. Throws MeshImportError on anything it cannot read. */
export function parseVox(bytes: Uint8Array, clock: Clock): ImportMesh {
  if (!looksLikeVox(bytes)) throw new MeshImportError('That is not a MagicaVoxel file.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cut = (): never => { throw new MeshImportError('That .vox file is cut short: a chunk runs past its end.') }
  let at = 8
  const i32 = (): number => { if (at + 4 > bytes.length) cut(); const v = view.getInt32(at, true); at += 4; return v }
  const str = (): string => {
    const n = i32()
    if (n < 0 || at + n > bytes.length) cut()
    let s = ''
    for (let k = 0; k < n && k < 256; k++) s += String.fromCharCode(bytes[at + k])
    at += n
    return s
  }
  const dict = (): Map<string, string> => {
    const n = i32()
    if (n < 0 || n > 4096) throw new MeshImportError('That .vox file has a malformed attribute list.')
    const out = new Map<string, string>()
    for (let k = 0; k < n; k++) out.set(str(), str())
    return out
  }

  const models: Model[] = []
  let size: [number, number, number] | null = null
  let palette: Uint8Array | null = null
  const nodes = new Map<number, Node>()
  let voxels = 0

  // MAIN, then its children one after another.
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(8, 12)) !== 'MAIN') throw new MeshImportError('That .vox file has no MAIN chunk.')
  at = 20 + view.getInt32(12, true)
  if (at < 20 || at > bytes.length) cut()
  while (at + 12 <= bytes.length) {
    clock()
    const id = String.fromCharCode(...bytes.subarray(at, at + 4))
    const content = view.getInt32(at + 4, true), children = view.getInt32(at + 8, true)
    const start = at + 12
    if (content < 0 || children < 0 || start + content > bytes.length) cut()
    const next = start + content + children
    at = start
    if (id === 'SIZE') {
      const x = i32(), y = i32(), z = i32()
      if (x < 1 || y < 1 || z < 1 || x > 2048 || y > 2048 || z > 2048) throw new MeshImportError('That .vox file has a model of an impossible size.')
      size = [x, y, z]
    } else if (id === 'XYZI') {
      if (!size) throw new MeshImportError('That .vox file has voxels before a size.')
      const n = i32()
      if (n < 0 || at + n * 4 > start + content) cut()
      voxels += n
      if (voxels > MAX_VOXELS) throw new MeshImportError(`That .vox file has more than ${MAX_VOXELS.toLocaleString('en-US')} voxels. Import reads up to that many.`)
      models.push({ sx: size[0], sy: size[1], sz: size[2], voxels: bytes.slice(at, at + n * 4) })
      size = null
    } else if (id === 'RGBA') {
      if (content < 1024) cut()
      palette = new Uint8Array(256 * 3)
      // Entry k of the chunk is color index k + 1.
      for (let k = 0; k < 255; k++) { palette[(k + 1) * 3] = bytes[at + k * 4]; palette[(k + 1) * 3 + 1] = bytes[at + k * 4 + 1]; palette[(k + 1) * 3 + 2] = bytes[at + k * 4 + 2] }
    } else if (id === 'nTRN') {
      const nodeId = i32(); dict()
      const child = i32(); i32(); i32()
      const frames = i32()
      let r = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      let t: [number, number, number] = [0, 0, 0]
      if (frames > 0) {
        const f = dict()
        const rr = Number(f.get('_r'))
        if (Number.isInteger(rr)) r = rotation(rr)
        const tt = (f.get('_t') ?? '').trim().split(/\s+/).map(Number)
        if (tt.length === 3 && tt.every(Number.isInteger)) t = [tt[0], tt[1], tt[2]]
      }
      nodes.set(nodeId, { kind: 'trn', child, r, t })
    } else if (id === 'nGRP') {
      const nodeId = i32(); dict()
      const n = i32()
      if (n < 0 || at + n * 4 > start + content) cut()
      const kids: number[] = []
      for (let k = 0; k < n; k++) kids.push(i32())
      nodes.set(nodeId, { kind: 'grp', children: kids })
    } else if (id === 'nSHP') {
      const nodeId = i32(); dict()
      const n = i32()
      if (n < 0 || n > 4096) cut()
      const ms: number[] = []
      for (let k = 0; k < n; k++) { ms.push(i32()); dict() }
      nodes.set(nodeId, { kind: 'shp', models: ms })
    }
    at = next
  }
  if (models.length === 0) throw new MeshImportError('That .vox file has no models.')
  const colors = palette ?? defaultPalette()

  // Every voxel in the scene's frame: each model placed by the transforms
  // above it, about its own center, as MagicaVoxel places them.
  const scene = grow64()
  const place = (m: Model, r: number[], t: [number, number, number]): void => {
    const px = Math.floor(m.sx / 2), py = Math.floor(m.sy / 2), pz = Math.floor(m.sz / 2)
    for (let k = 0; k < m.voxels.length; k += 4) {
      clock()
      const c = m.voxels[k + 3]
      if (c === 0) continue
      const x = m.voxels[k] - px, y = m.voxels[k + 1] - py, z = m.voxels[k + 2] - pz
      // A model placed twice is a second copy of its voxels, so the cap is on
      // what the scene places, not only on what the file holds.
      if (scene.length >= MAX_VOXELS * 4) throw new MeshImportError(`That .vox scene places more than ${MAX_VOXELS.toLocaleString('en-US')} voxels. Import reads up to that many.`)
      scene.push(r[0] * x + r[1] * y + r[2] * z + t[0])
      scene.push(r[3] * x + r[4] * y + r[5] * z + t[1])
      scene.push(r[6] * x + r[7] * y + r[8] * z + t[2])
      scene.push(c)
    }
  }
  if (nodes.size && nodes.has(0)) {
    let visits = 0
    const walk = (id: number, r: number[], t: [number, number, number], depth: number): void => {
      if (++visits > 100_000 || depth > 64) throw new MeshImportError('That .vox file\'s scene is too deep, or loops back on itself.')
      const node = nodes.get(id)
      if (!node) return
      if (node.kind === 'trn') {
        // Parent rotation applied to this node's: r' = r * nr, t' = r * nt + t.
        const nr = node.r, nt = node.t
        const rr = [0, 0, 0, 0, 0, 0, 0, 0, 0]
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) rr[a * 3 + b] = r[a * 3] * nr[b] + r[a * 3 + 1] * nr[3 + b] + r[a * 3 + 2] * nr[6 + b]
        const tt: [number, number, number] = [0, 1, 2].map((a) => r[a * 3] * nt[0] + r[a * 3 + 1] * nt[1] + r[a * 3 + 2] * nt[2] + t[a]) as [number, number, number]
        walk(node.child, rr, tt, depth + 1)
      } else if (node.kind === 'grp') {
        for (const c of node.children) walk(c, r, t, depth + 1)
      } else {
        for (const mi of node.models) { const m = models[mi]; if (m) place(m, r, t) }
      }
    }
    walk(0, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], 0)
  } else {
    for (const m of models) place(m, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0])
  }
  const placed = scene.data
  const count = scene.length
  if (count === 0) throw new MeshImportError('That .vox file has no voxels.')

  // A dense grid over the scene's box: one byte per cell, the color index or 0.
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let k = 0; k < count; k += 4) {
    x0 = Math.min(x0, placed[k]); x1 = Math.max(x1, placed[k])
    y0 = Math.min(y0, placed[k + 1]); y1 = Math.max(y1, placed[k + 1])
    z0 = Math.min(z0, placed[k + 2]); z1 = Math.max(z1, placed[k + 2])
  }
  const dim = [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1]
  if (dim[0] * dim[1] * dim[2] > MAX_VOLUME) throw new MeshImportError('That .vox scene spans too large a box to import.')
  const grid = new Uint8Array(dim[0] * dim[1] * dim[2])
  const cellAt = (x: number, y: number, z: number): number => (x * dim[1] + y) * dim[2] + z
  for (let k = 0; k < count; k += 4) grid[cellAt(placed[k] - x0, placed[k + 1] - y0, placed[k + 2] - z0)] = placed[k + 3]
  const occupied = (p: number[]): number => (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= dim[0] || p[1] >= dim[1] || p[2] >= dim[2] ? 0 : grid[cellAt(p[0], p[1], p[2])])

  // Greedy meshing, per axis and side: on each slice, the faces that look
  // into empty space, merged into rectangles of one color.
  const positions = grow64()
  const polygons = new PolygonBuilder()
  const quad = [0, 0, 0, 0]
  const rgb = [0, 0, 0]
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3
    const mask = new Int32Array(dim[u] * dim[v])
    for (const side of [1, -1]) {
      for (let s = 0; s < dim[d]; s++) {
        const p = [0, 0, 0], q = [0, 0, 0]
        for (let j = 0; j < dim[v]; j++) for (let i = 0; i < dim[u]; i++) {
          clock()
          p[d] = s; p[u] = i; p[v] = j
          q[d] = s + side; q[u] = i; q[v] = j
          const c = occupied(p)
          mask[j * dim[u] + i] = c && !occupied(q) ? c : 0
        }
        for (let j = 0; j < dim[v]; j++) for (let i = 0; i < dim[u];) {
          clock()
          const c = mask[j * dim[u] + i]
          if (!c) { i++; continue }
          let w = 1
          while (i + w < dim[u] && mask[j * dim[u] + i + w] === c) w++
          let h = 1
          grow: while (j + h < dim[v]) {
            for (let k = 0; k < w; k++) if (mask[(j + h) * dim[u] + i + k] !== c) break grow
            h++
          }
          for (let b = 0; b < h; b++) for (let k = 0; k < w; k++) mask[(j + b) * dim[u] + i + k] = 0
          // The plane is the voxel's far side when it looks up the axis.
          const plane = s + (side > 0 ? 1 : 0)
          const corners: Array<[number, number]> = [[i, j], [i + w, j], [i + w, j + h], [i, j + h]]
          const order = side > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1]
          const base = positions.length / 3
          for (const o of order) {
            const pt = [0, 0, 0]
            pt[d] = plane; pt[u] = corners[o][0]; pt[v] = corners[o][1]
            positions.push(pt[0] + x0); positions.push(pt[1] + y0); positions.push(pt[2] + z0)
          }
          quad[0] = base; quad[1] = base + 1; quad[2] = base + 2; quad[3] = base + 3
          rgb[0] = colors[c * 3] / 255; rgb[1] = colors[c * 3 + 1] / 255; rgb[2] = colors[c * 3 + 2] / 255
          polygons.add(quad, rgb)
          i += w
        }
      }
    }
  }
  return finishMesh({ positions: positions.done(), polygons: polygons.done(), up: 'z', lattice: true, clock })
}
