/**
 * ply.ts - reading a PLY file into a mesh.
 *
 * PLY is the format whose data model already is SNO's (DECK-0003 Appendix B):
 * vertices with a color each and faces indexing them. It is what scanners,
 * MeshLab and Blender write, and what snocrash exports, so it is the import
 * that has to be right.
 *
 * Read here: ASCII, binary little endian and binary big endian; any element
 * order; `vertex` with x, y, z and a color as red, green, blue (or r, g, b, or
 * diffuse_red ...) in any numeric type; `face` with `vertex_indices` (or
 * `vertex_index`) as a list, and a color of its own if it has one. Polygons
 * are split into triangles in their own winding. Every other element (edges,
 * materials, anything) is read past and ignored. A file with vertices and no
 * faces is a point cloud.
 *
 * PLY has no up axis. Scanned PLYs (the Stanford models) and MeshLab are Y up,
 * which is SNO's, so that is what is assumed; a model that lies on its back
 * stands up with a quarter turn in the workshop.
 */

import {
  IMPORT_MAX_CORNERS, MeshImportError, PolygonBuilder, checkVertexCount, finishMesh, normalizeColorScale,
  type Clock, type ImportMesh,
} from './mesh.js'

type Scalar = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64'

const TYPES: Record<string, Scalar> = {
  char: 'int8', int8: 'int8', uchar: 'uint8', uint8: 'uint8',
  short: 'int16', int16: 'int16', ushort: 'uint16', uint16: 'uint16',
  int: 'int32', int32: 'int32', uint: 'uint32', uint32: 'uint32',
  float: 'float32', float32: 'float32', double: 'float64', float64: 'float64',
}
const SIZE: Record<Scalar, number> = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8 }
/** What a color channel of this type reads as at full strength. Floats are 0..1. */
const FULL: Record<Scalar, number> = { int8: 127, uint8: 255, int16: 32767, uint16: 65535, int32: 2147483647, uint32: 4294967295, float32: 1, float64: 1 }

interface Property {
  name: string
  type: Scalar
  /** For a list: the type of its count. */
  count?: Scalar
}

interface Element {
  name: string
  count: number
  props: Property[]
}

type Format = 'ascii' | 'binary_little_endian' | 'binary_big_endian'

const HEADER_MAX = 64 * 1024

/** Where the header ends, and what it says. */
function readHeader(bytes: Uint8Array): { format: Format; elements: Element[]; body: number } {
  const limit = Math.min(bytes.length, HEADER_MAX)
  let text = ''
  for (let i = 0; i < limit; i++) text += String.fromCharCode(bytes[i])
  const m = /(^|\n)end_header[ \t]*\r?\n/.exec(text)
  if (!m) throw new MeshImportError(bytes.length > HEADER_MAX ? 'That PLY has no end to its header.' : 'That PLY file ends before its header does.')
  const body = m.index + m[0].length
  const lines = text.slice(0, m.index).split(/\r?\n/)
  if (lines[0]?.trim() !== 'ply') throw new MeshImportError('That is not a PLY file: it does not start with "ply".')
  let format: Format | null = null
  const elements: Element[] = []
  for (const raw of lines.slice(1)) {
    const w = raw.trim().split(/\s+/)
    if (w[0] === 'format') {
      if (w[1] !== 'ascii' && w[1] !== 'binary_little_endian' && w[1] !== 'binary_big_endian') throw new MeshImportError(`That PLY is in a format this cannot read: ${w[1] ?? 'none'}.`)
      format = w[1]
    } else if (w[0] === 'element') {
      const count = Number(w[2])
      if (!w[1] || !/^\d+$/.test(w[2] ?? '')) throw new MeshImportError('That PLY has an element with no count.')
      if (!Number.isSafeInteger(count)) throw new MeshImportError(`That PLY declares ${w[2]} ${w[1]}s, which is not a count.`)
      elements.push({ name: w[1], count, props: [] })
    } else if (w[0] === 'property') {
      const el = elements[elements.length - 1]
      if (!el) throw new MeshImportError('That PLY has a property before any element.')
      if (w[1] === 'list') {
        const count = TYPES[w[2]], type = TYPES[w[3]]
        if (!count || !type || !w[4]) throw new MeshImportError(`That PLY has a list property this cannot read: ${raw.trim()}.`)
        if (count === 'float32' || count === 'float64') throw new MeshImportError('That PLY counts a list with a float.')
        el.props.push({ name: w[4], type, count })
      } else {
        const type = TYPES[w[1]]
        if (!type || !w[2]) throw new MeshImportError(`That PLY has a property this cannot read: ${raw.trim()}.`)
        el.props.push({ name: w[2], type })
      }
    }
    // comment, obj_info and anything else: ignored.
  }
  if (!format) throw new MeshImportError('That PLY does not say whether it is ASCII or binary.')
  return { format, elements, body }
}

const COLOR_NAMES: Array<[string, string, string]> = [['red', 'green', 'blue'], ['r', 'g', 'b'], ['diffuse_red', 'diffuse_green', 'diffuse_blue']]

/** Where an element's position and color live, by property index. */
function layout(el: Element): { xyz: number[]; rgb: number[] | null } {
  const at = (n: string): number => el.props.findIndex((p) => p.name === n && !p.count)
  const xyz = ['x', 'y', 'z'].map(at)
  let rgb: number[] | null = null
  for (const names of COLOR_NAMES) {
    const idx = names.map(at)
    if (idx.every((i) => i >= 0)) { rgb = idx; break }
  }
  return { xyz, rgb }
}

/** A stream of values from the body, whichever encoding it is in. */
interface Reader {
  /** The next scalar of `type`. */
  next(type: Scalar): number
  /** Bytes or tokens left, for checking a declared count against what is there. */
  left(): number
  /** Where the reader stands in the file. */
  at(): number
}

function binaryReader(bytes: Uint8Array, start: number, little: boolean): Reader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = start
  const truncated = (): never => { throw new MeshImportError('That PLY file is cut short: it ends before the data its header promises.') }
  return {
    next(type) {
      const size = SIZE[type]
      if (at + size > bytes.length) truncated()
      let v: number
      switch (type) {
        case 'int8': v = view.getInt8(at); break
        case 'uint8': v = view.getUint8(at); break
        case 'int16': v = view.getInt16(at, little); break
        case 'uint16': v = view.getUint16(at, little); break
        case 'int32': v = view.getInt32(at, little); break
        case 'uint32': v = view.getUint32(at, little); break
        case 'float32': v = view.getFloat32(at, little); break
        default: v = view.getFloat64(at, little)
      }
      at += size
      return v
    },
    left: () => bytes.length - at,
    at: () => at,
  }
}

function asciiReader(bytes: Uint8Array, start: number): Reader {
  let at = start
  const n = bytes.length
  return {
    next(type) {
      // Skip whitespace, then read one token. Byte by byte, so a 50 MB body is
      // never turned into one giant string.
      while (at < n && bytes[at] <= 32) at++
      if (at >= n) throw new MeshImportError('That PLY file is cut short: it ends before the data its header promises.')
      let s = ''
      while (at < n && bytes[at] > 32) { s += String.fromCharCode(bytes[at]); at++; if (s.length > 64) throw new MeshImportError('That PLY has a value that is not a number.') }
      const v = Number(s)
      if (Number.isNaN(v) && !/^[+-]?nan$/i.test(s)) throw new MeshImportError(`That PLY has a value that is not a number: "${s.slice(0, 24)}".`)
      return type === 'float32' || type === 'float64' ? v : Math.trunc(v)
    },
    left: () => n - at,
    at: () => at,
  }
}

/** The fewest bytes one instance of an element can take, to check a declared count against the file. */
function minBytes(el: Element, format: Format): number {
  if (format === 'ascii') return el.props.length * 2 // one digit and one space each
  return el.props.reduce((t, p) => t + SIZE[p.count ?? p.type], 0)
}

/** A PLY file as a mesh. Throws MeshImportError on anything it cannot read. */
export function parsePly(bytes: Uint8Array, clock: Clock): ImportMesh {
  const { format, elements, body } = readHeader(bytes)
  const vertexEl = elements.find((e) => e.name === 'vertex')
  if (!vertexEl) throw new MeshImportError('That PLY has no vertices.')
  checkVertexCount(vertexEl.count)
  const { xyz, rgb } = layout(vertexEl)
  if (xyz.some((i) => i < 0)) throw new MeshImportError('That PLY\'s vertices have no x, y and z.')

  // Every declared count against what the file can actually hold, before
  // anything is allocated from it: a header that claims four billion faces in
  // a 1 KB file is refused here rather than believed.
  let need = 0
  for (const el of elements) need += el.count * minBytes(el, format)
  if (need > bytes.length - body) throw new MeshImportError('That PLY file is cut short: its header promises more data than the file holds.')

  const reader = format === 'ascii' ? asciiReader(bytes, body) : binaryReader(bytes, body, format === 'binary_little_endian')
  const positions = new Float64Array(vertexEl.count * 3)
  const colors = rgb ? new Float32Array(vertexEl.count * 3) : null
  const polygons = new PolygonBuilder()
  let floatFaceColors = false

  for (const el of elements) {
    if (el.name === 'vertex') {
      const vals = new Array<number>(el.props.length)
      for (let i = 0; i < el.count; i++) {
        clock()
        for (let k = 0; k < el.props.length; k++) {
          const p = el.props[k]
          if (p.count) { skipList(reader, p); vals[k] = 0 } else vals[k] = reader.next(p.type)
        }
        positions[i * 3] = vals[xyz[0]]; positions[i * 3 + 1] = vals[xyz[1]]; positions[i * 3 + 2] = vals[xyz[2]]
        if (colors && rgb) for (let c = 0; c < 3; c++) colors[i * 3 + c] = vals[rgb[c]] / FULL[el.props[rgb[c]].type]
      }
    } else if (el.name === 'face') {
      const list = el.props.findIndex((p) => !!p.count && (p.name === 'vertex_indices' || p.name === 'vertex_index'))
      const { rgb: frgb } = layout(el)
      const corners: number[] = []
      const color = [0, 0, 0]
      for (let i = 0; i < el.count; i++) {
        clock()
        corners.length = 0
        for (let k = 0; k < el.props.length; k++) {
          const p = el.props[k]
          if (p.count) {
            const n = reader.next(p.count)
            if (n < 0 || n > IMPORT_MAX_CORNERS) throw new MeshImportError(`That PLY has a face with ${n} corners. Import reads faces of up to ${IMPORT_MAX_CORNERS}.`)
            for (let j = 0; j < n; j++) {
              const v = reader.next(p.type)
              if (k === list) {
                if (!Number.isInteger(v) || v < 0) throw new MeshImportError(`A face in that PLY points at vertex ${v}, which cannot exist.`)
                corners.push(v)
              }
            }
          } else {
            const v = reader.next(p.type)
            if (frgb) { const c = frgb.indexOf(k); if (c >= 0) color[c] = v / FULL[p.type] }
          }
        }
        if (list >= 0) polygons.add(corners, frgb ? color : null)
      }
      if (frgb && el.props[frgb[0]].type.startsWith('float')) floatFaceColors = true
    } else {
      for (let i = 0; i < el.count; i++) {
        clock()
        for (const p of el.props) { if (p.count) skipList(reader, p); else reader.next(p.type) }
      }
    }
  }

  // Every element read, the body should be used up. A header whose counts
  // are wrong usually still parses, into garbage, because binary data is only
  // bytes; what gives it away is data left over (or running out, above).
  // Whitespace after the last element is a writer's habit, not a lie.
  for (let i = reader.at(); i < bytes.length; i++) {
    const b = bytes[i]
    if (b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0x00) {
      throw new MeshImportError('That PLY has more data than its header accounts for: its counts are wrong.')
    }
  }

  // Float colors are meant to be 0..1; some writers put bytes in them.
  if (colors && rgb && vertexEl.props[rgb[0]].type.startsWith('float')) normalizeColorScale(colors)
  const polys = polygons.done()
  if (floatFaceColors && polys.colors) normalizeColorScale(polys.colors)
  return finishMesh({ positions, ...(colors ? { colors } : {}), polygons: polys, up: 'y', clock })
}

function skipList(reader: Reader, p: Property): void {
  const n = reader.next(p.count as Scalar)
  if (n < 0 || n > reader.left()) throw new MeshImportError('That PLY file is cut short: a list runs past its end.')
  for (let j = 0; j < n; j++) reader.next(p.type)
}

/** Whether these bytes start like a PLY file. */
export function looksLikePly(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79 && (bytes[3] === 0x0a || bytes[3] === 0x0d)
}
