/**
 * obj.ts - reading a Wavefront OBJ file, and its MTL, into a mesh.
 *
 * OBJ is the plain-text mesh every modeling tool writes. What is read:
 *
 *   - `v x y z`, and `v x y z r g b`, the vertex color extension that
 *     MeshLab, ZBrush and Blender write;
 *   - `f` with any of the `v`, `v/vt`, `v//vn` and `v/vt/vn` forms, counting
 *     from 1 or, negative, back from the latest vertex; polygons are split
 *     into triangles in their own winding;
 *   - `usemtl` naming a material, whose `Kd` (diffuse color) in the MTL file
 *     colors the faces after it. The MTL comes in as a second file picked
 *     with the OBJ; without it, faces take the default color.
 *
 * Everything else (texture coordinates, normals, lines, groups, smoothing,
 * curves) is read past. OBJ is Y up by convention, as SNO is.
 */

import { IMPORT_MAX_VERTICES, MeshImportError, PolygonBuilder, decodeText, finishMesh, grow32, grow64, normalizeColorScale, type Clock, type ImportMesh } from './mesh.js'

/** Materials by name: the diffuse color of each, 0..1. */
export type Materials = Map<string, [number, number, number]>

/** The materials in an MTL file. Unreadable lines are skipped: a material is a nicety, never a reason to refuse. */
export function parseMtl(text: string): Materials {
  const out: Materials = new Map()
  let current: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('newmtl')) {
      current = line.slice(6).trim()
    } else if (current !== null && /^Kd\s/.test(line)) {
      const v = line.slice(2).trim().split(/\s+/).map(Number)
      if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) {
        out.set(current, [Math.min(1, Math.max(0, v[0])), Math.min(1, Math.max(0, v[1])), Math.min(1, Math.max(0, v[2]))])
      }
    }
  }
  return out
}

/** The MTL files an OBJ names with `mtllib`, so the caller can match the ones picked with it. */
export function mtlNames(text: string): string[] {
  const out: string[] = []
  const re = /^[ \t]*mtllib[ \t]+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(...m[1].trim().split(/\s+/))
  return out
}

/** An OBJ file as a mesh, colored by `materials` where its faces name one. */
export function parseObj(bytes: Uint8Array, clock: Clock, materials: Materials = new Map()): ImportMesh {
  const text = decodeText(bytes)
  const positions = grow64()
  const colors = grow32()
  let anyVertexColor = false
  const polygons = new PolygonBuilder()
  let material: [number, number, number] | null = null
  const corners: number[] = []
  let start = 0
  const len = text.length
  while (start < len) {
    clock()
    let end = text.indexOf('\n', start)
    if (end < 0) end = len
    const line = text.slice(start, end)
    start = end + 1
    const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1)
    // 'v' and a space or tab: a vertex. 'vt', 'vn', 'vp' are not.
    if (c0 === 118 && (c1 === 32 || c1 === 9)) {
      const w = line.trim().split(/\s+/)
      if (w.length < 4) throw new MeshImportError('That OBJ has a vertex with fewer than three coordinates.')
      for (let k = 1; k <= 3; k++) positions.push(num(w[k]))
      if (positions.length / 3 > IMPORT_MAX_VERTICES) throw new MeshImportError(`That OBJ has more than ${IMPORT_MAX_VERTICES.toLocaleString('en-US')} vertices. Import reads up to that many.`)
      if (w.length >= 7) {
        anyVertexColor = true
        for (let k = 4; k <= 6; k++) colors.push(num(w[k]))
      } else {
        colors.push(NaN); colors.push(NaN); colors.push(NaN)
      }
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {
      const w = line.trim().split(/\s+/)
      corners.length = 0
      const count = positions.length / 3
      for (let k = 1; k < w.length; k++) {
        const slash = w[k].indexOf('/')
        const ref = Number(slash < 0 ? w[k] : w[k].slice(0, slash))
        if (!Number.isInteger(ref) || ref === 0) throw new MeshImportError(`That OBJ has a face corner that is not a vertex: "${w[k].slice(0, 24)}".`)
        const index = ref > 0 ? ref - 1 : count + ref
        if (index < 0 || index >= count) throw new MeshImportError(`A face in that OBJ points at vertex ${ref}, but only ${count.toLocaleString('en-US')} come before it.`)
        corners.push(index)
      }
      polygons.add(corners, material)
    } else if (line.startsWith('usemtl')) {
      material = materials.get(line.slice(6).trim()) ?? null
    }
  }
  if (positions.length === 0) throw new MeshImportError('That OBJ has no vertices.')
  let vertexColors: Float32Array | undefined
  if (anyVertexColor) {
    vertexColors = colors.done()
    // A vertex written without a color among ones written with: white, as readers treat it.
    for (let i = 0; i < vertexColors.length; i++) if (Number.isNaN(vertexColors[i])) vertexColors[i] = 1
    normalizeColorScale(vertexColors)
  }
  return finishMesh({ positions: positions.done(), ...(vertexColors ? { colors: vertexColors } : {}), polygons: polygons.done(), up: 'y', clock })
}

function num(s: string): number {
  const v = Number(s)
  if (Number.isNaN(v) && !/^[+-]?nan$/i.test(s)) throw new MeshImportError(`That OBJ has a coordinate that is not a number: "${s.slice(0, 24)}".`)
  return v
}
