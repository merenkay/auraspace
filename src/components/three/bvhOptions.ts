import { CENTER, type MeshBVHOptions } from 'three-mesh-bvh'

/** BVH build options of the body viewer (indirect: the index buffer used for rendering stays untouched; a runtime
 * option of three-mesh-bvh 0.8 that its type declarations do not list yet). Shared by the worker and the fallback. */
export const BVH_OPTIONS: MeshBVHOptions & { indirect: boolean } = { strategy: CENTER, maxLeafTris: 10, indirect: true }
