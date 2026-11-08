/**
 * ply.ts - reading a PLY file into a mesh.
 *
 * PLY is the format whose data model already is SNO's (DECK-0003 Appendix B):
 * vertices with a color each and faces indexing them. It is what scanners,
 * MeshLab and Blender write, and what snocrash exports, so it is the import
 * that has to be right.
 *
 * Read here: ASCII, binary little endian and binary big endian; any element
 * order; `vertex` with x, y, z and a color as red, green, blue (or r, g, b, or
 * diffuse_red ...) in any numeric type; `face` with `vertex_indices` (or
 * `vertex_index`) as a list, and a color of its own if it has one. Polygons
 * are split into triangles in their own winding. Every other element (edges,
 * materials, anything) is read past and ignored. A file with vertices and no
 * faces is a point cloud.
 *
 * PLY has no up axis. Scanned PLYs (the Stanford models) and MeshLab are Y up,
 * which is SNO's, so that is what is assumed; a model that lies on its back
 * stands up with a quarter turn in the workshop.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** A PLY file as a mesh. Throws MeshImportError on anything it cannot read. */
export declare function parsePly(bytes: Uint8Array, clock: Clock): ImportMesh;
/** Whether these bytes start like a PLY file. */
export declare function looksLikePly(bytes: Uint8Array): boolean;
//# sourceMappingURL=ply.d.ts.map