// Shared helper: read a (meshopt-compressed, quantized) GLB and extract world-space triangles per node.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export async function readGlb(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(file);
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Returns [{ node, name, extras, color, positions(Float32 world), indices, triangles }] for every mesh node. */
export function extractMeshes(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pa = prim.getAttribute('POSITION');
      const n = pa.getCount();
      const positions = new Float32Array(n * 3);
      const el = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pa.getElement(i, el);
        const w = transformPoint(m, el[0], el[1], el[2]);
        positions[i * 3] = w[0]; positions[i * 3 + 1] = w[1]; positions[i * 3 + 2] = w[2];
      }
      const ia = prim.getIndices();
      const indices = ia ? Uint32Array.from(ia.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      const mat = prim.getMaterial();
      out.push({
        node, name: node.getName(), extras: node.getExtras(),
        color: mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1],
        positions, indices, triangles: indices.length / 3,
        hasNormals: !!prim.getAttribute('NORMAL'),
      });
    }
  }
  return out;
}
