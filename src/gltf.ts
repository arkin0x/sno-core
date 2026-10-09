/**
 * gltf.ts - reading glTF 2.0 (a .glb, or a .gltf with its buffers) into a mesh.
 *
 * glTF is the modern exchange format, and the one SNO describes itself
 * against: an SNO is `KHR_materials_unlit` with `COLOR_0` (DECK-0003 §7.2).
 *
 * This is a geometry reader, not a renderer's loader, and that is on purpose.
 * A full loader (three.js's GLTFLoader) resolves every buffer and image a file
 * names, over the network if the file says so, and decodes textures, which
 * needs a DOM. Import may never fetch, and needs none of that. So this reads
 * what becomes a shard and nothing else:
 *
 *   - the default scene's node tree, with each node's matrix or translation,
 *     rotation and scale applied, and a mirroring transform turning its faces
 *     round so their fronts stay fronts (§2);
 *   - each primitive's POSITION, its indices, and its mode: triangles, strips
 *     and fans become triangles; points become a point cloud when the file
 *     has no faces at all; lines are skipped;
 *   - COLOR_0 as vertex colors, and a material's baseColorFactor as the color
 *     of its faces, both converted from glTF's linear light to the sRGB the
 *     palette is in.
 *
 * Buffers are read from the GLB's own binary chunk, from base64 `data:` URIs,
 * or from files picked alongside a .gltf, matched by name. A buffer at any
 * other address is refused, never fetched. Draco and meshopt compression
 * are refused with a sentence saying so, and so are sparse accessors.
 *
 * Textures are not sampled: a textured model comes in in its base color.
 */

import { IMPORT_MAX_TRIANGLES, IMPORT_MAX_VERTICES, MeshImportError, PolygonBuilder, decodeText, finishMesh, grow32, grow64, type Clock, type ImportMesh } from './mesh.js'

type Json = Record<string, unknown>
type M4 = Float64Array

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/** Whether these bytes are a GLB. */
export function looksLikeGlb(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const REFUSED_EXTENSIONS: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco',
  EXT_meshopt_compression: 'meshopt',
  KHR_meshopt_compression: 'meshopt',
}
/** How deep a node tree may go, and how many node visits a file may cost, so a loop or a fan-out cannot hang the import. */
const MAX_DEPTH = 64
const MAX_VISITS = 100_000

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const int = (v: unknown, what: string): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new MeshImportError(`That glTF has ${what} that is not a count.`)
  return v as number
}

/** Linear light to sRGB, as the palette is written. */
function toSrgb(c: number): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** The JSON and the binary chunk of a GLB, or the JSON of a .gltf. */
function split(bytes: Uint8Array): { json: Json; bin: Uint8Array | null } {
  let text: string
  let bin: Uint8Array | null = null
  if (looksLikeGlb(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new MeshImportError('That is not a GLB file.')
    const version = view.getUint32(4, true)
    if (version !== 2) throw new MeshImportError(`That GLB is version ${version}. Import reads glTF 2.`)
    const length = view.getUint32(8, true)
    if (length > bytes.length) throw new MeshImportError('That GLB file is cut short: it is smaller than its header says.')
    let at = 12
    let json: Uint8Array | null = null
    while (at + 8 <= length) {
      const size = view.getUint32(at, true)
      const type = view.getUint32(at + 4, true)
      const start = at + 8
      if (start + size > length) throw new MeshImportError('That GLB file is cut short: a chunk runs past its end.')
      if (type === CHUNK_JSON && !json) json = bytes.subarray(start, start + size)
      else if (type === CHUNK_BIN && !bin) bin = bytes.subarray(start, start + size)
      at = start + size + ((4 - (size % 4)) % 4)
    }
    if (!json) throw new MeshImportError('That GLB has no JSON chunk.')
    text = decodeText(json)
  } else {
    text = decodeText(bytes)
  }
  let json: unknown
  try { json = JSON.parse(text) } catch { throw new MeshImportError('That glTF\'s JSON does not parse.') }
  if (!isObj(json)) throw new MeshImportError('That glTF\'s JSON is not an object.')
  const asset = json.asset
  if (!isObj(asset) || typeof asset.version !== 'string' || !asset.version.startsWith('2')) {
    throw new MeshImportError('That is not a glTF 2 file.')
  }
  return { json, bin }
}

/** A buffer's bytes, from the GLB, a data URI, or a file picked with it; never from the network. */
function bufferResolver(json: Json, bin: Uint8Array | null, companions: Map<string, Uint8Array>): (i: number) => Uint8Array {
  const buffers = arr(json.buffers)
  const cache = new Map<number, Uint8Array>()
  return (i) => {
    const hit = cache.get(i)
    if (hit) return hit
    const b = buffers[i]
    if (!isObj(b)) throw new MeshImportError(`That glTF names buffer ${i}, which it does not have.`)
    const byteLength = int(b.byteLength, 'a buffer length')
    let data: Uint8Array
    if (b.uri === undefined) {
      if (i !== 0 || !bin) throw new MeshImportError('That glTF has a buffer with no data.')
      data = bin
    } else if (typeof b.uri !== 'string') {
      throw new MeshImportError('That glTF has a buffer whose address is not text.')
    } else if (b.uri.startsWith('data:')) {
      const comma = b.uri.indexOf(',')
      if (comma < 0 || !b.uri.slice(0, comma).endsWith(';base64')) throw new MeshImportError('That glTF has a data buffer that is not base64.')
      data = base64(b.uri.slice(comma + 1))
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(b.uri) || b.uri.startsWith('//')) {
      throw new MeshImportError('That glTF keeps its data at a web address. Import never fetches: export it as a .glb, or embed its buffers.')
    } else {
      let name = b.uri
      try { name = decodeURIComponent(b.uri) } catch { /* keep it as written */ }
      const file = companions.get(name.split('/').pop() ?? name)
      if (!file) throw new MeshImportError(`That glTF keeps its data in "${name.slice(0, 64)}". Pick that file together with the .gltf.`)
      data = file
    }
    if (data.length < byteLength) throw new MeshImportError('That glTF has a buffer shorter than it says.')
    cache.set(i, data)
    return data
  }
}

function base64(s: string): Uint8Array {
  let bin: string
  try { bin = atob(s) } catch { throw new MeshImportError('That glTF has a data buffer that is not valid base64.') }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * An accessor read into floats, normalized as its `normalized` flag says,
 * with every offset, stride and count checked against the bytes behind it.
 */
function accessorReader(json: Json, buffer: (i: number) => Uint8Array, clock: Clock): (i: number, cap: number) => { data: Float64Array; size: number; count: number } {
  const accessors = arr(json.accessors)
  const views = arr(json.bufferViews)
  return (i, cap) => {
    const a = accessors[i]
    if (!isObj(a)) throw new MeshImportError(`That glTF names accessor ${i}, which it does not have.`)
    if (a.sparse !== undefined) throw new MeshImportError('That glTF uses sparse accessors, which import does not read. Export it without them.')
    const size = COMPONENTS[a.type as string]
    const bytesEach = COMPONENT_SIZE[a.componentType as number]
    if (!size || !bytesEach) throw new MeshImportError('That glTF has an accessor of a type it cannot read.')
    const count = int(a.count, 'an accessor count')
    if (count > cap) throw new MeshImportError(`That glTF has an accessor of ${count.toLocaleString('en-US')} items. Import reads up to ${cap.toLocaleString('en-US')}.`)
    const data = new Float64Array(count * size)
    if (a.bufferView === undefined) return { data, size, count } // all zeros, as the spec says
    const view = views[int(a.bufferView, 'a buffer view')]
    if (!isObj(view)) throw new MeshImportError('That glTF names a buffer view it does not have.')
    const buf = buffer(int(view.buffer, 'a buffer index'))
    const viewOffset = view.byteOffset === undefined ? 0 : int(view.byteOffset, 'a buffer offset')
    const viewLength = int(view.byteLength, 'a buffer view length')
    if (viewOffset + viewLength > buf.length) throw new MeshImportError('That glTF has a buffer view that runs past its buffer.')
    const elem = size * bytesEach
    const stride = view.byteStride === undefined ? elem : int(view.byteStride, 'a stride')
    if (stride < elem) throw new MeshImportError('That glTF has a stride shorter than the items it strides over.')
    const offset = a.byteOffset === undefined ? 0 : int(a.byteOffset, 'an accessor offset')
    if (count > 0 && offset + stride * (count - 1) + elem > viewLength) throw new MeshImportError('That glTF has an accessor that runs past its data.')
    const dv = new DataView(buf.buffer, buf.byteOffset + viewOffset, viewLength)
    const ct = a.componentType as number
    const norm = a.normalized === true
    for (let k = 0; k < count; k++) {
      clock()
      const base = offset + k * stride
      for (let c = 0; c < size; c++) {
        const at = base + c * bytesEach
        let v: number
        switch (ct) {
          case 5120: v = dv.getInt8(at); if (norm) v = Math.max(v / 127, -1); break
          case 5121: v = dv.getUint8(at); if (norm) v /= 255; break
          case 5122: v = dv.getInt16(at, true); if (norm) v = Math.max(v / 32767, -1); break
          case 5123: v = dv.getUint16(at, true); if (norm) v /= 65535; break
          case 5125: v = dv.getUint32(at, true); break
          default: v = dv.getFloat32(at, true)
        }
        data[k * size + c] = v
      }
    }
    return { data, size, count }
  }
}

function identity(): M4 {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function multiply(a: M4, b: M4): M4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    out[c * 4 + r] = s
  }
  return out
}

const nums = (v: unknown, n: number): number[] | null => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null)

/** A node's local transform, column-major as glTF writes it. */
function localMatrix(node: Json): M4 {
  const matrix = nums(node.matrix, 16)
  if (matrix) return Float64Array.from(matrix)
  const t = nums(node.translation, 3) ?? [0, 0, 0]
  const q = nums(node.rotation, 4) ?? [0, 0, 0, 1]
  const s = nums(node.scale, 3) ?? [1, 1, 1]
  const [x, y, z, w] = q
  const m = new Float64Array(16)
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = 2 * (x * y + z * w) * s[0]; m[2] = 2 * (x * z - y * w) * s[0]
  m[4] = 2 * (x * y - z * w) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = 2 * (y * z + x * w) * s[1]
  m[8] = 2 * (x * z + y * w) * s[2]; m[9] = 2 * (y * z - x * w) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2]
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1
  return m
}

const determinant3 = (m: M4): number =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

/** A glTF or GLB as a mesh. `companions` are other files picked with a .gltf, by name. */
export function parseGltf(bytes: Uint8Array, clock: Clock, companions: Map<string, Uint8Array> = new Map()): ImportMesh {
  const { json, bin } = split(bytes)
  for (const e of arr(json.extensionsRequired)) {
    if (typeof e === 'string' && REFUSED_EXTENSIONS[e]) throw new MeshImportError(`That glTF is ${REFUSED_EXTENSIONS[e]} compressed, which import does not read. Export it without compression.`)
  }
  const buffer = bufferResolver(json, bin, companions)
  const accessor = accessorReader(json, buffer, clock)
  const nodes = arr(json.nodes)
  const meshes = arr(json.meshes)
  const materials = arr(json.materials)

  // The meshes to draw and where: the default scene's tree, or every mesh at
  // the origin when the file has no nodes.
  const draws: Array<{ mesh: number; matrix: M4 }> = []
  const scenes = arr(json.scenes)
  let roots: number[]
  if (nodes.length === 0) {
    meshes.forEach((_, i) => draws.push({ mesh: i, matrix: identity() }))
    roots = []
  } else if (scenes.length) {
    const which = json.scene === undefined ? 0 : int(json.scene, 'a scene index')
    const scene = scenes[which]
    roots = isObj(scene) ? arr(scene.nodes).filter((n): n is number => Number.isSafeInteger(n)) : []
  } else {
    const children = new Set<number>()
    for (const n of nodes) if (isObj(n)) for (const c of arr(n.children)) if (Number.isSafeInteger(c)) children.add(c as number)
    roots = nodes.map((_, i) => i).filter((i) => !children.has(i))
  }
  let visits = 0
  const walk = (i: number, parent: M4, depth: number): void => {
    clock()
    if (++visits > MAX_VISITS) throw new MeshImportError('That glTF has too many nodes to import.')
    if (depth > MAX_DEPTH) throw new MeshImportError('That glTF\'s node tree is too deep, or loops back on itself.')
    const node = nodes[i]
    if (!isObj(node)) throw new MeshImportError(`That glTF names node ${i}, which it does not have.`)
    const world = multiply(parent, localMatrix(node))
    if (node.mesh !== undefined) draws.push({ mesh: int(node.mesh, 'a mesh index'), matrix: world })
    for (const c of arr(node.children)) walk(int(c, 'a node index'), world, depth + 1)
  }
  for (const r of roots) walk(r, identity(), 0)

  const positions = grow64()
  const colors = grow32()
  let anyVertexColor = false
  const polygons = new PolygonBuilder()
  let points = 0
  const tri = [0, 0, 0]
  for (const { mesh: mi, matrix } of draws) {
    const mesh = meshes[mi]
    if (!isObj(mesh)) throw new MeshImportError(`That glTF names mesh ${mi}, which it does not have.`)
    const flip = determinant3(matrix) < 0
    for (const prim of arr(mesh.primitives)) {
      if (!isObj(prim) || !isObj(prim.attributes)) continue
      const mode = prim.mode === undefined ? 4 : prim.mode
      if (mode !== 0 && mode !== 4 && mode !== 5 && mode !== 6) continue // lines
      if (prim.attributes.POSITION === undefined) continue
      const pos = accessor(int(prim.attributes.POSITION, 'an accessor index'), IMPORT_MAX_VERTICES)
      if (pos.size !== 3) throw new MeshImportError('That glTF has positions that are not three numbers each.')
      const base = positions.length / 3
      if (base + pos.count > IMPORT_MAX_VERTICES) throw new MeshImportError(`That glTF has more than ${IMPORT_MAX_VERTICES.toLocaleString('en-US')} vertices. Import reads up to that many.`)

      // The material's base color, only when the file states one: a factor
      // left at its default is white, and white is not a color anyone chose.
      const mat = prim.material === undefined ? null : materials[int(prim.material, 'a material index')]
      const pbr = isObj(mat) && isObj(mat.pbrMetallicRoughness) ? mat.pbrMetallicRoughness : null
      const factor = pbr ? nums(pbr.baseColorFactor, 4) : null
      const linear = factor ?? [1, 1, 1, 1]

      for (let k = 0; k < pos.count; k++) {
        clock()
        const x = pos.data[k * 3], y = pos.data[k * 3 + 1], z = pos.data[k * 3 + 2]
        positions.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12])
        positions.push(matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13])
        positions.push(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14])
      }
      const col = prim.attributes.COLOR_0 === undefined ? null : accessor(int(prim.attributes.COLOR_0, 'an accessor index'), IMPORT_MAX_VERTICES)
      if (col && (col.count !== pos.count || col.size < 3)) throw new MeshImportError('That glTF has vertex colors that do not match its vertices.')
      if (col) anyVertexColor = true
      for (let k = 0; k < pos.count; k++) {
        // COLOR_0 times the base color, in linear light, then to sRGB. A
        // primitive without COLOR_0 is its base color, white without one.
        for (let c = 0; c < 3; c++) colors.push(toSrgb((col ? col.data[k * col.size + c] : 1) * linear[c]))
      }

      if (mode === 0) { points += pos.count; continue }
      const idx = prim.indices === undefined ? null : accessor(int(prim.indices, 'an accessor index'), IMPORT_MAX_TRIANGLES * 3)
      if (idx && idx.size !== 1) throw new MeshImportError('That glTF has indices that are not single numbers.')
      const count = idx ? idx.count : pos.count
      const at = (k: number): number => {
        const v = idx ? idx.data[k] : k
        if (!Number.isInteger(v) || v < 0 || v >= pos.count) throw new MeshImportError(`A face in that glTF points at vertex ${v}, but its mesh has only ${pos.count.toLocaleString('en-US')}.`)
        return base + v
      }
      const faceColor = factor ? [toSrgb(linear[0]), toSrgb(linear[1]), toSrgb(linear[2])] : null
      const emit = (a: number, b: number, c: number): void => {
        clock()
        tri[0] = at(a); tri[1] = flip ? at(c) : at(b); tri[2] = flip ? at(b) : at(c)
        polygons.add(tri, faceColor)
      }
      if (mode === 4) for (let k = 0; k + 2 < count; k += 3) emit(k, k + 1, k + 2)
      else if (mode === 5) for (let k = 0; k + 2 < count; k++) { if (k % 2 === 0) emit(k, k + 1, k + 2); else emit(k + 1, k, k + 2) }
      else for (let k = 1; k + 1 < count; k++) emit(0, k, k + 1)
    }
  }
  if (positions.length === 0) throw new MeshImportError('That glTF has no meshes with positions.')
  // Points stand alone only in a file with no faces; beside faces they would
  // be strays, and SNO's points are every vertex anyway (§1.5).
  if (polygons.count === 0 && points === 0) throw new MeshImportError('That glTF has no faces or points, only lines.')
  return finishMesh({
    positions: positions.done(),
    // Vertex colors only when the file has COLOR_0. Without it, a material's
    // color travels on the faces, and the converter colors each vertex from
    // the faces around it; a file with neither takes the default color.
    ...(anyVertexColor ? { colors: colors.done() } : {}),
    polygons: polygons.done(),
    up: 'y',
    clock,
  })
}
