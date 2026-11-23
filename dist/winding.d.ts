/**
 * winding.ts - which way a face looks, as the author says.
 *
 * A face's front is the side the right-hand normal of its corners, in order,
 * points to, in the wire's frame (DECK-0003 §1.4). Zero bytes: the order of
 * three indices already on the wire. A reader obeys it; this module is how an
 * author sets it.
 *
 *   FLIP FACE     one face turned round.
 *   FLIP SURFACE  a face turned round, and every face joined to it across a
 *                 clean edge turned to agree with it, out to where the
 *                 surface ends.
 *   AUTO          the whole shard rewound by the outward guess (orient.ts).
 *   windAdded     new faces wound by the guess as they are made, unless they
 *                 join an existing surface, in which case they agree with it.
 *
 * Everything here reads points through `toRender`, the wire's frame. The
 * model frame is the wire's with Z negated, a mirror, and a face that looks
 * out in one looks in in the other.
 *
 * Pure: each returns a new shard and leaves the one it was given alone. Face
 * order never changes, so `facecolors` and any face index held elsewhere
 * (the workshop's selected face) still point at the same face.
 */
import { type ShardModel } from './shards.js';
import type { P3 } from './triangulate.js';
type Face = [number, number, number];
/** The shard's points in the wire's frame, where winding is read. */
export declare function wirePoints(s: Pick<ShardModel, 'vertices'>): P3[];
/**
 * The surface a face belongs to: it, and every face reachable from it across
 * clean edges. An edge with three or more faces on it is where solids touch
 * (orient.ts), and a surface stops there, as it stops at an open edge.
 */
export declare function surfaceOf(faces: Face[], i: number): number[];
/** FLIP FACE: one face turned round. */
export declare function flipFace(s: ShardModel, i: number): ShardModel;
/**
 * FLIP SURFACE: the face turned round, and its surface turned to agree with
 * it. A surface whose faces disagreed among themselves (a stamp's, before
 * winding was kept) comes out agreeing, all facing where the flipped face now
 * faces.
 */
export declare function flipSurface(s: ShardModel, i: number): ShardModel;
/** AUTO: every face wound by the outward guess, whatever it was. */
export declare function windOutward(s: ShardModel): ShardModel;
/**
 * The faces from index `from` on are new: wound by the outward guess, except
 * that a new face joined across a clean edge to an older one agrees with the
 * older one, which the author may have turned on purpose. The older faces
 * are never touched.
 */
export declare function windAdded(s: ShardModel, from: number): ShardModel;
export {};
//# sourceMappingURL=winding.d.ts.map