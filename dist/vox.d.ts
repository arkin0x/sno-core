/**
 * vox.ts - reading a MagicaVoxel .vox file into a mesh.
 *
 * MagicaVoxel is the format SNO is "the same idea one level up" from
 * (DECK-0003 Appendix B.1): a grid and a 256-color palette. A voxel model
 * lands on the SNO lattice exactly, every voxel the same whole number of
 * ticks (meshToShard.ts, `lattice`), so nothing about its shape is rounded.
 *
 * What is read: every model (SIZE and XYZI), the palette (RGBA, or the
 * default when a file has none), and the scene graph (nTRN, nGRP, nSHP) with
 * each transform's translation and rotation, so a scene of several models
 * comes in arranged as it was built. Materials, layers, cameras and the rest
 * are read past.
 *
 * The surface is meshed greedily: only faces between a voxel and empty space
 * are kept, and neighboring faces of one color on one plane are merged into
 * one rectangle, two triangles. A 16 by 16 wall of one color is two faces
 * rather than 512. Each rectangle is wound to look outward and carries its
 * voxel's color as a face color, so color edges stay crisp (§1.4a).
 *
 * MagicaVoxel is Z up.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** Whether these bytes are a .vox file. */
export declare function looksLikeVox(bytes: Uint8Array): boolean;
/** A .vox file as a mesh. Throws MeshImportError on anything it cannot read. */
export declare function parseVox(bytes: Uint8Array, clock: Clock): ImportMesh;
//# sourceMappingURL=vox.d.ts.map