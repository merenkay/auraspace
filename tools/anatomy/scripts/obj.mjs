// Minimal Wavefront OBJ reader for BodyParts3D element files.
// Reads text only: 'v', 'vn', 'f' records and the '# Key : value' header comments.
import fs from 'node:fs';

/**
 * @returns {{ header: Record<string,string>, positions: Float32Array, normals: Float32Array|null, indices: Uint32Array }}
 * positions are in the file's native frame (BodyParts3D: mm, +X left, +Y posterior, +Z superior).
 * Faces are triangulated as fans; indices refer to 'v' records.
 */
export function readObj(file) {
  const text = fs.readFileSync(file, 'utf8');
  const header = {};
  const pos = [];
  const nrm = [];
  const idx = [];
  // Per-vertex normal assignment taken from the face's vn reference (BP3D uses v//vn with v == vn).
  let vnForV = null;
  const faceNormalRefs = [];
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    const c0 = line.charCodeAt(0);
    if (c0 === 35 /* # */) {
      const m = /^#\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
      if (m) header[m[1]] = m[2];
      continue;
    }
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('vn ')) {
      const p = line.split(/\s+/);
      nrm.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/).slice(1).filter(Boolean);
      const vi = [];
      const ni = [];
      for (const tok of p) {
        const parts = tok.split('/');
        let v = parseInt(parts[0], 10);
        if (v < 0) v = pos.length / 3 + v + 1;
        vi.push(v - 1);
        if (parts.length >= 3 && parts[2]) {
          let n = parseInt(parts[2], 10);
          if (n < 0) n = nrm.length / 3 + n + 1;
          ni.push(n - 1);
        } else ni.push(-1);
      }
      for (let k = 1; k + 1 < vi.length; k++) {
        idx.push(vi[0], vi[k], vi[k + 1]);
        faceNormalRefs.push(ni[0], ni[k], ni[k + 1]);
      }
    }
  }
  const positions = new Float32Array(pos);
  let normals = null;
  if (nrm.length) {
    // Map normals onto position indices (first reference wins).
    vnForV = new Float32Array(positions.length);
    const seen = new Uint8Array(positions.length / 3);
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i];
      const n = faceNormalRefs[i];
      if (n < 0 || seen[v]) continue;
      seen[v] = 1;
      vnForV[3 * v] = nrm[3 * n];
      vnForV[3 * v + 1] = nrm[3 * n + 1];
      vnForV[3 * v + 2] = nrm[3 * n + 2];
    }
    normals = vnForV;
  }
  return { header, positions, normals, indices: new Uint32Array(idx) };
}
