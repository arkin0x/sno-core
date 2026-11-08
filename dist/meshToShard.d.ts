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
import { type Clock, type ImportMesh } from './mesh.js';
import { type ShardModel } from './shards.js';
import { type Palette, type Rgb } from './snoPalette.js';
/**
 * The payload an import is fitted to, in bytes.
 *
 * strfry's stock event limit is 65,536 bytes, and it is the most deployed relay
 * (DECK-0003 §1.8). ONOSENDAI hides a large shard as its own event, encrypted
 * and base64'd, which costs a third again, so a payload of this size still
 * fits a stock relay as a hidden object: 47,000 x 4/3 is 62,667, leaving room
 * for the tags, the signature and the 28 bytes of nonce and tag.
 */
export declare const IMPORT_BUDGET_BYTES = 47000;
/** The most faces an import keeps. The byte budget usually binds first. */
export declare const IMPORT_MAX_FACES = 5000;
/** The color a vertex gets when its file has none: the client's own cyan. */
export declare const IMPORT_DEFAULT_COLOR: Rgb;
/** The furthest a fitted shard may reach, in ticks: the 64-unit position bound (§1.8). */
export declare const IMPORT_MAX_FIT: number;
/**
 * How large an import comes in on a grid of half-width `extent` units: its
 * largest side is half the grid's reach, in ticks, so 4 units on the default
 * grid of 8. That is the size of the largest stamps, it stands inside the
 * bench's home view on a phone, and it leaves room on the grid to move it.
 * GRID SIZE is the control: a larger grid brings a file in larger.
 */
export declare function importFitFor(extent: number): number;
export interface MeshToShardOptions {
    /** The largest side of the result, in ticks. Default: importFitFor the default grid, 4 units. */
    fit?: number;
    /** The shard's unit (§1.6). Default 0. */
    unit?: number;
    /** The palette colors snap to. Default: the built-in. */
    palette?: Palette;
    /** The color for a mesh with none, 0..1. Default IMPORT_DEFAULT_COLOR. */
    color?: Rgb;
    /** The payload budget in bytes. Default IMPORT_BUDGET_BYTES. */
    budget?: number;
    /** The most faces to keep. Default IMPORT_MAX_FACES. */
    maxFaces?: number;
    /** The shard's name. */
    name?: string;
    /** The clock the work runs against; a fresh IMPORT_TIME_MS clock by default. */
    clock?: Clock;
}
/** What an import did, for the one line that tells the person. */
export interface ImportReport {
    /** Faces in the file, after polygons were split into triangles; points for a point cloud. */
    inputCount: number;
    /** Faces (or points) in the shard. */
    count: number;
    /** True when the file has no faces and came in as points. */
    points: boolean;
    /** True when the mesh had to be simplified to fit. */
    simplified: boolean;
    /** The clustering cell, in ticks: 1 means plain quantization. */
    cell: number;
    /** The payload's size in bytes, serialized. */
    bytes: number;
    vertices: number;
    /** One short line: "Imported 12,400 faces as 1,850 (simplified to fit)". */
    summary: string;
}
export interface Converted {
    shard: ShardModel;
    report: ImportReport;
}
/** The line an import reports. */
export declare function importSummary(r: Pick<ImportReport, 'inputCount' | 'count' | 'points' | 'simplified'>): string;
/** Payload bytes, as the event's content would carry them. */
export declare function payloadBytes(s: ShardModel): number;
/**
 * The mesh as a shard, fitted to the grid and to the budget.
 *
 * Throws MeshImportError when there is nothing to make a shard of: no usable
 * vertex, a mesh whose every face is too thin to survive the lattice, or one
 * too detailed to fit the budget at any simplification.
 */
export declare function meshToShard(mesh: ImportMesh, options?: MeshToShardOptions): Converted;
//# sourceMappingURL=meshToShard.d.ts.map