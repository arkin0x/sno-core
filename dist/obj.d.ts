/**
 * obj.ts - reading a Wavefront OBJ file, and its MTL, into a mesh.
 *
 * OBJ is the plain-text mesh every modeling tool writes. What is read:
 *
 *   - `v x y z`, and `v x y z r g b`, the vertex color extension that
 *     MeshLab, ZBrush and Blender write;
 *   - `f` with any of the `v`, `v/vt`, `v//vn` and `v/vt/vn` forms, counting
 *     from 1 or, negative, back from the latest vertex; polygons are split
 *     into triangles in their own winding;
 *   - `usemtl` naming a material, whose `Kd` (diffuse color) in the MTL file
 *     colors the faces after it. The MTL comes in as a second file picked
 *     with the OBJ; without it, faces take the default color.
 *
 * Everything else (texture coordinates, normals, lines, groups, smoothing,
 * curves) is read past. OBJ is Y up by convention, as SNO is.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** Materials by name: the diffuse color of each, 0..1. */
export type Materials = Map<string, [number, number, number]>;
/** The materials in an MTL file. Unreadable lines are skipped: a material is a nicety, never a reason to refuse. */
export declare function parseMtl(text: string): Materials;
/** The MTL files an OBJ names with `mtllib`, so the caller can match the ones picked with it. */
export declare function mtlNames(text: string): string[];
/** An OBJ file as a mesh, colored by `materials` where its faces name one. */
export declare function parseObj(bytes: Uint8Array, clock: Clock, materials?: Materials): ImportMesh;
//# sourceMappingURL=obj.d.ts.map