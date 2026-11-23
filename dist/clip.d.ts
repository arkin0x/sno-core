/**
 * clip.ts — a shard cropped to the region it is encrypted to.
 *
 * A shard hidden at height h is sealed to one aligned cube of side 2^h. If
 * the shape is larger than that cube, the part outside it is simply not
 * drawn: the region is the thing the key opens, and what the key opens ends
 * at the region's walls. A region is an axis-aligned box, so this is exact
 * plane clipping against its six faces rather than a general boolean, which
 * gives the same result as intersecting with the box and needs no library.
 * Colors interpolate along a cut edge, so a cut face keeps its gradient.
 *
 * Everything here is in the mesh's own render frame: model units, after the
 * z flip toRender applies, before the group scale. regionBox puts a cyberspace
 * region into that frame.
 */
export interface Box {
    min: [number, number, number];
    max: [number, number, number];
}
export interface Mesh {
    positions: Float32Array;
    colors: Float32Array;
    index: number[];
}
/**
 * Every triangle of a mesh clipped to a box. The triangles that survive are
 * fanned from their clipped polygons; vertices are emitted per polygon, since
 * a cut vertex belongs to one face. Vertices no triangle uses are dropped.
 */
export declare function clipMesh(mesh: Mesh, box: Box): Mesh;
/** The points of a mesh that lie inside a box, walls included. */
export declare function clipPoints(positions: Float32Array, colors: Float32Array, box: Box): {
    positions: Float32Array;
    colors: Float32Array;
};
/** Whether a box already contains the whole of a mesh's bounds, so no clip is needed. */
export declare function boxContains(box: Box, positions: Float32Array): boolean;
//# sourceMappingURL=clip.d.ts.map