// Approximate spinal cord, generated from BodyParts3D geometry.
//
// BodyParts3D 4.0 has no spinal cord surface (its "spinal cord" concept only contains a 36 mm
// piece of the central canal). For the nerves layer we generate a smooth tube that runs through
// the vertebral canal of the BP3D spine: from the lower end of the BP3D medulla oblongata, then
// just behind the posterior surface of every BP3D intervertebral disk (C2/C3 ... L1/L2, where the
// conus medullaris ends), with textbook cord radii. The result is clearly marked as an
// approximation in the node extras / manifest.
//
// All coordinates are in the output frame: metres, +Y up, +Z anterior, +X subject's left.

// [intervertebral disk name, cord radius (m) at that level, canal half-depth behind the disk (m)]
const LEVELS = [
  ['Intervertebral disk of axis', 0.0052, 0.0075],
  ['Intervertebral disk of third cervical vertebra', 0.0058, 0.0075],
  ['Intervertebral disk of fourth cervical vertebra', 0.0063, 0.0075],
  ['Intervertebral disk of fifth cervical vertebra', 0.0065, 0.0075],
  ['Intervertebral disk of sixth cervical vertebra', 0.0062, 0.0075],
  ['Intervertebral disk of seventh cervical vertebra', 0.0054, 0.0080],
  ['Intervertebral disk of first thoracic vertebra', 0.0047, 0.0080],
  ['Intervertebral disk of second thoracic vertebra', 0.0043, 0.0080],
  ['Intervertebral disk of third thoracic vertebra', 0.0042, 0.0080],
  ['Intervertebral disk of fourth thoracic vertebra', 0.0042, 0.0080],
  ['Intervertebral disk of fifth thoracic vertebra', 0.0042, 0.0080],
  ['Intervertebral disk of sixth thoracic vertebra', 0.0042, 0.0080],
  ['Intervertebral disk of seventh thoracic vertebra', 0.0042, 0.0080],
  ['Intervertebral disk of eighth thoracic vertebra', 0.0043, 0.0085],
  ['Intervertebral disk of ninth thoracic vertebra', 0.0045, 0.0085],
  ['Intervertebral disk of tenth thoracic vertebra', 0.0048, 0.0085],
  ['Intervertebral disk of eleventh thoracic vertebra', 0.0050, 0.0090],
  ['Intervertebral disk of twelfth thoracic vertebra', 0.0045, 0.0090],
  ['Intervertebral disk of first lumbar vertebra', 0.0012, 0.0090], // L1/L2: conus medullaris tip
];

function centroidOf(p) {
  let x = 0, y = 0, z = 0;
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { x += p[i]; y += p[i + 1]; z += p[i + 2]; }
  return [x / n, y / n, z / n];
}

/** Canal centre behind a disk: posterior-most mid-sagittal disk point, moved back by the canal half-depth. */
function canalBehindDisk(positions, halfDepth) {
  const c = centroidOf(positions);
  let minZ = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i] - c[0]) < 0.004 && Math.abs(positions[i + 1] - c[1]) < 0.003) minZ = Math.min(minZ, positions[i + 2]);
  }
  return Number.isFinite(minZ) ? [c[0], c[1], minZ - halfDepth] : null;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

/**
 * @param {Array<{name:string, positions:Float32Array}>} elements  BP3D elements (output frame)
 * @returns {{positions: Float32Array, indices: Uint32Array, controlPoints: number[][]} | null}
 */
export function synthSpinalCord(elements, radialSegments = 14) {
  const byName = new Map(elements.map((e) => [e.name.toLowerCase(), e]));
  const ctrl = []; // [x,y,z,r]
  const medulla = byName.get('medulla oblongata');
  if (medulla) {
    const p = medulla.positions;
    let minY = Infinity;
    for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
    const pts = [];
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] < minY + 0.004) pts.push(p[i], p[i + 1], p[i + 2]);
    const c = centroidOf(pts);
    ctrl.push([c[0], minY + 0.004, c[2], 0.0055]);
  }
  for (const [name, r, depth] of LEVELS) {
    const e = byName.get(name.toLowerCase());
    if (!e) continue;
    const cc = canalBehindDisk(e.positions, depth);
    if (cc) ctrl.push([...cc, r]);
  }
  if (ctrl.length < 8) return null;
  // light smoothing of the centre line (endpoints fixed); x is kept on the disks' midline
  for (let pass = 0; pass < 2; pass++) {
    const prev = ctrl.map((c) => [...c]);
    for (let i = 1; i < ctrl.length - 1; i++) {
      for (const k of [0, 2]) ctrl[i][k] = (prev[i - 1][k] + 2 * prev[i][k] + prev[i + 1][k]) / 4;
    }
  }

  // sample a smooth centre line (~3 mm steps)
  const path = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const seg = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) / 0.003));
    for (let s = 0; s < seg; s++) {
      const t = s / seg;
      const xyz = catmullRom(p0, p1, p2, p3, t);
      path.push([...xyz, p1[3] + (p2[3] - p1[3]) * t]);
    }
  }
  path.push(ctrl[ctrl.length - 1]);

  // tube with parallel-transport frames
  const pos = [];
  const idx = [];
  let prevN = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let T = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    const tl = Math.hypot(...T); T = T.map((v) => v / tl);
    let N;
    if (!prevN) N = [1, 0, 0];
    else N = prevN;
    // remove tangent component
    const dt = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = [N[0] - dt * T[0], N[1] - dt * T[1], N[2] - dt * T[2]];
    const nl = Math.hypot(...N); N = N.map((v) => v / nl);
    prevN = N;
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    for (let k = 0; k < radialSegments; k++) {
      const ang = (k / radialSegments) * Math.PI * 2;
      // slightly elliptical cross-section: wider left-right than antero-posterior (N ~ +X)
      const cx = Math.cos(ang) * p[3] * 1.15, cy = Math.sin(ang) * p[3] * 0.85;
      pos.push(p[0] + N[0] * cx + B[0] * cy, p[1] + N[1] * cx + B[1] * cy, p[2] + N[2] * cx + B[2] * cy);
    }
  }
  const rings = path.length;
  // every face is emitted together with a known outward direction and oriented to match it
  const addFace = (a, b, c, out) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < radialSegments; k++) {
      const a0 = i * radialSegments + k, a1 = i * radialSegments + ((k + 1) % radialSegments);
      const b0 = a0 + radialSegments, b1 = a1 + radialSegments;
      for (const [a, b, c] of [[a0, b0, a1], [a1, b0, b1]]) {
        const ring = c === b1 ? i + 1 : i;
        const pc = path[ring];
        const mx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, my = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, mz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
        addFace(a, b, c, [mx - pc[0], my - pc[1], mz - pc[2]]);
      }
    }
  }
  for (const ring of [0, rings - 1]) {
    const c = path[ring];
    const nb = path[ring === 0 ? 1 : rings - 2];
    const out = [c[0] - nb[0], c[1] - nb[1], c[2] - nb[2]];
    const ci = pos.length / 3;
    pos.push(c[0], c[1], c[2]);
    for (let k = 0; k < radialSegments; k++) {
      addFace(ci, ring * radialSegments + k, ring * radialSegments + ((k + 1) % radialSegments), out);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), controlPoints: ctrl };
}
