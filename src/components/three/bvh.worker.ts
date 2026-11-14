// Builds the picking BVHs of the body model off the main thread. The main thread sends each mesh's position
// buffer (as it came out of the loader: interleaved, quantized) and its index; this worker builds the same
// MeshBVH the main thread used to build, and sends back only the packed tree (transferred, not copied).
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { BVH_OPTIONS } from './bvhOptions'

export type BvhJob = {
  id: number
  /** position data: a plain attribute (stride = itemSize, offset 0) or one view of an interleaved buffer */
  array: ArrayLike<number> & ArrayBufferView
  stride: number
  offset: number
  itemSize: number
  normalized: boolean
  interleaved: boolean
  index: (ArrayLike<number> & ArrayBufferView) | null
}
export type BvhReply = { id: number; ok: true; roots: ArrayBuffer[]; indirectBuffer: Uint32Array | Uint16Array | null; ms: number } | { id: number; ok: false; error: string }

const scope = self as unknown as { postMessage: (m: BvhReply, transfer?: Transferable[]) => void; onmessage: ((e: MessageEvent<BvhJob>) => void) | null }

scope.onmessage = (e) => {
  const j = e.data
  try {
    const t0 = performance.now()
    const g = new BufferGeometry()
    const position = j.interleaved
      ? new InterleavedBufferAttribute(new InterleavedBuffer(j.array as unknown as Float32Array, j.stride), j.itemSize, j.offset, j.normalized)
      : new BufferAttribute(j.array as unknown as Float32Array, j.itemSize, j.normalized)
    g.setAttribute('position', position)
    if (j.index) g.setIndex(new BufferAttribute(j.index as unknown as Uint32Array, 1))
    const bvh = new MeshBVH(g, BVH_OPTIONS)
    const data = MeshBVH.serialize(bvh, { cloneBuffers: false }) as unknown as { roots: ArrayBuffer[]; indirectBuffer: Uint32Array | Uint16Array | null }
    const transfer: Transferable[] = [...data.roots]
    if (data.indirectBuffer) transfer.push(data.indirectBuffer.buffer)
    scope.postMessage({ id: j.id, ok: true, roots: data.roots, indirectBuffer: data.indirectBuffer, ms: performance.now() - t0 }, transfer)
  } catch (err) {
    scope.postMessage({ id: j.id, ok: false, error: String((err as Error)?.message ?? err) })
  }
}
