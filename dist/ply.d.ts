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
 * which is SNO's, so that is what is assumed, with one exception: a file
 * Blender wrote. Blender's PLY exporter defaults to Forward Y, Up Z, which is
 * Blender's own frame unchanged, and it signs its header with a comment:
 * "Created in Blender version 4.2.0" from the C++ exporter (3.6 on),
 * "Created by Blender 3.5.1 - www.blender.org" from the Python add-on before
 * it. A file with either comment
 * is read as Z up, and turned onto Y up by the same rotation as STL and
 * MagicaVoxel, (x, y, z) to (x, z, -y) (meshToShard.ts), so a default Blender
 * export stands instead of lying on its back (arkinox, 2026-11-16). That
 * rotation also agrees with Blender's own glTF and OBJ exporters: a model
 * facing Blender's front (-Y) comes in facing +Z, toward the viewer, by every
 * route. A Blender file exported with Up Y is the one that now lies down, and
 * a quarter turn in the workshop stands it up.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** A PLY file as a mesh. Throws MeshImportError on anything it cannot read. */
export declare function parsePly(bytes: Uint8Array, clock: Clock): ImportMesh;
/** Whether these bytes start like a PLY file. */
export declare function looksLikePly(bytes: Uint8Array): boolean;
//# sourceMappingURL=ply.d.ts.map