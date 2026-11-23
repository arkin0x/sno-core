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
/** The largest file an import reads. */
export declare const IMPORT_MAX_FILE_BYTES: number;
/** The most vertices a file may declare or hold. */
export declare const IMPORT_MAX_VERTICES = 4000000;
/** The most triangles a file may hold, after its polygons are split. */
export declare const IMPORT_MAX_TRIANGLES = 4000000;
/** The most corners one polygon may have. */
export declare const IMPORT_MAX_CORNERS = 1024;
/** How long reading and converting one file may take. */
export declare const IMPORT_TIME_MS = 30000;
/** A file that cannot be imported, with a message meant for the person who chose it. */
export declare class MeshImportError extends Error {
    constructor(message: string);
}
/** Which axis a file treats as up. SNO is Y up (DECK-0003 §2). */
export type Up = 'y' | 'z';
/**
 * A mesh as read from a file, in the file's own units and frame.
 *
 * Colors are sRGB, 0..1. Triangles are wound as the file wound them, which is
 * the front in every format read here (counter-clockwise seen from the front),
 * the same convention SNO uses, so nothing turns a face round on the way in.
 */
export interface ImportMesh {
    /** x, y, z per vertex. */
    positions: Float64Array;
    /** r, g, b per vertex, when the file has vertex colors. */
    colors?: Float32Array;
    /** Three vertex indices per triangle. Empty for a point cloud. */
    triangles: Uint32Array;
    /** r, g, b per triangle, when the file colors its faces. */
    triangleColors?: Float32Array;
    /** Which way is up in the file. */
    up: Up;
    /** Positions are whole numbers on a voxel lattice (MagicaVoxel), and should land on the SNO lattice exactly. */
    lattice?: boolean;
}
/** A checkpoint to call inside every loop: it throws once the time is up. */
export type Clock = () => void;
/**
 * A clock that runs out after `ms`. Called every iteration, it looks at the
 * time only every 16,384 calls, so it costs nothing in a tight loop.
 */
export declare function makeClock(ms?: number): Clock;
type Typed = Float64Array | Float32Array | Uint32Array;
/** A typed array that grows as it is filled, for formats that do not say how much is coming. */
export declare class Grow<A extends Typed> {
    private readonly make;
    data: A;
    length: number;
    constructor(make: (n: number) => A, initial?: number);
    push(v: number): void;
    /** Exactly what was pushed, in an array of its own. */
    done(): A;
}
export declare const grow64: () => Grow<Float64Array>;
export declare const grow32: () => Grow<Float32Array>;
export declare const growU32: () => Grow<Uint32Array>;
/** Refuses a declared vertex count before anything is allocated from it. */
export declare function checkVertexCount(n: number): void;
/** Refuses a triangle count over the cap. */
export declare function checkTriangleCount(n: number): void;
/**
 * Polygons as a file lists them: a flat run of corner indices, and how many
 * corners each polygon takes from it.
 */
export interface Polygons {
    corners: Uint32Array;
    counts: Uint32Array;
    /** r, g, b per polygon, when the file colors its faces. */
    colors?: Float32Array;
}
/** Collects polygons as a parser reads them, and refuses one that is too big or too many. */
export declare class PolygonBuilder {
    readonly corners: Grow<Uint32Array<ArrayBufferLike>>;
    readonly counts: Grow<Uint32Array<ArrayBufferLike>>;
    colors: Grow<Float32Array> | null;
    /** Triangles these polygons will become, to cap before splitting them. */
    private triangles;
    add(corners: ArrayLike<number>, color?: ArrayLike<number> | null): void;
    get count(): number;
    done(): Polygons;
}
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
export declare function finishMesh(input: {
    positions: Float64Array;
    colors?: Float32Array;
    polygons: Polygons;
    up: Up;
    lattice?: boolean;
    clock: Clock;
}): ImportMesh;
/**
 * Colors that may be bytes written as floats: some writers put 0..255 where
 * 0..1 belongs. If any channel is over 1, the whole set is read as bytes.
 * NaN (no color) is left alone.
 */
export declare function normalizeColorScale(c: Float32Array): void;
/** UTF-8 text, for the text formats. Invalid bytes become U+FFFD rather than an exception. */
export declare function decodeText(bytes: Uint8Array): string;
/** A file's name without its folder or extension, as a shard name. */
export declare function baseName(name: string): string;
export {};
//# sourceMappingURL=mesh.d.ts.map