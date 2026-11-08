/**
 * stamps.ts — shapes you place with one tap.
 *
 * A stamp is a small parametric shape on the integer grid: a block, a wedge,
 * a pyramid, a column, a ring, a star, an arrow. Each compiles to plain
 * vertices and triangles in the shard's own wire form, so a stamped shard is
 * exactly as portable as a hand-built one and the world needs to know nothing
 * about stamps. SIZE scales a shape in whole units (1 to 4); FACING turns the
 * asymmetric ones (wedge, star, arrow) a quarter turn at a time about Y.
 *
 * A stamp brings its own vertices even where the shard already has one on
 * that point. That is deliberate: colors live on vertices, so sharing a
 * corner between a red block and a blue block would blend the seam, and a
 * seam is where you want the edge crisp. What sharing would have saved is
 * budget, so the two triangles that face each other where two stamps touch
 * are dropped instead: a hidden wall costs nothing. For that to work every
 * box splits each face on the same diagonal, so two boxes meeting face to
 * face produce triangles with identical corners that the cull can match.
 *
 * Pure: a stamp is a function of (kind, size, facing) and where you put it.
 */
import { type ShardModel } from './shards.js';
import { type P3 } from './triangulate.js';
export type StampKind = 'block' | 'wedge' | 'pyramid' | 'column' | 'ring' | 'star' | 'arrow';
export declare const STAMPS: StampKind[];
/** Quarter turns about Y: 0 faces +X, 1 faces +Z, 2 faces −X, 3 faces −Z. */
export type Facing = 0 | 1 | 2 | 3;
export declare const FACING_LABEL: Record<Facing, string>;
/** The stamps a quarter turn changes. The rest look the same from every side. */
export declare const FACED: Record<StampKind, boolean>;
export declare const MIN_SIZE = 1;
export declare const MAX_SIZE = 4;
/** One-line descriptions for the shape picker. */
export declare const STAMP_HELP: Record<StampKind, string>;
export interface Shape {
    points: P3[];
    faces: Array<[number, number, number]>;
}
/**
 * The working grid's normal axis: 1 is the floor (the XZ plane, up is +Y),
 * 0 stands the grid on its side facing +X (the YZ plane), 2 stands it up
 * facing +Z (the XY plane). Shapes are authored with up along +Y; on another
 * plane they turn so up follows the normal, by a proper rotation (no mirror):
 * a quarter about Z for plane 0, a quarter about X for plane 2.
 */
export type WorkPlane = 0 | 1 | 2;
export declare const FLOOR: WorkPlane;
export declare function onPlane(points: P3[], plane: WorkPlane): P3[];
/**
 * The shape as it lands: turned to FACING, moved to the tap, and pushed back
 * inside the grid if any of it would poke out. Nothing here is wider than
 * the grid, so the push always succeeds.
 */
export declare function compile(kind: StampKind, size: number, facing: Facing, origin: P3, extent?: number, plane?: WorkPlane): Shape;
/** Where a stamp aimed at `origin` lands: `origin` itself unless the grid's edge pushed it back. */
export declare function landing(kind: StampKind, size: number, facing: Facing, origin: P3, extent?: number, plane?: WorkPlane): P3;
export interface Stamped {
    shard: ShardModel;
    /** Triangles dropped because they faced an existing one across a shared wall (both sides counted). */
    culled: number;
}
/**
 * The shard with the stamp added, or null when it would not fit the budget.
 * The stamp's own vertices are appended (never merged, see the header), its
 * triangles are re-indexed, and any triangle that exactly matches an existing
 * one corner for corner is dropped along with the one it matched.
 */
export declare function stamp(shard: ShardModel, kind: StampKind, size: number, facing: Facing, origin: P3, color: [number, number, number], plane?: WorkPlane): Stamped | null;
/**
 * The stamp on its own at the origin: what the aim ghost draws, placed at
 * `landing`. It depends on the shape and color only, never on the aim, so the
 * ghost's geometry is built once per shape and merely moved as the pointer
 * crosses cells; building it afresh per cell was the ghost's whole cost.
 */
export declare function preview(kind: StampKind, size: number, facing: Facing, color: [number, number, number], plane?: WorkPlane): ShardModel;
//# sourceMappingURL=stamps.d.ts.map