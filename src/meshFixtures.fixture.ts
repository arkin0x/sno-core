/**
 * meshFixtures.fixture.ts - small 3D files written in code, for the import
 * tests. Nothing binary is checked in: every fixture is generated here, from
 * a few numbers, in the exact byte layout its format specifies.
 *
 * Excluded from the build (tsconfig.build.json), like the tests.
 */

export type V3 = [number, number, number]

/** A unit cube from 0 to 1, as six quads wound counter-clockwise seen from outside. */
export const CUBE_POINTS: V3[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]
export const CUBE_QUADS: number[][] = [
  [0, 3, 2, 1], // -z
  [4, 5, 6, 7], // +z
  [0, 1, 5, 4], // -y
  [3, 7, 6, 2], // +y
  [0, 4, 7, 3], // -x
  [1, 2, 6, 5], // +x
]
export const CUBE_TRIS: number[][] = CUBE_QUADS.flatMap((q) => [[q[0], q[1], q[2]], [q[0], q[2], q[3]]])
/** Red, green, blue and white corners: four exact palette colors (DECK-0003 Appendix C: 238, 235, 239, 225). */
export const CUBE_COLORS: V3[] = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255],
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255],
]

const enc = new TextEncoder()
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

export interface PlySpec {
  points: V3[]
  colors?: V3[]
  /** Write vertex colors as floats 0..1 rather than uchar. */
  floatColors?: boolean
  faces?: number[][]
  faceColors?: V3[]
  /** An extra element after the faces, to be read past. */
  extraEdges?: Array<[number, number]>
}

function plyHeader(spec: PlySpec, format: string): string {
  const lines = ['ply', `format ${format} 1.0`, 'comment made by the sno-core tests', `element vertex ${spec.points.length}`, 'property float x', 'property float y', 'property float z']
  if (spec.colors) {
    const t = spec.floatColors ? 'float' : 'uchar'
    lines.push(`property ${t} red`, `property ${t} green`, `property ${t} blue`)
  }
  if (spec.faces) {
    lines.push(`element face ${spec.faces.length}`, 'property list uchar int vertex_indices')
    if (spec.faceColors) lines.push('property uchar red', 'property uchar green', 'property uchar blue')
  }
  if (spec.extraEdges) lines.push(`element edge ${spec.extraEdges.length}`, 'property int vertex1', 'property int vertex2')
  lines.push('end_header')
  return lines.join('\n') + '\n'
}

export function plyAscii(spec: PlySpec): Uint8Array {
  const rows: string[] = []
  spec.points.forEach((p, i) => {
    const c = spec.colors?.[i]
    rows.push([...p, ...(c ? (spec.floatColors ? c.map((x) => x / 255) : c) : [])].join(' '))
  })
  spec.faces?.forEach((f, i) => rows.push([f.length, ...f, ...(spec.faceColors ? spec.faceColors[i] : [])].join(' ')))
  spec.extraEdges?.forEach((e) => rows.push(e.join(' ')))
  return enc.encode(plyHeader(spec, 'ascii') + rows.join('\n') + '\n')
}

export function plyBinary(spec: PlySpec, little: boolean): Uint8Array {
  const header = enc.encode(plyHeader(spec, little ? 'binary_little_endian' : 'binary_big_endian'))
  const colorBytes = spec.colors ? (spec.floatColors ? 12 : 3) : 0
  let size = spec.points.length * (12 + colorBytes)
  for (const f of spec.faces ?? []) size += 1 + f.length * 4 + (spec.faceColors ? 3 : 0)
  size += (spec.extraEdges?.length ?? 0) * 8
  const body = new Uint8Array(size)
  const dv = new DataView(body.buffer)
  let at = 0
  spec.points.forEach((p, i) => {
    for (const v of p) { dv.setFloat32(at, v, little); at += 4 }
    const c = spec.colors?.[i]
    if (c) for (const v of c) { if (spec.floatColors) { dv.setFloat32(at, v / 255, little); at += 4 } else dv.setUint8(at++, v) }
  })
  spec.faces?.forEach((f, i) => {
    dv.setUint8(at++, f.length)
    for (const v of f) { dv.setInt32(at, v, little); at += 4 }
    if (spec.faceColors) for (const v of spec.faceColors[i]) dv.setUint8(at++, v)
  })
  spec.extraEdges?.forEach((e) => { for (const v of e) { dv.setInt32(at, v, little); at += 4 } })
  return concat([header, body])
}

/** Triangles as STL wants them: three corners each. */
export type Tri = [V3, V3, V3]

export const cubeTris = (scale: V3 = [1, 1, 1]): Tri[] =>
  CUBE_TRIS.map((t) => t.map((i) => CUBE_POINTS[i].map((v, a) => v * scale[a])) as Tri)

export function stlAscii(tris: Tri[], name = 'cube'): Uint8Array {
  const out = [`solid ${name}`]
  for (const t of tris) {
    out.push('  facet normal 0 0 0', '    outer loop')
    for (const p of t) out.push(`      vertex ${p[0]} ${p[1]} ${p[2]}`)
    out.push('    endloop', '  endfacet')
  }
  out.push(`endsolid ${name}`)
  return enc.encode(out.join('\n') + '\n')
}

/**
 * A binary STL. `header` defaults to one that starts with "solid", as many
 * writers' do, so the size test is what tells it apart from ASCII.
 */
export function stlBinary(tris: Tri[], attrs?: number[], header = 'solid binary written by the sno-core tests'): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50)
  out.set(enc.encode(header).subarray(0, 80))
  const dv = new DataView(out.buffer)
  dv.setUint32(80, tris.length, true)
  tris.forEach((t, i) => {
    const at = 84 + i * 50
    t.forEach((p, k) => p.forEach((v, a) => dv.setFloat32(at + 12 + k * 12 + a * 4, v, true)))
    dv.setUint16(at + 48, attrs?.[i] ?? 0, true)
  })
  return out
}

/** VisCAM's 15-bit color: blue low, valid bit high. */
export const viscam = (r: number, g: number, b: number): number => 0x8000 | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
/** Materialise's own-color facet: red low, bit 15 clear. */
export const materialise = (r: number, g: number, b: number): number => ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3)

export function objText(points: V3[], faces: number[][], opts: { materials?: string[]; mtllib?: string; colors?: V3[]; negative?: boolean } = {}): Uint8Array {
  const out = ['# made by the sno-core tests']
  if (opts.mtllib) out.push(`mtllib ${opts.mtllib}`)
  points.forEach((p, i) => out.push(`v ${p.join(' ')}${opts.colors ? ' ' + opts.colors[i].map((c) => c / 255).join(' ') : ''}`))
  out.push('vn 0 1 0', 'vt 0 0')
  let current: string | undefined
  faces.forEach((f, i) => {
    const m = opts.materials?.[i]
    if (m && m !== current) { out.push(`usemtl ${m}`); current = m }
    const refs = f.map((v) => (opts.negative ? v - points.length : v + 1))
    out.push(`f ${refs.map((r) => `${r}/1/1`).join(' ')}`)
  })
  return enc.encode(out.join('\n') + '\n')
}

export function mtlText(materials: Record<string, V3>): Uint8Array {
  const out: string[] = []
  for (const [name, c] of Object.entries(materials)) out.push(`newmtl ${name}`, `Kd ${c.map((v) => v / 255).join(' ')}`, 'Ka 0 0 0', '')
  return enc.encode(out.join('\n'))
}

export interface GltfPrimitive {
  points: V3[]
  indices?: number[]
  /** COLOR_0 as normalized unsigned bytes, linear. */
  colors?: V3[]
  /** A material base color factor, linear. */
  baseColor?: [number, number, number, number]
  mode?: number
}

export interface GltfSpec {
  primitives: GltfPrimitive[]
  /** A node per primitive's mesh: translation, scale. */
  nodes?: Array<{ translation?: V3; scale?: V3; rotation?: [number, number, number, number] }>
  extensionsRequired?: string[]
}

/** The JSON and binary of a glTF: one mesh per primitive, one node per mesh. */
function gltfParts(spec: GltfSpec): { json: Record<string, unknown>; bin: Uint8Array } {
  const chunks: Uint8Array[] = []
  let length = 0
  const bufferViews: unknown[] = []
  const accessors: unknown[] = []
  const add = (bytes: Uint8Array, accessor: Record<string, unknown>): number => {
    const pad = (4 - (length % 4)) % 4
    if (pad) { chunks.push(new Uint8Array(pad)); length += pad }
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    chunks.push(bytes); length += bytes.length
    accessors.push({ ...accessor, bufferView: bufferViews.length - 1 })
    return accessors.length - 1
  }
  const materials: unknown[] = []
  const meshes = spec.primitives.map((p) => {
    const pos = new Float32Array(p.points.flat())
    const attributes: Record<string, number> = {
      POSITION: add(new Uint8Array(pos.buffer), { componentType: 5126, count: p.points.length, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }),
    }
    if (p.colors) attributes.COLOR_0 = add(new Uint8Array(p.colors.flat()), { componentType: 5121, normalized: true, count: p.colors.length, type: 'VEC3' })
    const prim: Record<string, unknown> = { attributes }
    if (p.indices) prim.indices = add(new Uint8Array(new Uint16Array(p.indices).buffer), { componentType: 5123, count: p.indices.length, type: 'SCALAR' })
    if (p.baseColor) { materials.push({ pbrMetallicRoughness: { baseColorFactor: p.baseColor } }); prim.material = materials.length - 1 }
    if (p.mode !== undefined) prim.mode = p.mode
    return { primitives: [prim] }
  })
  const nodes = meshes.map((_, i) => ({ mesh: i, ...(spec.nodes?.[i] ?? {}) }))
  const bin = concat(chunks)
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'sno-core tests' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, accessors, bufferViews,
    ...(materials.length ? { materials } : {}),
    buffers: [{ byteLength: bin.length }],
    ...(spec.extensionsRequired ? { extensionsRequired: spec.extensionsRequired, extensionsUsed: spec.extensionsRequired } : {}),
  }
  return { json, bin }
}

export function glb(spec: GltfSpec): Uint8Array {
  const { json, bin } = gltfParts(spec)
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = enc.encode(text)
  const binPadded = concat([bin, new Uint8Array((4 - (bin.length % 4)) % 4)])
  const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  const b = 20 + jsonBytes.length
  dv.setUint32(b, binPadded.length, true); dv.setUint32(b + 4, 0x004e4942, true)
  out.set(binPadded, b + 8)
  return out
}

/** A .gltf whose buffer is a data URI, or named `uri` (for a companion file or a URL). */
export function gltfJson(spec: GltfSpec, uri?: string): { gltf: Uint8Array; bin: Uint8Array } {
  const { json, bin } = gltfParts(spec)
  let s = ''
  for (const b of bin) s += String.fromCharCode(b)
  ;(json.buffers as Array<Record<string, unknown>>)[0].uri = uri ?? `data:application/octet-stream;base64,${btoa(s)}`
  return { gltf: enc.encode(JSON.stringify(json)), bin }
}

export interface VoxModel {
  size: V3
  /** x, y, z, color index (1..255). */
  voxels: Array<[number, number, number, number]>
}

/** A MagicaVoxel file: models, an optional palette (index 1..255 to r, g, b), and an optional translation per model. */
export function vox(models: VoxModel[], palette?: Record<number, V3>, translations?: V3[]): Uint8Array {
  const chunk = (id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): Uint8Array => {
    const head = new Uint8Array(12)
    head.set(enc.encode(id))
    const dv = new DataView(head.buffer)
    dv.setInt32(4, content.length, true); dv.setInt32(8, children.length, true)
    return concat([head, content, children])
  }
  const ints = (...n: number[]): Uint8Array => { const b = new Uint8Array(n.length * 4); const dv = new DataView(b.buffer); n.forEach((v, i) => dv.setInt32(i * 4, v, true)); return b }
  const str = (s: string): Uint8Array => concat([ints(s.length), enc.encode(s)])
  const dict = (pairs: Array<[string, string]>): Uint8Array => concat([ints(pairs.length), ...pairs.flatMap(([k, v]) => [str(k), str(v)])])
  const parts: Uint8Array[] = []
  for (const m of models) {
    parts.push(chunk('SIZE', ints(...m.size)))
    const body = new Uint8Array(4 + m.voxels.length * 4)
    new DataView(body.buffer).setInt32(0, m.voxels.length, true)
    m.voxels.forEach((v, i) => body.set(v, 4 + i * 4))
    parts.push(chunk('XYZI', body))
  }
  if (translations) {
    // Root transform 0, group 1, then a transform and a shape per model.
    const kids = models.map((_, i) => 2 + i * 2)
    parts.push(chunk('nTRN', concat([ints(0), dict([]), ints(1, -1, 0, 1), dict([])])))
    parts.push(chunk('nGRP', concat([ints(1), dict([]), ints(kids.length, ...kids)])))
    models.forEach((_, i) => {
      const t = translations[i]
      parts.push(chunk('nTRN', concat([ints(2 + i * 2), dict([]), ints(3 + i * 2, -1, 0, 1), dict([['_t', t.join(' ')]])])))
      parts.push(chunk('nSHP', concat([ints(3 + i * 2), dict([]), ints(1, i), dict([])])))
    })
  }
  if (palette) {
    const rgba = new Uint8Array(1024)
    for (const [k, c] of Object.entries(palette)) rgba.set([...c, 255], (Number(k) - 1) * 4)
    parts.push(chunk('RGBA', rgba))
  }
  const main = chunk('MAIN', new Uint8Array(0), concat(parts))
  return concat([enc.encode('VOX '), ints(150), main])
}

/**
 * A lumpy sphere with `rings` x `segments` quads, split into triangles: a
 * stand-in for a scanned model, dense enough to need simplifying. Colored by
 * height so the palette mapping has a gradient to follow.
 */
export function blob(rings: number, segments: number): { points: V3[]; colors: V3[]; tris: number[][] } {
  const points: V3[] = []
  const colors: V3[] = []
  for (let r = 0; r <= rings; r++) {
    const phi = (Math.PI * r) / rings
    for (let s = 0; s < segments; s++) {
      const theta = (2 * Math.PI * s) / segments
      const lump = 1 + 0.15 * Math.sin(5 * theta) * Math.sin(3 * phi) + 0.1 * Math.cos(7 * phi)
      points.push([lump * Math.sin(phi) * Math.cos(theta), lump * 1.3 * Math.cos(phi), lump * Math.sin(phi) * Math.sin(theta)])
      const t = r / rings
      colors.push([Math.round(255 * t), Math.round(80 + 100 * (1 - t)), Math.round(255 * (1 - t))])
    }
  }
  const at = (r: number, s: number): number => r * segments + (s % segments)
  const tris: number[][] = []
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    // Outward: seen from outside, (r,s) (r+1,s) (r+1,s+1) runs counter-clockwise.
    tris.push([at(r, s), at(r + 1, s + 1), at(r + 1, s)])
    tris.push([at(r, s), at(r, s + 1), at(r + 1, s + 1)])
  }
  return { points, colors, tris }
}
