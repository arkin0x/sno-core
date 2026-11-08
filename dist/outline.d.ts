/**
 * outline.ts - the edges of a shard's faces, each one once.
 *
 * LINES mode draws a shard as a wireframe of its faces. The edges come from
 * the faces as they were made, not from the triangles they are cut into for
 * drawing: a polygon's outline is its own edges, and the diagonals the
 * triangulation added are not part of the shape. An edge two faces share is
 * drawn once, so a closed solid costs one line per edge rather than two.
 */
/** Index pairs for every distinct edge of these faces, ready for a LineSegments index. */
export declare function faceEdges(faces: number[][]): number[];
//# sourceMappingURL=outline.d.ts.map