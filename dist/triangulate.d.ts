/**
 * triangulate.ts — a loop of corners into triangles.
 *
 * FILL takes the corners of a face in order, any number of them, and the wire
 * form wants triangles. A fan from the first corner is right for a convex
 * loop and wrong for anything with a notch (a star, an L, an arrow), so this
 * is ear clipping: project the loop onto the plane it mostly lies in, walk it
 * removing one convex corner (an "ear") at a time that no other corner sits
 * inside, and every removed ear is a triangle. O(n^2) over loops of at most a
 * few dozen corners, which is nothing.
 *
 * Returns loop-local indices; the caller maps them to shard indices. Returns
 * null for a loop that is not a polygon: fewer than three corners, all
 * collinear, or self-crossing so that no ear can be found. A corner that lies
 * flat on the line between its neighbours (a vertex mid-edge, common on an
 * integer grid) is dropped without a triangle rather than making a sliver.
 *
 * Pure.
 */
export type P3 = [number, number, number];
/** Newell's method: the normal of a (possibly non-planar) loop, unnormalised. */
export declare function newell(points: P3[]): P3;
export declare function triangulate(points: P3[]): Array<[number, number, number]> | null;
//# sourceMappingURL=triangulate.d.ts.map