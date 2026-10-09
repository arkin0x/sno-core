/**
 * importFile.ts - a 3D file picked by a person, as a shard: the one call both
 * clients make, in a Web Worker so a large file never freezes the page.
 *
 * Formats, and why each is here:
 *
 *   PLY    required. SNO's own data model (DECK-0003 Appendix B), what scanners
 *          and MeshLab write, and what snocrash exports.
 *   STL    what 3D printing speaks; most printable models on the web are STL.
 *   OBJ    the plain-text mesh every modeling tool writes, with its MTL for
 *          colors when it is picked alongside.
 *   glTF   the modern standard (.glb, or .gltf with its .bin picked with it),
 *          and the format SNO describes itself against.
 *   VOX    MagicaVoxel: a grid and a palette, so a voxel model lands on the
 *          lattice exactly.
 *
 * Nothing more exotic: each format here is one a person is likely to have.
 *
 * A file is untrusted. The size is capped before it is read, every parser
 * checks what it is told against what is there (mesh.ts), the work runs
 * against a clock, and the answer is always either a valid shard or one
 * sentence saying why not. Nothing here fetches anything or evaluates
 * anything.
 */

import { IMPORT_MAX_FILE_BYTES, IMPORT_TIME_MS, MeshImportError, baseName, decodeText, makeClock, type Clock, type ImportMesh } from './mesh.js'
import { meshToShard, type ImportReport, type MeshToShardOptions } from './meshToShard.js'
import { looksLikeGlb, parseGltf } from './gltf.js'
import { mtlNames, parseMtl, parseObj, type Materials } from './obj.js'
import { looksLikePly, parsePly } from './ply.js'
import { isBinaryStl, looksLikeAsciiStl, parseStl } from './stl.js'
import { looksLikeVox, parseVox } from './vox.js'
import type { ShardModel } from './shards.js'

export type MeshFormat = 'ply' | 'stl' | 'obj' | 'gltf' | 'vox'

/** What a file picker should offer: the model formats, and the files that travel with them. */
export const IMPORT_ACCEPT = '.ply,.stl,.obj,.mtl,.glb,.gltf,.bin,.vox'

/** The formats, for a tooltip. */
export const IMPORT_FORMATS_LABEL = 'PLY, STL, OBJ with its MTL, glTF or GLB, MagicaVoxel VOX'

/** One file as the worker receives it. */
export interface ImportFile {
  name: string
  bytes: Uint8Array | ArrayBuffer
}

export interface ImportRequest {
  files: ImportFile[]
  /** How to fit the result: everything meshToShard takes but the clock and the name. */
  options?: Omit<MeshToShardOptions, 'clock' | 'name'>
  /** How long the whole import may take, in milliseconds. */
  timeMs?: number
}

export type ImportResponse =
  | { ok: true; shard: ShardModel; report: ImportReport; format: MeshFormat; name: string }
  | { ok: false; error: string }

const COMPANION = /\.(mtl|bin)$/i

const ext = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()

/** Which format a file is, by what it starts with first and its name second; null when it is none of them. */
export function detectFormat(name: string, bytes: Uint8Array): MeshFormat | null {
  if (looksLikeGlb(bytes)) return 'gltf'
  if (looksLikeVox(bytes)) return 'vox'
  if (looksLikePly(bytes)) return 'ply'
  switch (ext(name)) {
    case 'ply': return 'ply'
    case 'stl': return 'stl'
    case 'obj': return 'obj'
    case 'gltf': case 'glb': return 'gltf'
    case 'vox': return 'vox'
  }
  if (isBinaryStl(bytes) || looksLikeAsciiStl(bytes)) return 'stl'
  const head = decodeText(bytes.subarray(0, 512)).trimStart()
  if (head.startsWith('{')) return 'gltf'
  if (/^(#.*\n|\s)*(v|o|g|mtllib)\s/m.test(head)) return 'obj'
  return null
}

const asBytes = (b: Uint8Array | ArrayBuffer): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b))

/** The mesh in the files: the first model file, with any MTL or .bin picked beside it. */
export function readMesh(files: ImportFile[], clock: Clock): { mesh: ImportMesh; format: MeshFormat; name: string } {
  let total = 0
  for (const f of files) total += asBytes(f.bytes).length
  if (total > IMPORT_MAX_FILE_BYTES) throw new MeshImportError(`That is ${(total / 1048576).toFixed(0)} MB. Import reads files of up to ${IMPORT_MAX_FILE_BYTES / 1048576} MB.`)
  const main = files.find((f) => !COMPANION.test(f.name))
  if (!main) throw new MeshImportError(`Pick a 3D file: ${IMPORT_FORMATS_LABEL}.`)
  const bytes = asBytes(main.bytes)
  if (bytes.length === 0) throw new MeshImportError('That file is empty.')
  const format = detectFormat(main.name, bytes)
  if (!format) throw new MeshImportError(`That is not a file import reads. It reads ${IMPORT_FORMATS_LABEL}.`)
  const others = new Map<string, Uint8Array>()
  for (const f of files) if (f !== main) others.set(f.name.split(/[\\/]/).pop() ?? f.name, asBytes(f.bytes))
  let mesh: ImportMesh
  switch (format) {
    case 'ply': mesh = parsePly(bytes, clock); break
    case 'stl': mesh = parseStl(bytes, clock); break
    case 'vox': mesh = parseVox(bytes, clock); break
    case 'gltf': mesh = parseGltf(bytes, clock, others); break
    case 'obj': {
      // The MTL the OBJ names, if it was picked; else any MTL that was.
      const named = mtlNames(decodeText(bytes.subarray(0, Math.min(bytes.length, 1 << 20))))
      const mtl = named.map((n) => others.get(n.split(/[\\/]/).pop() ?? n)).find((b) => !!b)
        ?? [...others.entries()].find(([n]) => /\.mtl$/i.test(n))?.[1]
      const materials: Materials = mtl ? parseMtl(decodeText(mtl)) : new Map()
      mesh = parseObj(bytes, clock, materials)
      break
    }
  }
  return { mesh, format, name: baseName(main.name) }
}

/**
 * The files as a shard, or why not. Never throws: anything a parser did not
 * anticipate is still answered with a sentence, not an exception, because
 * the caller is a worker whose only way to report is a message.
 */
export function importMesh(request: ImportRequest): ImportResponse {
  try {
    const clock = makeClock(request.timeMs ?? IMPORT_TIME_MS)
    const { mesh, format, name } = readMesh(request.files, clock)
    const { shard, report } = meshToShard(mesh, { ...request.options, name, clock })
    return { ok: true, shard, report, format, name }
  } catch (e) {
    if (e instanceof MeshImportError) return { ok: false, error: e.message }
    if (e instanceof RangeError) return { ok: false, error: 'That file is too large to read in this browser.' }
    return { ok: false, error: 'That file could not be read. It may be damaged, or in a variant of its format import does not know.' }
  }
}
