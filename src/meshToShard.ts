/**
 * meshToShard.ts - any mesh, made into an ordinary SNO shard.
 *
 * The importers read files into a ImportMesh (mesh.ts); this turns a ImportMesh into a
 * ShardModel that every reader of the format accepts, without changing the
 * format at all (DECK-0003). The steps, in order:
 *
 *   1. Up. A Z-up file (STL, MagicaVoxel) is turned onto SNO's Y up by a
 *      rotation, (x, y, z) to (x, z, -y), never a mirror, so every face keeps
 *      its front (§2).
 *   2. Fit. The mesh is scaled so its largest side is `fit` ticks, keeping its
 *      proportions, centered over the origin in X and Z, with its lowest point
 *      on Y = 0: the floor, where PASTE FLOOR puts a paste.
 *   3. Quantize and merge. Every vertex is rounded onto the 1/120 lattice
 *      (§1.2), and vertices that land on one point become one vertex. This is
 *      done on integers, as §1.2 requires of every weld.
 *   4. Clean. A face whose corners merged, whose corners now lie on one line,
 *      or that repeats another face is dropped. So is a vertex no face uses.
 *   5. Color. Vertex and face colors snap to the nearest palette entry (in
 *      OKLab, as the workshop snaps), or the default color when the file has
 *      none.
 *   6. Fit the budget. If the shard's payload is over `budget` bytes, or it
 *      has more than `maxFaces` faces, the mesh is simplified by vertex
 *      clustering on a coarser cell of the same lattice: every vertex in a
 *      cell becomes one vertex at their average, and faces that collapse go.
 *      The cell is the smallest that fits, found by bisection, so the shard
 *      keeps as much detail as the budget allows.
 *
 * The result validates under fromPayload (§1.9) by construction, and the
 * tests check that it does.
 *
 * Why a byte budget and not a vertex count: the format has no ceiling on
 * vertices or faces (§1.8). The limit that is real is the relay's, and it is
 * in bytes.
 */

import { IMPORT_MAX_VERTICES, MeshImportError, makeClock, type Clock, type ImportMesh } from './mesh.js'
import { MAX_EXTENT, TICKS_PER_UNIT, neededExtent, toPayload, uuid, vertexAt, type ShardModel, type ShardVertex } from './shards.js'
import { BUILT_IN, toModel, type Palette, type Rgb } from './snoPalette.js'

/**
 * The payload an import is fitted to, in bytes.
 *
 * strfry's stock event limit is 65,536 bytes, and it is the most deployed relay
 * (DECK-0003 §1.8). ONOSENDAI hides a large shard as its own event, encrypted
 * and base64'd, which costs a third again, so a payload of this size still
 * fits a stock relay as a hidden object: 47,000 x 4/3 is 62,667, leaving room
 * for the tags, the signature and the 28 bytes of nonce and tag.
 */
export const IMPORT_BUDGET_BYTES = 47_000
/** The most faces an import keeps. The byte budget usually binds first. */
export const IMPORT_MAX_FACES = 5_000
/** The color a vertex gets when its file has none: the client's own cyan. */
export const IMPORT_DEFAULT_COLOR: Rgb = toModel(BUILT_IN[226])
/** The furthest a fitted shard may reach, in ticks: the 64-unit position bound (§1.8). */
export const IMPORT_MAX_FIT = MAX_EXTENT * TICKS_PER_UNIT

export interface MeshToShardOptions {
  /** The largest side of the result, in ticks. Default: 8 units. */
  fit?: number
  /** The shard's unit (§1.6). Default 0. */
  unit?: number
  /** The palette colors snap to. Default: the built-in. */
  palette?: Palette
  /** The color for a mesh with none, 0..1. Default IMPORT_DEFAULT_COLOR. */
  color?: Rgb
  /** The payload budget in bytes. Default IMPORT_BUDGET_BYTES. */
  budget?: number
  /** The most faces to keep. Default IMPORT_MAX_FACES. */
  maxFaces?: number
  /** The shard's name. */
  name?: string
  /** The clock the work runs against; a fresh IMPORT_TIME_MS clock by default. */
  clock?: Clock
}

/** What an import did, for the one line that tells the person. */
export interface ImportReport {
  /** Faces in the file, after polygons were split into triangles; points for a point cloud. */
  inputCount: number
  /** Faces (or points) in the shard. */
  count: number
  /** True when the file has no faces and came in as points. */
  points: boolean
  /** True when the mesh had to be simplified to fit. */
  simplified: boolean
  /** The clustering cell, in ticks: 1 means plain quantization. */
  cell: number
  /** The payload's size in bytes, serialized. */
  bytes: number
  vertices: number
  /** One short line: "Imported 12,400 faces as 1,850 (simplified to fit)". */
  summary: string
}

export interface Converted {
  shard: ShardModel
  report: ImportReport
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** The line an import reports. */
export function importSummary(r: Pick<ImportReport, 'inputCount' | 'count' | 'points' | 'simplified'>): string {
  const what = r.points ? 'points' : 'faces'
  if (r.simplified) return `Imported ${fmt(r.inputCount)} ${what} as ${fmt(r.count)} (simplified to fit)`
  return `Imported ${fmt(r.count)} ${r.count === 1 ? what.slice(0, -1) : what}`
}

/** Payload bytes, as the event's content would carry them. */
export function payloadBytes(s: ShardModel): number {
  return new TextEncoder().encode(JSON.stringify(toPayload(s))).length
}

/**
 * An open-addressed table from three integers to a dense id, in typed arrays,
 * so a million lookups allocate nothing. `limit` caps how many ids it hands out;
 * past it, `id` answers -1 and the caller knows the result is too big.
 */
class Table {
  private readonly mask: number
  private readonly ka: Int32Array
  private readonly kb: Int32Array
  private readonly kc: Int32Array
  private readonly val: Int32Array
  size = 0
  constructor(private readonly limit: number) {
    let cap = 16
    while (cap < limit * 2 + 2) cap *= 2
    this.mask = cap - 1
    this.ka = new Int32Array(cap)
    this.kb = new Int32Array(cap)
    this.kc = new Int32Array(cap)
    this.val = new Int32Array(cap).fill(-1)
  }
  /** The id of (a, b, c), adding it if it is new; -1 when adding would pass the limit. */
  id(a: number, b: number, c: number): number {
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & this.mask
    for (;;) {
      const v = this.val[h]
      if (v < 0) {
        if (this.size >= this.limit) return -1
        this.ka[h] = a; this.kb[h] = b; this.kc[h] = c
        this.val[h] = this.size
        return this.size++
      }
      if (this.ka[h] === a && this.kb[h] === b && this.kc[h] === c) return v
      h = (h + 1) & this.mask
    }
  }
  /** Whether (a, b, c) is in the table, without adding it. */
  has(a: number, b: number, c: number): boolean {
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & this.mask
    for (;;) {
      const v = this.val[h]
      if (v < 0) return false
      if (this.ka[h] === a && this.kb[h] === b && this.kc[h] === c) return true
      h = (h + 1) & this.mask
    }
  }
}

/** sRGB bytes to OKLab, as snoPalette measures "nearest". */
function oklab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const lr = lin(r / 255), lg = lin(g / 255), lb = lin(b / 255)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}

/**
 * Nearest palette index for a 0..1 color, with the palette's OKLab computed once
 * and each distinct byte color looked up once. Matches snoPalette's indexOf:
 * an exact entry first, then nearest in OKLab.
 */
function snapper(palette: Palette): (r: number, g: number, b: number) => number {
  const lab = palette.map((c) => oklab(c[0], c[1], c[2]))
  const exact = new Map<number, number>()
  palette.forEach((c, i) => { const k = (c[0] << 16) | (c[1] << 8) | c[2]; if (!exact.has(k)) exact.set(k, i) })
  const memo = new Map<number, number>()
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * 255)))
  return (r, g, b) => {
    const R = byte(r), G = byte(g), B = byte(b)
    const k = (R << 16) | (G << 8) | B
    const hit = exact.get(k) ?? memo.get(k)
    if (hit !== undefined) return hit
    const want = oklab(R, G, B)
    let best = 0, bestD = Infinity
    for (let i = 0; i < lab.length; i++) {
      const d = (lab[i][0] - want[0]) ** 2 + (lab[i][1] - want[1]) ** 2 + (lab[i][2] - want[2]) ** 2
      if (d < bestD) { bestD = d; best = i }
    }
    memo.set(k, best)
    return best
  }
}

/**
 * The value of the fewest bytes a vertex or face can cost in a payload:
 * "[0,0,0]," plus "0," for its color, and "[0,1,2],". Used to refuse a
 * candidate that cannot fit before spending time building it.
 */
const MIN_VERTEX_BYTES = 10
const MIN_FACE_BYTES = 8

/**
 * Ticks per voxel for a lattice mesh: the largest step that fits `maxSide`
 * voxels into `fit` ticks and still divides the lattice cleanly, so every
 * voxel corner lands on a tick and voxels line up with the workshop's
 * divisions. A multiple of a whole unit when there is room, else a divisor of
 * 120.
 */
function voxelStep(maxSide: number, fit: number): number {
  const most = Math.max(1, Math.floor(fit / Math.max(1, maxSide)))
  if (most >= TICKS_PER_UNIT) return Math.floor(most / TICKS_PER_UNIT) * TICKS_PER_UNIT
  const divisors = [60, 40, 30, 24, 20, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1]
  return divisors.find((d) => d <= most) ?? 1
}

/** One candidate result: a shard that fits, `empty` when no face survived, or null when it does not fit. */
type Fitted = { shard: ShardModel; bytes: number; faces: number; vertices: number }
type Attempt = Fitted | 'empty' | null

/**
 * The mesh as a shard, fitted to the grid and to the budget.
 *
 * Throws MeshImportError when there is nothing to make a shard of: no usable
 * vertex, a mesh whose every face is too thin to survive the lattice, or one
 * too detailed to fit the budget at any simplification.
 */
export function meshToShard(mesh: ImportMesh, options: MeshToShardOptions = {}): Converted {
  const clock = options.clock ?? makeClock()
  const fit = Math.max(1, Math.min(IMPORT_MAX_FIT, Math.round(options.fit ?? 8 * TICKS_PER_UNIT)))
  const palette = options.palette ?? BUILT_IN
  const budget = options.budget ?? IMPORT_BUDGET_BYTES
  const maxFaces = options.maxFaces ?? IMPORT_MAX_FACES
  const unit = options.unit ?? 0
  const name = (options.name ?? 'Imported').slice(0, 64)
  const fallback = options.color ?? IMPORT_DEFAULT_COLOR
  const snap = snapper(palette)

  const n = mesh.positions.length / 3
  const tris = mesh.triangles
  const triCount = tris.length / 3
  const hasFaces = triCount > 0

  // Which vertices take part: every one a triangle uses, or for a point
  // cloud every one that is a number. Others are not imported at all.
  const used = new Uint8Array(n)
  if (hasFaces) {
    for (let i = 0; i < tris.length; i++) { clock(); used[tris[i]] = 1 }
  } else {
    for (let i = 0; i < n; i++) {
      clock()
      const p = mesh.positions
      if (Number.isFinite(p[i * 3]) && Number.isFinite(p[i * 3 + 1]) && Number.isFinite(p[i * 3 + 2])) used[i] = 1
    }
  }

  // 1. Up: a rotation onto Y up, never a mirror.
  const zUp = mesh.up === 'z'
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let usedCount = 0
  for (let i = 0; i < n; i++) {
    clock()
    if (!used[i]) continue
    usedCount++
    const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2]
    const X = x, Y = zUp ? z : y, Z = zUp ? 0 - y : z
    px[i] = X; py[i] = Y; pz[i] = Z
    if (X < minX) minX = X; if (X > maxX) maxX = X
    if (Y < minY) minY = Y; if (Y > maxY) maxY = Y
    if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z
  }
  if (usedCount === 0) throw new MeshImportError('That file has no vertices that are numbers.')
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ
  const side = Math.max(dx, dy, dz)
  if (!Number.isFinite(side)) throw new MeshImportError('That file has coordinates too large to measure.')

  // 2. Fit, in ticks, still as floats: centered in X and Z, floor at Y = 0.
  if (mesh.lattice) {
    const step = voxelStep(side, fit)
    const ox = minX + Math.floor(dx / 2), oz = minZ + Math.floor(dz / 2)
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue
      px[i] = (px[i] - ox) * step; py[i] = (py[i] - minY) * step; pz[i] = (pz[i] - oz) * step
    }
  } else {
    const s = side > 0 ? fit / side : 0
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue
      px[i] = (px[i] - cx) * s; py[i] = (py[i] - minY) * s; pz[i] = (pz[i] - cz) * s
    }
  }
  let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue
    if (px[i] < fx0) fx0 = px[i]; if (px[i] > fx1) fx1 = px[i]
    if (py[i] < fy0) fy0 = py[i]; if (py[i] > fy1) fy1 = py[i]
    if (pz[i] < fz0) fz0 = pz[i]; if (pz[i] > fz1) fz1 = pz[i]
  }
  const reach = Math.max(fx1 - fx0, fy1 - fy0, fz1 - fz0)

  const vc = mesh.colors
  const tc = mesh.triangleColors
  const hasTriColor = (t: number): boolean => !!tc && Number.isFinite(tc[t * 3]) && Number.isFinite(tc[t * 3 + 1]) && Number.isFinite(tc[t * 3 + 2])

  const cluster = new Int32Array(n)
  const maxVertices = Math.max(1, Math.min(IMPORT_MAX_VERTICES, Math.floor(budget / MIN_VERTEX_BYTES)))
  const tried = new Map<number, Attempt>()

  /**
   * The shard at clustering cell `cell` ticks, or null when it does not fit
   * the budget. Cell 1 is plain quantization: every vertex rounded to its
   * nearest tick. A larger cell groups vertices by the cell they fall in and
   * puts each group at its average.
   */
  const attempt = (cell: number): Attempt => {
    if (tried.has(cell)) return tried.get(cell) as Attempt
    const result = build(cell)
    tried.set(cell, result)
    return result
  }

  const build = (cell: number): Attempt => {
    // 3. Quantize, and group.
    const cells = new Table(maxVertices)
    const sx = new Float64Array(maxVertices), sy = new Float64Array(maxVertices), sz = new Float64Array(maxVertices)
    const count = new Float64Array(maxVertices)
    const col = new Float64Array(maxVertices * 3)
    const exact = cell === 1
    for (let i = 0; i < n; i++) {
      clock()
      if (!used[i]) continue
      // `|| 0` folds -0 into 0, so a key or a coordinate never tells two zeros apart.
      const a = (exact ? Math.round(px[i]) : Math.floor((px[i] - fx0) / cell)) || 0
      const b = (exact ? Math.round(py[i]) : Math.floor((py[i] - fy0) / cell)) || 0
      const c = (exact ? Math.round(pz[i]) : Math.floor((pz[i] - fz0) / cell)) || 0
      const id = cells.id(a, b, c)
      if (id < 0) return null // more vertices than the budget can hold
      cluster[i] = id
      if (exact) { sx[id] = a; sy[id] = b; sz[id] = c } else { sx[id] += px[i]; sy[id] += py[i]; sz[id] += pz[i] }
      count[id]++
      if (vc) { col[id * 3] += vc[i * 3]; col[id * 3 + 1] += vc[i * 3 + 1]; col[id * 3 + 2] += vc[i * 3 + 2] }
    }
    const groups = cells.size
    // Each group's point, on the lattice. Two groups whose averages round to
    // one point become one vertex: the weld is on integers (§1.2).
    const points = new Table(groups)
    const groupTo = new Int32Array(groups)
    const vx: number[] = [], vy: number[] = [], vz: number[] = []
    const weight: number[] = []
    const vcol: number[] = []
    for (let g = 0; g < groups; g++) {
      const x = exact ? sx[g] : Math.round(sx[g] / count[g]) || 0
      const y = exact ? sy[g] : Math.round(sy[g] / count[g]) || 0
      const z = exact ? sz[g] : Math.round(sz[g] / count[g]) || 0
      const id = points.id(x, y, z)
      groupTo[g] = id
      if (id === vx.length) { vx.push(x); vy.push(y); vz.push(z); weight.push(0); vcol.push(0, 0, 0) }
      weight[id] += count[g]
      vcol[id * 3] += col[g * 3]; vcol[id * 3 + 1] += col[g * 3 + 1]; vcol[id * 3 + 2] += col[g * 3 + 2]
    }

    // 4. Faces that survive: three distinct corners, not on one line, not a repeat.
    const faces: Array<[number, number, number]> = []
    const source: number[] = []
    if (hasFaces) {
      const seen = new Table(maxFaces + 1)
      for (let t = 0; t < triCount; t++) {
        clock()
        const a = groupTo[cluster[tris[t * 3]]], b = groupTo[cluster[tris[t * 3 + 1]]], c = groupTo[cluster[tris[t * 3 + 2]]]
        if (a === b || b === c || a === c) continue
        const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a]
        const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a]
        if (uy * wz - uz * wy === 0 && uz * wx - ux * wz === 0 && ux * wy - uy * wx === 0) continue
        // A repeat is the same three corners whichever way round: SNO draws
        // both sides of every face (§1.4), so the second copy adds nothing.
        const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi
        if (seen.has(lo, mid, hi)) continue
        if (seen.id(lo, mid, hi) < 0 || faces.length >= maxFaces) return null
        faces.push([a, b, c])
        source.push(t)
      }
      if (faces.length === 0) return 'empty'
    }

    // A vertex no face uses is dropped from a mesh; a point cloud keeps them all.
    const keep = new Int32Array(vx.length).fill(hasFaces ? -1 : 0)
    if (hasFaces) for (const f of faces) for (const i of f) keep[i] = 0
    let next = 0
    for (let i = 0; i < keep.length; i++) if (keep[i] === 0) keep[i] = next++
    if (next * MIN_VERTEX_BYTES + faces.length * MIN_FACE_BYTES > budget) return null

    // 5. Colors, snapped to the palette.
    const faceIdx: number[] = []
    if (hasFaces && tc) {
      for (const t of source) faceIdx.push(hasTriColor(t) ? snap(tc[t * 3], tc[t * 3 + 1], tc[t * 3 + 2]) : -1)
    }
    const vertexIdx = new Int32Array(next)
    if (vc) {
      for (let i = 0; i < vx.length; i++) {
        if (keep[i] < 0) continue
        const w = weight[i] || 1
        vertexIdx[keep[i]] = snap(vcol[i * 3] / w, vcol[i * 3 + 1] / w, vcol[i * 3 + 2] / w)
      }
    } else if (faceIdx.some((k) => k >= 0)) {
      // Faces colored, vertices not: each vertex takes the average of the
      // faces around it, so POINTS and LINES look like the solid does.
      const sum = new Float64Array(vx.length * 3), cnt = new Float64Array(vx.length)
      faces.forEach((f, k) => {
        const t = source[k]
        if (!hasTriColor(t)) return
        for (const i of f) { sum[i * 3] += tc![t * 3]; sum[i * 3 + 1] += tc![t * 3 + 1]; sum[i * 3 + 2] += tc![t * 3 + 2]; cnt[i]++ }
      })
      const fb = snap(fallback[0], fallback[1], fallback[2])
      for (let i = 0; i < vx.length; i++) {
        if (keep[i] < 0) continue
        vertexIdx[keep[i]] = cnt[i] ? snap(sum[i * 3] / cnt[i], sum[i * 3 + 1] / cnt[i], sum[i * 3 + 2] / cnt[i]) : fb
      }
    } else {
      vertexIdx.fill(snap(fallback[0], fallback[1], fallback[2]))
    }

    const vertices: ShardVertex[] = new Array(next)
    for (let i = 0; i < vx.length; i++) {
      if (keep[i] < 0) continue
      // The wire is Y up with +Z toward the viewer, which is what the fit
      // produced; the model is the wire with Z negated (shards.ts flipZ).
      // `0 - z`, not `-z`, so a zero stays a zero.
      vertices[keep[i]] = vertexAt([vx[i], vy[i], 0 - vz[i]], toModel(palette[vertexIdx[keep[i]]]))
    }
    const outFaces = faces.map((f) => [keep[f[0]], keep[f[1]], keep[f[2]]] as [number, number, number])

    // A face's own color is a hard seam (§1.4a). Kept only when it shows:
    // when every face's corners already carry its color, interpolation draws
    // the same thing and the field is noise.
    let facecolors: Array<[number, number, number]> | undefined
    if (faceIdx.some((k) => k >= 0)) {
      const resolved = faceIdx.map((k, j) => (k >= 0 ? k : -1 - j))
      const seams = outFaces.some((f, j) => resolved[j] < 0 || f.some((v) => vertexIdx[v] !== resolved[j]))
      if (seams) {
        facecolors = outFaces.map((f, j) => {
          if (resolved[j] >= 0) return toModel(palette[resolved[j]])
          // A face the file left uncolored looks as its corners make it look.
          const avg = [0, 1, 2].map((ch) => f.reduce((acc, v) => acc + palette[vertexIdx[v]][ch], 0) / 3) as Rgb
          return toModel(palette[snap(avg[0] / 255, avg[1] / 255, avg[2] / 255)])
        })
      }
    }

    const draft: ShardModel = {
      id: uuid(),
      name,
      unit,
      extent: 1,
      mode: hasFaces ? 'solid' : 'points',
      vertices,
      faces: outFaces,
      ...(facecolors ? { facecolors } : {}),
      up: false,
      spin: 0,
      updatedAt: Date.now(),
    }
    const shard = { ...draft, extent: neededExtent(draft) }
    const bytes = payloadBytes(shard)
    if (bytes > budget) return null
    return { shard, bytes, faces: outFaces.length, vertices: next }
  }

  const inputCount = hasFaces ? triCount : usedCount
  const finish = (a: Fitted, cell: number): Converted => {
    const count = hasFaces ? a.faces : a.vertices
    const simplified = cell > 1
    const report = { inputCount, count, points: !hasFaces, simplified, cell, bytes: a.bytes, vertices: a.vertices }
    return { shard: a.shard, report: { ...report, summary: importSummary(report) } }
  }

  const first = attempt(1)
  if (first === 'empty') throw new MeshImportError('Every face in that file is too thin to keep on the grid. Try a larger GRID SIZE.')
  if (first) return finish(first, 1)

  // 6. Too big: the smallest cell that fits, by bisection. The size of the
  // result falls as the cell grows, so the first cell that fits is the one
  // that keeps the most. At a cell as large as the whole mesh everything is
  // one point, which always fits, so the search has an end.
  let lo = 2
  let hi = Math.max(2, Math.ceil(reach) + 1)
  if (attempt(hi) === null) throw new MeshImportError('That file cannot be made small enough to fit in an event.')
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (attempt(mid) !== null) hi = mid
    else lo = mid + 1
  }
  const best = attempt(lo)
  if (best === null || best === 'empty') throw new MeshImportError('That file is too detailed to fit in an event: simplified enough to fit, no face of it survives.')
  return finish(best, lo)
}
