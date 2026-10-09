/**
 * mesh.ts - a 3D file's mesh before it is a shard, and the rules for reading one.
 *
 * Every importer here (PLY, STL, OBJ, glTF, MagicaVoxel) turns its file into
 * the same small shape: positions, an optional color per vertex, triangles,
 * an optional color per triangle, and which way the file thinks is up. The
 * converter (meshToShard.ts) only ever sees that shape, so fitting,
 * quantizing, simplifying and palette snapping are written once.
 *
 * A file is untrusted input. Everything in this module exists so that a
 * malformed or hostile file fails with a sentence a person can act on, never a
 * crash, a hang, or an allocation sized by a number the file made up:
 *
 *   - the file size, the vertex count and the triangle count are capped
 *     before anything is allocated from them;
 *   - every declared count is checked against the bytes actually present;
 *   - every face index is checked against the vertex count;
 *   - a clock runs through every loop and stops the work when it runs out;
 *   - nothing here evaluates code or touches the network.
 *
 * Pure: bytes in, numbers out.
 */

import { triangulate, type P3 } from './triangulate.js'

/** The largest file an import reads. */
export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024
/** The most vertices a file may declare or hold. */
export const IMPORT_MAX_VERTICES = 4_000_000
/** The most triangles a file may hold, after its polygons are split. */
export const IMPORT_MAX_TRIANGLES = 4_000_000
/** The most corners one polygon may have. */
export const IMPORT_MAX_CORNERS = 1024
/** How long reading and converting one file may take. */
export const IMPORT_TIME_MS = 30_000

/** A file that cannot be imported, with a message meant for the person who chose it. */
export class MeshImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeshImportError'
  }
}

/** Which axis a file treats as up. SNO is Y up (DECK-0003 §2). */
export type Up = 'y' | 'z'

/**
 * A mesh as read from a file, in the file's own units and frame.
 *
 * Colors are sRGB, 0..1. Triangles are wound as the file wound them, which is
 * the front in every format read here (counter-clockwise seen from the front),
 * the same convention SNO uses, so nothing turns a face round on the way in.
 */
export interface ImportMesh {
  /** x, y, z per vertex. */
  positions: Float64Array
  /** r, g, b per vertex, when the file has vertex colors. */
  colors?: Float32Array
  /** Three vertex indices per triangle. Empty for a point cloud. */
  triangles: Uint32Array
  /** r, g, b per triangle, when the file colors its faces. */
  triangleColors?: Float32Array
  /** Which way is up in the file. */
  up: Up
  /** Positions are whole numbers on a voxel lattice (MagicaVoxel), and should land on the SNO lattice exactly. */
  lattice?: boolean
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A checkpoint to call inside every loop: it throws once the time is up. */
export type Clock = () => void

/**
 * A clock that runs out after `ms`. Called every iteration, it looks at the
 * time only every 16,384 calls, so it costs nothing in a tight loop.
 */
export function makeClock(ms: number = IMPORT_TIME_MS): Clock {
  const end = now() + ms
  let n = 0
  return () => {
    if ((++n & 0x3fff) === 0 && now() > end) throw new MeshImportError('That file took too long to read. Try a smaller or simpler one.')
  }
}

type Typed = Float64Array | Float32Array | Uint32Array

/** A typed array that grows as it is filled, for formats that do not say how much is coming. */
export class Grow<A extends Typed> {
  data: A
  length = 0
  constructor(private readonly make: (n: number) => A, initial = 1024) {
    this.data = make(initial)
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = this.make(this.data.length * 2)
      ;(next as Typed).set(this.data as never)
      this.data = next
    }
    this.data[this.length++] = v
  }
  /** Exactly what was pushed, in an array of its own. */
  done(): A {
    return this.data.slice(0, this.length) as A
  }
}

export const grow64 = (): Grow<Float64Array> => new Grow((n) => new Float64Array(n))
export const grow32 = (): Grow<Float32Array> => new Grow((n) => new Float32Array(n))
export const growU32 = (): Grow<Uint32Array> => new Grow((n) => new Uint32Array(n))

/** Refuses a declared vertex count before anything is allocated from it. */
export function checkVertexCount(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new MeshImportError('That file declares a vertex count that is not a number.')
  if (n > IMPORT_MAX_VERTICES) throw new MeshImportError(`That file has ${n.toLocaleString('en-US')} vertices. Import reads up to ${IMPORT_MAX_VERTICES.toLocaleString('en-US')}.`)
}

/** Refuses a triangle count over the cap. */
export function checkTriangleCount(n: number): void {
  if (n > IMPORT_MAX_TRIANGLES) throw new MeshImportError(`That file has more than ${IMPORT_MAX_TRIANGLES.toLocaleString('en-US')} faces. Import reads up to that many.`)
}

/**
 * Polygons as a file lists them: a flat run of corner indices, and how many
 * corners each polygon takes from it.
 */
export interface Polygons {
  corners: Uint32Array
  counts: Uint32Array
  /** r, g, b per polygon, when the file colors its faces. */
  colors?: Float32Array
}

/** Collects polygons as a parser reads them, and refuses one that is too big or too many. */
export class PolygonBuilder {
  readonly corners = growU32()
  readonly counts = growU32()
  colors: Grow<Float32Array> | null = null
  /** Triangles these polygons will become, to cap before splitting them. */
  private triangles = 0

  add(corners: ArrayLike<number>, color?: ArrayLike<number> | null): void {
    const n = corners.length
    if (n > IMPORT_MAX_CORNERS) throw new MeshImportError(`That file has a face with ${n.toLocaleString('en-US')} corners. Import reads faces of up to ${IMPORT_MAX_CORNERS}.`)
    if (n < 3) return // a point or an edge, not a face
    this.triangles += n - 2
    checkTriangleCount(this.triangles)
    for (let i = 0; i < n; i++) this.corners.push(corners[i])
    this.counts.push(n)
    if (color) {
      if (!this.colors) {
        // Polygons before the first colored one take no color of their own:
        // they are filled with NaN and painted later by finishMesh.
        this.colors = grow32()
        for (let i = 0; i < (this.counts.length - 1) * 3; i++) this.colors.push(NaN)
      }
      this.colors.push(color[0]); this.colors.push(color[1]); this.colors.push(color[2])
    } else if (this.colors) {
      this.colors.push(NaN); this.colors.push(NaN); this.colors.push(NaN)
    }
  }

  get count(): number {
    return this.counts.length
  }

  done(): Polygons {
    return { corners: this.corners.done(), counts: this.counts.done(), ...(this.colors ? { colors: this.colors.done() } : {}) }
  }
}

const finite3 = (p: Float64Array, i: number): boolean => Number.isFinite(p[i * 3]) && Number.isFinite(p[i * 3 + 1]) && Number.isFinite(p[i * 3 + 2])

/**
 * Splits a quad on the diagonal that keeps both halves facing the way the
 * quad does. A fan from the first corner is right for a convex quad and folds
 * a concave one over itself; the other diagonal is right for that one.
 */
function quadSplit(p: Float64Array, a: number, b: number, c: number, d: number): [number, number, number, number, number, number] {
  const n = newellOf(p, [a, b, c, d])
  const facing = (i: number, j: number, k: number): number => {
    const ux = p[j * 3] - p[i * 3], uy = p[j * 3 + 1] - p[i * 3 + 1], uz = p[j * 3 + 2] - p[i * 3 + 2]
    const vx = p[k * 3] - p[i * 3], vy = p[k * 3 + 1] - p[i * 3 + 1], vz = p[k * 3 + 2] - p[i * 3 + 2]
    return (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2]
  }
  if (facing(a, b, c) >= 0 && facing(a, c, d) >= 0) return [a, b, c, a, c, d]
  return [b, c, d, b, d, a]
}

function newellOf(p: Float64Array, idx: number[]): P3 {
  const n: P3 = [0, 0, 0]
  for (let i = 0; i < idx.length; i++) {
    const a = idx[i] * 3, b = idx[(i + 1) % idx.length] * 3
    n[0] += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2])
    n[1] += (p[a + 2] - p[b + 2]) * (p[a] + p[b])
    n[2] += (p[a] - p[b]) * (p[a + 1] + p[b + 1])
  }
  return n
}

/** Ear clipping is quadratic in a polygon's corners, so past this many a fan is used instead. */
const EAR_CLIP_MAX = 32

/**
 * A mesh from vertices and polygons, the last step of every parser.
 *
 * Every corner index is checked against the vertex count, because a face that
 * points past the end of the list is the one defect that crashes renderers
 * far from its cause (DECK-0003 §1.4). A vertex that is not a number (NaN or
 * infinite, which scanners write for a point they did not see) is dropped with
 * every polygon that uses it. Polygons become triangles in their own winding:
 * a quad on the diagonal that keeps it flat, five to 32 corners by ear
 * clipping, and anything larger as a fan.
 */
export function finishMesh(input: {
  positions: Float64Array
  colors?: Float32Array
  polygons: Polygons
  up: Up
  lattice?: boolean
  clock: Clock
}): ImportMesh {
  const { positions, polygons, clock } = input
  const vertexCount = positions.length / 3
  checkVertexCount(vertexCount)
  const { corners, counts } = polygons
  for (let i = 0; i < corners.length; i++) {
    clock()
    if (corners[i] >= vertexCount) {
      throw new MeshImportError(`A face in that file points at vertex ${corners[i].toLocaleString('en-US')}, but the file has only ${vertexCount.toLocaleString('en-US')} vertices.`)
    }
  }
  const tris = growU32()
  const triColors = polygons.colors ? grow32() : null
  let at = 0
  for (let f = 0; f < counts.length; f++) {
    clock()
    const n = counts[f]
    const start = at
    at += n
    let ok = true
    for (let k = start; k < start + n; k++) if (!finite3(positions, corners[k])) { ok = false; break }
    if (!ok) continue
    const before = tris.length
    if (n === 3) {
      tris.push(corners[start]); tris.push(corners[start + 1]); tris.push(corners[start + 2])
    } else if (n === 4) {
      for (const i of quadSplit(positions, corners[start], corners[start + 1], corners[start + 2], corners[start + 3])) tris.push(i)
    } else {
      const loop = Array.from(corners.subarray(start, start + n))
      const ears = n <= EAR_CLIP_MAX
        ? triangulate(loop.map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] as P3))
        : null
      if (ears) for (const t of ears) { tris.push(loop[t[0]]); tris.push(loop[t[1]]); tris.push(loop[t[2]]) }
      else for (let k = 1; k + 1 < n; k++) { tris.push(loop[0]); tris.push(loop[k]); tris.push(loop[k + 1]) }
    }
    if (triColors && polygons.colors) {
      for (let t = before; t < tris.length; t += 3) {
        triColors.push(polygons.colors[f * 3]); triColors.push(polygons.colors[f * 3 + 1]); triColors.push(polygons.colors[f * 3 + 2])
      }
    }
  }
  return {
    positions,
    ...(input.colors ? { colors: input.colors } : {}),
    triangles: tris.done(),
    ...(triColors ? { triangleColors: triColors.done() } : {}),
    up: input.up,
    ...(input.lattice ? { lattice: true } : {}),
  }
}

/**
 * Colors that may be bytes written as floats: some writers put 0..255 where
 * 0..1 belongs. If any channel is over 1, the whole set is read as bytes.
 * NaN (no color) is left alone.
 */
export function normalizeColorScale(c: Float32Array): void {
  let max = 0
  for (let i = 0; i < c.length; i++) if (c[i] > max) max = c[i]
  if (max > 1) for (let i = 0; i < c.length; i++) c[i] = c[i] / 255
  for (let i = 0; i < c.length; i++) if (c[i] < 0) c[i] = 0; else if (c[i] > 1) c[i] = 1
}

/** UTF-8 text, for the text formats. Invalid bytes become U+FFFD rather than an exception. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** A file's name without its folder or extension, as a shard name. */
export function baseName(name: string): string {
  const file = name.split(/[\\/]/).pop() ?? name
  const dot = file.lastIndexOf('.')
  const stem = (dot > 0 ? file.slice(0, dot) : file).trim()
  return (stem || 'Imported').slice(0, 64)
}
