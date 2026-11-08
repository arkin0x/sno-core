/**
 * orient.ts - the guess at which way each face looks out.
 *
 * Winding is a face's front (DECK-0003 §1.4, since 2026-09-24): the side the
 * right-hand normal of its corners, in order, points to. A reader obeys it and
 * never guesses. The guess lives here for the author's side only: new faces
 * are wound by it as they are made, and AUTO rewinds a whole shard by it
 * (winding.ts). Stamps compile with half a block's triangles wound inward,
 * and hand-picked corners and FILL wind whichever way the taps went, so
 * without it every new face would be a coin toss.
 *
 * This pass rewinds a copy; the faces it is given are untouched.
 *
 * The faces fall into solids first: faces reachable from each other across
 * shared edges, of any count. Each solid is wound on its own, by its own
 * geometry, so two solids pushed through each other (XOR's stella octangula)
 * never vote on each other (arkinox, 2026-10-12).
 *
 * Within a solid, faces that share a clean edge (one with exactly two faces on
 * it) are made to agree, since a shared edge runs opposite ways in two
 * consistently wound faces; that groups the faces into patches. A closed
 * solid, every edge clean, is one patch, and its signed volume decides it:
 * positive when the faces look out. Any other patch is turned as a whole by
 * what its faces can see: a ray from a face's middle along its normal crosses
 * the rest of its solid an even number of times when the normal points out
 * and an odd number when it points in. The patch goes the way most of its
 * area votes. A patch whose rays cross nothing (a flat plate, an open shell)
 * faces up, or along +X or +Z when it stands more that way.
 *
 * The points must be in the wire's frame (shards.ts toRender), because that
 * is the frame the format's winding rule is stated in (DECK-0003 §1.4): the
 * client's model frame is the wire's with Z negated, a mirror, and a face
 * wound outward in one is wound inward in the other.
 *
 * Edges with three or more faces on them do not carry agreement across. They
 * are where solids touch: a block built on a block leaves the square between
 * them inside the join, with the lower block's top, the upper block's sides
 * and the lower block's sides all meeting on its edges. Passing agreement
 * through such an edge is what used to turn a whole side of a shape inward,
 * depending on which face the walk happened to reach first. Degenerate faces
 * (a repeated corner, or corners on a line) are left as they came.
 *
 * This pass says nothing about which faces to draw. It once also reported
 * the faces "inside a join" (rays from the face's middle crossing an odd
 * number of faces both ways), and both clients' benches left those out. The
 * count is a fact about closed solids only, and a shard is rarely one: an
 * open wall, two faces on one spot, or one solid standing in front of
 * another flips it. In arkinox's "Stair run" (2026-10-23) the lower triangle
 * of each low riser has its middle below the step in front, so its ray left
 * through that step's front: one crossing out, odd crossings back, "inside",
 * and undrawn, while the riser's other triangle drew. The bench showed every
 * such stair with one triangle of a quad missing and the dark backs behind
 * it, and a face FILLed there was added but never drawn. 18 of its 72 faces
 * were dropped this way (8 of them in plain view from the front), 63 of 883
 * across his published shards and 4465 of 56251 in the Maze Kit, where 1994
 * of the 2225 in its smaller pieces can be seen from outside. A reader draws
 * every face (DECK-0003 §1.4), so the report is gone, and with it a pass of
 * rays from every face against every face on each FILL and each bench draw.
 */
import { type P3 } from './triangulate.js';
type Face = [number, number, number];
export interface Oriented {
    /** The faces, rewound: every one of them, in the order given. */
    faces: Face[];
}
export declare function orientShard(points: P3[], faces: Face[]): Oriented;
/** The faces rewound outward; see orientShard. */
export declare function orientFaces(points: P3[], faces: Face[]): Face[];
export {};
//# sourceMappingURL=orient.d.ts.map