/**
 * stl.ts - reading an STL file into a mesh.
 *
 * STL is what 3D printing speaks: a soup of triangles, each with its own
 * three corners, so neighbors share positions but not vertices. That is fine
 * here, because the converter welds on the lattice anyway (meshToShard.ts).
 *
 * Binary and ASCII are both read. Telling them apart by the word "solid" at
 * the start does not work, because many binary writers put "solid" in their
 * 80-byte header; a binary file is recognized instead by its size, which is
 * exactly 84 bytes plus 50 per triangle.
 *
 * STL has no color, and two vendors filled the hole incompatibly (DECK-0003
 * Appendix B.3). Both are read, as the brief for this format asks:
 *
 *   - VisCAM and SolidView: a triangle's two attribute bytes hold a 15-bit
 *     color, blue in the low five bits, valid when bit 15 is set.
 *   - Materialise Magics: "COLOR=" and four bytes in the header give the
 *     part's color, and a triangle with bit 15 clear has its own, red in the
 *     low five bits.
 *
 * STL is Z up by long habit (slicers, Thingiverse, Blender's exporter), so
 * that is what is assumed.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** Whether these bytes are a binary STL: 84 bytes of header and count, then exactly 50 per triangle. */
export declare function isBinaryStl(bytes: Uint8Array): boolean;
/** Whether these bytes start like an ASCII STL. */
export declare function looksLikeAsciiStl(bytes: Uint8Array): boolean;
/** An STL file as a mesh. Throws MeshImportError on anything it cannot read. */
export declare function parseStl(bytes: Uint8Array, clock: Clock): ImportMesh;
//# sourceMappingURL=stl.d.ts.map