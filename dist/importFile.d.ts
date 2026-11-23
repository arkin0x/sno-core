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
import { type Clock, type ImportMesh } from './mesh.js';
import { type ImportReport, type MeshToShardOptions } from './meshToShard.js';
import type { ShardModel } from './shards.js';
export type MeshFormat = 'ply' | 'stl' | 'obj' | 'gltf' | 'vox';
/** What a file picker should offer: the model formats, and the files that travel with them. */
export declare const IMPORT_ACCEPT = ".ply,.stl,.obj,.mtl,.glb,.gltf,.bin,.vox";
/** The formats, for a tooltip. */
export declare const IMPORT_FORMATS_LABEL = "PLY, STL, OBJ with its MTL, glTF or GLB, MagicaVoxel VOX";
/** One file as the worker receives it. */
export interface ImportFile {
    name: string;
    bytes: Uint8Array | ArrayBuffer;
}
export interface ImportRequest {
    files: ImportFile[];
    /** How to fit the result: everything meshToShard takes but the clock and the name. */
    options?: Omit<MeshToShardOptions, 'clock' | 'name'>;
    /** How long the whole import may take, in milliseconds. */
    timeMs?: number;
}
export type ImportResponse = {
    ok: true;
    shard: ShardModel;
    report: ImportReport;
    format: MeshFormat;
    name: string;
} | {
    ok: false;
    error: string;
};
/** Which format a file is, by what it starts with first and its name second; null when it is none of them. */
export declare function detectFormat(name: string, bytes: Uint8Array): MeshFormat | null;
/** The mesh in the files: the first model file, with any MTL or .bin picked beside it. */
export declare function readMesh(files: ImportFile[], clock: Clock): {
    mesh: ImportMesh;
    format: MeshFormat;
    name: string;
};
/**
 * The files as a shard, or why not. Never throws: anything a parser did not
 * anticipate is still answered with a sentence, not an exception, because
 * the caller is a worker whose only way to report is a message.
 */
export declare function importMesh(request: ImportRequest): ImportResponse;
//# sourceMappingURL=importFile.d.ts.map