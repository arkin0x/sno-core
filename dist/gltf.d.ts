/**
 * gltf.ts - reading glTF 2.0 (a .glb, or a .gltf with its buffers) into a mesh.
 *
 * glTF is the modern exchange format, and the one SNO describes itself
 * against: an SNO is `KHR_materials_unlit` with `COLOR_0` (DECK-0003 §7.2).
 *
 * This is a geometry reader, not a renderer's loader, and that is on purpose.
 * A full loader (three.js's GLTFLoader) resolves every buffer and image a file
 * names, over the network if the file says so, and decodes textures, which
 * needs a DOM. Import may never fetch, and needs none of that. So this reads
 * what becomes a shard and nothing else:
 *
 *   - the default scene's node tree, with each node's matrix or translation,
 *     rotation and scale applied, and a mirroring transform turning its faces
 *     round so their fronts stay fronts (§2);
 *   - each primitive's POSITION, its indices, and its mode: triangles, strips
 *     and fans become triangles; points become a point cloud when the file
 *     has no faces at all; lines are skipped;
 *   - COLOR_0 as vertex colors, and a material's baseColorFactor as the color
 *     of its faces, both converted from glTF's linear light to the sRGB the
 *     palette is in.
 *
 * Buffers are read from the GLB's own binary chunk, from base64 `data:` URIs,
 * or from files picked alongside a .gltf, matched by name. A buffer at any
 * other address is refused, never fetched. Draco and meshopt compression
 * are refused with a sentence saying so, and so are sparse accessors.
 *
 * Textures are not sampled: a textured model comes in in its base color.
 */
import { type Clock, type ImportMesh } from './mesh.js';
/** Whether these bytes are a GLB. */
export declare function looksLikeGlb(bytes: Uint8Array): boolean;
/** A glTF or GLB as a mesh. `companions` are other files picked with a .gltf, by name. */
export declare function parseGltf(bytes: Uint8Array, clock: Clock, companions?: Map<string, Uint8Array>): ImportMesh;
//# sourceMappingURL=gltf.d.ts.map