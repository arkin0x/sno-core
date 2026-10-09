/**
 * stl.ts - reading an STL file into a mesh.
 *
 * STL is what 3D printing speaks: a soup of triangles, each with its own
 * three corners, so neighbors share positions but not vertices. That is fine
 * here, because the converter welds on the lattice anyway (meshToShard.ts).
 *
 * Binary and ASCII are both read. Telling them apart by the word "solid" at
 * the start does not work, because many binary writers put "solid" in their
 * 80-byte header; a binary file is recognized instead by its size, which is
 * exactly 84 bytes plus 50 per triangle.
 *
 * STL has no color, and two vendors filled the hole incompatibly (DECK-0003
 * Appendix B.3). Both are read, as the brief for this format asks:
 *
 *   - VisCAM and SolidView: a triangle's two attribute bytes hold a 15-bit
 *     color, blue in the low five bits, valid when bit 15 is set.
 *   - Materialise Magics: "COLOR=" and four bytes in the header give the
 *     part's color, and a triangle with bit 15 clear has its own, red in the
 *     low five bits.
 *
 * STL is Z up by long habit (slicers, Thingiverse, Blender's exporter), so
 * that is what is assumed.
 */

import { IMPORT_MAX_TRIANGLES, MeshImportError, PolygonBuilder, decodeText, finishMesh, grow64, type Clock, type ImportMesh } from './mesh.js'

/** Whether these bytes are a binary STL: 84 bytes of header and count, then exactly 50 per triangle. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
  return 84 + count * 50 === bytes.length
}

/** Whether these bytes start like an ASCII STL. */
export function looksLikeAsciiStl(bytes: Uint8Array): boolean {
  let i = 0
  while (i < bytes.length && i < 256 && bytes[i] <= 32) i++
  return bytes.length - i >= 5 && String.fromCharCode(...bytes.subarray(i, i + 5)).toLowerCase() === 'solid'
}

/** An STL file as a mesh. Throws MeshImportError on anything it cannot read. */
export function parseStl(bytes: Uint8Array, clock: Clock): ImportMesh {
  if (isBinaryStl(bytes)) return parseBinary(bytes, clock)
  if (looksLikeAsciiStl(bytes) && !hasBinaryBytes(bytes)) return parseAscii(bytes, clock)
  if (bytes.length >= 84) {
    // A binary header whose count disagrees with the file's size.
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    if (84 + count * 50 > bytes.length) throw new MeshImportError('That STL file is cut short: it holds fewer triangles than its header says.')
    // Longer than its count needs: some writers pad the end. The count wins.
    return parseBinary(bytes, clock, count)
  }
  throw new MeshImportError('That is not an STL file.')
}

function hasBinaryBytes(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  for (let i = 0; i < n; i++) { if (bytes[i] < 9) return true }
  return false
}

function parseBinary(bytes: Uint8Array, clock: Clock, declared?: number): ImportMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = declared ?? view.getUint32(80, true)
  if (count > IMPORT_MAX_TRIANGLES) throw new MeshImportError(`That STL has ${count.toLocaleString('en-US')} triangles. Import reads up to ${IMPORT_MAX_TRIANGLES.toLocaleString('en-US')}.`)
  if (count === 0) throw new MeshImportError('That STL has no triangles.')

  // Materialise: "COLOR=" and r, g, b, a somewhere in the 80-byte header.
  let partColor: [number, number, number] | null = null
  let materialise = false
  for (let i = 0; i + 10 <= 80; i++) {
    if (bytes[i] === 0x43 && String.fromCharCode(...bytes.subarray(i, i + 6)) === 'COLOR=') {
      materialise = true
      partColor = [bytes[i + 6] / 255, bytes[i + 7] / 255, bytes[i + 8] / 255]
      break
    }
  }

  const positions = new Float64Array(count * 9)
  const polygons = new PolygonBuilder()
  const tri = [0, 0, 0]
  const color = [0, 0, 0]
  for (let t = 0; t < count; t++) {
    clock()
    const at = 84 + t * 50
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(at + 12 + k * 4, true)
    const attr = view.getUint16(at + 48, true)
    const five = (shift: number): number => ((attr >> shift) & 31) / 31
    let has = false
    if (materialise) {
      if (attr & 0x8000) { if (partColor) { color[0] = partColor[0]; color[1] = partColor[1]; color[2] = partColor[2]; has = true } }
      else { color[0] = five(0); color[1] = five(5); color[2] = five(10); has = true }
    } else if (attr & 0x8000) {
      color[0] = five(10); color[1] = five(5); color[2] = five(0); has = true
    }
    tri[0] = t * 3; tri[1] = t * 3 + 1; tri[2] = t * 3 + 2
    // A triangle with no color of its own among colored ones is left for the
    // converter to paint from its corners (PolygonBuilder marks it).
    polygons.add(tri, has ? color : null)
  }
  return finishMesh({ positions, polygons: polygons.done(), up: 'z', clock })
}

function parseAscii(bytes: Uint8Array, clock: Clock): ImportMesh {
  const text = decodeText(bytes)
  const positions = grow64()
  const polygons = new PolygonBuilder()
  const loop: number[] = []
  const word = /\S+/g
  let inLoop = false
  let m: RegExpExecArray | null
  const number = (): number => {
    const t = word.exec(text)
    if (!t) throw new MeshImportError('That STL file is cut short: a vertex has fewer than three coordinates.')
    const v = Number(t[0])
    if (Number.isNaN(v) && !/^[+-]?nan$/i.test(t[0])) throw new MeshImportError(`That STL has a coordinate that is not a number: "${t[0].slice(0, 24)}".`)
    return v
  }
  while ((m = word.exec(text))) {
    clock()
    const w = m[0].toLowerCase()
    if (w === 'outer') { inLoop = true; loop.length = 0 }
    else if (w === 'vertex') {
      if (!inLoop) throw new MeshImportError('That STL has a vertex outside a loop.')
      const index = positions.length / 3
      positions.push(number()); positions.push(number()); positions.push(number())
      if (positions.length / 3 > IMPORT_MAX_TRIANGLES * 3) throw new MeshImportError('That STL has too many vertices to import.')
      loop.push(index)
    } else if (w === 'endloop') {
      inLoop = false
      polygons.add(loop)
    } else if (w === 'solid' || w === 'endsolid') {
      // The rest of the line is a name: skip it, so a name like "vertex" is not read as one.
      const eol = text.indexOf('\n', word.lastIndex)
      word.lastIndex = eol < 0 ? text.length : eol + 1
    }
  }
  if (polygons.count === 0) throw new MeshImportError('That STL has no triangles.')
  return finishMesh({ positions: positions.done(), polygons: polygons.done(), up: 'z', clock })
}
