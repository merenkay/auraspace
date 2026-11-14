// Build web-ready GLB(s) from BodyParts3D 4.0 OBJ elements.
//
// Usage:
//   node scripts/build.mjs --raw <rawDir> --obj <objDir>[,<objDir2>...] --out <outDir> [--split] [--scale <budgetScale>] [--lungs-v3 <dir>] [--no-spinal-cord]
//
//   --raw    folder with the official BodyParts3D list files (*_parts_list_e.txt, ...)
//   --obj    one or more folders with FJxxxx.obj files (first folder that has a file wins)
//   --out    output folder (public/models)
//   --split  write body.glb (skeleton+organs+muscles+skin) and body-detail.glb (arteries, veins, nerves)
//   --scale  multiply every group's triangle budget (default 1)
//   --lungs-v3 <dir>   folder with BodyParts3D 3.0 OBJ files; adds the 5 lung-lobe surfaces
//                      (FMA7333/7383/7337/7370/7371.obj) that release 4.0 does not contain
//   --lungs-v3-scale n shrink factor applied to each 3.0 lung about its centroid (default 0.95)
//   --no-spinal-cord   skip the generated (approximate) spinal cord tube
//
// Input files are only ever read as data.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import { classify } from './classify.mjs';
import { synthSpinalCord } from './spinal-cord.mjs';
import { GROUPS, LAYERS } from './groups.mjs';

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const rawDir = arg('--raw');
const objDirs = (arg('--obj') ?? '').split(',').filter(Boolean);
const outDir = arg('--out');
const split = args.includes('--split');
const budgetScale = parseFloat(arg('--scale', '1'));
const lungsV3Dir = arg('--lungs-v3');
const lungsV3Scale = parseFloat(arg('--lungs-v3-scale', '0.95'));
if (!rawDir || !objDirs.length || !outDir) {
  console.error('usage: node scripts/build.mjs --raw <rawDir> --obj <objDir>[,...] --out <outDir> [--split] [--scale n]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const ATTRIBUTION_BY = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan';
const ATTRIBUTION_BY_CURRENT = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';
const SOURCE_URL = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html';

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

// ---------------------------------------------------------------- classify + load
const { readObj } = await import('./obj.mjs');
const cls = classify(rawDir, objDirs);

function findObj(fj) {
  for (const d of objDirs) {
    const p = path.join(d, `${fj}.obj`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// BodyParts3D frame: mm, +X = subject's left, +Y = posterior, +Z = superior.
// Output frame: metres, +Y up (superior), +Z anterior (front), +X = subject's left.
// (x, y, z) -> (x, z, -y) is a proper rotation (-90 deg about X), no mirroring.
function toOutputFrame(p) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] * 0.001;
    out[i + 1] = p[i + 2] * 0.001;
    out[i + 2] = -p[i + 1] * 0.001;
  }
  return out;
}

/** Read one OBJ, fix winding against its vn normals, weld exact duplicates, compact, convert frame. */
function loadElementFile(file, meta) {
  const o = readObj(file);
  if (!o.indices.length) return null;
  // Winding sanity: BP3D face winding agrees with its vn normals; verify per element and fix if not.
  if (o.normals) {
    let agree = 0;
    const P = o.positions, N = o.normals, I = o.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      agree += Math.sign(nx * (N[a] + N[b] + N[c]) + ny * (N[a + 1] + N[b + 1] + N[c + 1]) + nz * (N[a + 2] + N[b + 2] + N[c + 2]));
    }
    if (agree < 0) for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
  // Weld: many BP3D meshes duplicate vertices along normal seams; merge exact-duplicate positions so the
  // simplifier sees connected topology, then drop triangles that became degenerate.
  const remap = MeshoptSimplifier.generatePositionRemap(o.positions, 3);
  const welded = [];
  for (let t = 0; t < o.indices.length; t += 3) {
    const a = remap[o.indices[t]], b = remap[o.indices[t + 1]], c = remap[o.indices[t + 2]];
    if (a !== b && b !== c && a !== c) welded.push(a, b, c);
  }
  if (!welded.length) return null;
  // Compact: unused duplicate vertices left in the buffer make meshoptimizer treat their twins as
  // seams/locked vertices, which stalls simplification. Keep only referenced vertices.
  const compact = new Map();
  const srcPos = [];
  const indices = new Uint32Array(welded.length);
  for (let i = 0; i < welded.length; i++) {
    const v = welded[i];
    let n = compact.get(v);
    if (n === undefined) {
      n = compact.size; compact.set(v, n);
      srcPos.push(o.positions[3 * v], o.positions[3 * v + 1], o.positions[3 * v + 2]);
    }
    indices[i] = n;
  }
  return {
    ...meta,
    name: o.header['English name'] || meta.label,
    concept: o.header['Concept ID'] || null,
    positions: toOutputFrame(new Float32Array(srcPos)),
    indices,
  };
}

const elements = []; // { fj, group, label, name, source, positions, indices }
const missingFiles = [];
for (const [fj, info] of Object.entries(cls.elements)) {
  const file = findObj(fj);
  if (!file) { missingFiles.push({ fj, label: info.label, group: info.group }); continue; }
  const e = loadElementFile(file, { fj, group: info.group, label: info.label, source: 'BodyParts3D 4.0' });
  if (e) elements.push(e);
}
// Lung lobes: BodyParts3D 4.0 ships only the bronchial trees / pulmonary vessels of its segmented
// lungs, no lung surface. Release 3.0 of the same model has the five lobe surfaces (FMA-named files).
const LUNG_LOBES_V3 = [
  ['FMA7333', 'Upper lobe of right lung'], ['FMA7383', 'Middle lobe of right lung'], ['FMA7337', 'Lower lobe of right lung'],
  ['FMA7370', 'Upper lobe of left lung'], ['FMA7371', 'Lower lobe of left lung'],
];
if (lungsV3Dir) {
  const lobes = [];
  for (const [id, label] of LUNG_LOBES_V3) {
    const file = path.join(lungsV3Dir, `${id}.obj`);
    if (!fs.existsSync(file)) { missingFiles.push({ fj: id, label, group: 'sys_lungs' }); continue; }
    const e = loadElementFile(file, { fj: `v3:${id}`, group: 'sys_lungs', label, source: 'BodyParts3D 3.0' });
    if (e) { e.name = label; lobes.push(e); elements.push(e); }
  }
  // Release 4.0 moved the ribs outward a little ("skeletal system altered to accommodate big internal
  // organs"), so the 3.0 lobes poke through the 4.0 ribs. Shrinking each lung about its centroid
  // (default 0.95) cuts rib/intercostal intrusion from ~16% to ~6%/3% of sampled points while ~87%
  // of the 4.0 segmental bronchial tree stays inside the lobes (measured with scripts/check-lung-fit.mjs).
  for (const side of [/right/i, /left/i]) {
    const g = lobes.filter((e) => side.test(e.name));
    let c = [0, 0, 0], n = 0;
    for (const e of g) for (let i = 0; i < e.positions.length; i += 3) { c[0] += e.positions[i]; c[1] += e.positions[i + 1]; c[2] += e.positions[i + 2]; n++; }
    c = c.map((v) => v / n);
    for (const e of g) for (let i = 0; i < e.positions.length; i += 3) for (let k = 0; k < 3; k++) e.positions[i + k] = c[k] + (e.positions[i + k] - c[k]) * lungsV3Scale;
  }
}
const srcTris = elements.reduce((s, e) => s + e.indices.length / 3, 0);
console.log(`loaded ${elements.length} elements, ${srcTris.toLocaleString()} source triangles; missing OBJ files: ${missingFiles.length}`);

// ---------------------------------------------------------------- normalise placement
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const e of elements) {
  const p = e.positions;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i + k] < bb.min[k]) bb.min[k] = p[i + k];
    if (p[i + k] > bb.max[k]) bb.max[k] = p[i + k];
  }
}
const offset = [-(bb.min[0] + bb.max[0]) / 2, -bb.min[1], -(bb.min[2] + bb.max[2]) / 2];
for (const e of elements) {
  const p = e.positions;
  for (let i = 0; i < p.length; i += 3) { p[i] += offset[0]; p[i + 1] += offset[1]; p[i + 2] += offset[2]; }
}

// ---------------------------------------------------------------- approximate spinal cord (not in BodyParts3D)
let spinalCord = null;
if (!args.includes('--no-spinal-cord')) {
  const sc = synthSpinalCord(elements);
  if (sc) {
    spinalCord = {
      fj: 'generated:spinal-cord', group: 'sys_nerves', label: 'Spinal cord (approximation)',
      name: 'Spinal cord (approximation generated along the BodyParts3D vertebral canal)',
      source: 'generated', positions: sc.positions, indices: sc.indices, controlPoints: sc.controlPoints,
    };
    elements.push(spinalCord);
    console.log(`generated spinal cord: ${sc.indices.length / 3} tris through ${sc.controlPoints.length} control points`);
  } else console.warn('could not generate spinal cord (vertebrae not found)');
}

// ---------------------------------------------------------------- orientation landmarks (pre-simplification, per element)
function centroid(list) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const e of list) for (let i = 0; i < e.positions.length; i += 3) { sx += e.positions[i]; sy += e.positions[i + 1]; sz += e.positions[i + 2]; n++; }
  return n ? [sx / n, sy / n, sz / n] : null;
}
const byName = (re) => elements.filter((e) => re.test(e.name));
const lm = {
  heart: centroid(elements.filter((e) => e.group === 'sys_heart')),
  liver: centroid(byName(/hepatovenous segment|lobe of liver/i)),
  thoracicVertebrae: centroid(byName(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) thoracic vertebra$/i)),
  sternum: centroid(byName(/manubrium|body of sternum|xiphoid/i)),
  brain: centroid(elements.filter((e) => e.group === 'sys_brain')),
  eyes: centroid(elements.filter((e) => e.group === 'sys_eyes')),
  calcanei: centroid(byName(/calcaneus/i)),
  toes: centroid(byName(/distal phalanx of .*(big|great) toe|distal phalanx of .*hallux/i)),
};
const checks = [];
const chk = (desc, ok) => checks.push({ check: desc, pass: !!ok });
if (lm.heart && lm.thoracicVertebrae) chk('heart is anterior (+Z) of thoracic spine', lm.heart[2] > lm.thoracicVertebrae[2]);
if (lm.sternum && lm.thoracicVertebrae) chk('sternum is anterior (+Z) of thoracic spine', lm.sternum[2] > lm.thoracicVertebrae[2]);
if (lm.eyes && lm.brain) chk('eyes are anterior (+Z) of brain centre', lm.eyes[2] > lm.brain[2]);
if (lm.heart) chk("heart lies on the subject's left (+X)", lm.heart[0] > 0);
if (lm.liver) chk("liver lies on the subject's right (-X)", lm.liver[0] < 0);
if (lm.brain && lm.heart && lm.calcanei) chk('brain above heart above heels (+Y up)', lm.brain[1] > lm.heart[1] && lm.heart[1] > lm.calcanei[1]);
if (lm.toes && lm.calcanei) chk('big toes are anterior (+Z) of heels', lm.toes[2] > lm.calcanei[2]);
{
  // head is the max-Y region: the highest vertex of the whole model belongs to skin/skull above the brain
  let top = null;
  for (const e of elements) for (let i = 1; i < e.positions.length; i += 3) if (!top || e.positions[i] > top.y) top = { y: e.positions[i], name: e.name };
  chk(`highest point (${top.name}, y=${top.y.toFixed(3)} m) is above the brain centroid`, lm.brain && top.y > lm.brain[1]);
}
console.log('landmarks (m):', Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, v && v.map((x) => +x.toFixed(3))])));
console.log('orientation checks:', checks);

// ---------------------------------------------------------------- simplification
function elementScale(e) {
  // characteristic size: geometric mean of bbox diagonal and a thickness estimate (6V/A)
  const p = e.positions, I = e.indices;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  let A = 0, V = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    A += 0.5 * Math.hypot(nx, ny, nz);
    V += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  const thick = A > 0 ? (6 * Math.abs(V)) / A : diag;
  const t = Math.min(Math.max(thick, 0.0005), diag);
  return Math.max(Math.sqrt(diag * t), 0.001);
}

const simpCache = new Map();
function simplifyElement(e, relErr) {
  const key = `${e.fj}:${relErr}`;
  if (simpCache.has(key)) return simpCache.get(key);
  const abs = relErr * e.scale;
  const [idx] = MeshoptSimplifier.simplify(e.indices, e.positions, 3, 0, abs, ['ErrorAbsolute']);
  // Never let an element disappear completely: fall back to the original if simplification wiped it.
  const res = idx.length >= 3 ? idx : e.indices;
  simpCache.set(key, res);
  return res;
}

const groupResults = new Map();
for (const g of GROUPS) {
  const els = elements.filter((e) => e.group === g.name);
  if (!els.length) { console.warn(`group ${g.name} is empty`); continue; }
  for (const e of els) e.scale ??= elementScale(e);
  const src = els.reduce((s, e) => s + e.indices.length / 3, 0);
  const budget = Math.round(g.budget * budgetScale);
  const count = (err) => els.reduce((s, e) => s + simplifyElement(e, err).length / 3, 0);
  let chosen = 0, chosenCount = src;
  if (src > budget) {
    // binary search (log space) for the smallest relative error that fits the budget
    let lo = Math.log(1e-5), hi = Math.log(0.5);
    for (let it = 0; it < 18; it++) {
      const mid = Math.exp((lo + hi) / 2);
      if (count(mid) > budget) lo = Math.log(mid); else hi = Math.log(mid);
    }
    chosen = Math.exp(hi);
    chosenCount = count(chosen);
  }
  // free cache entries for this group except the chosen level
  for (const k of [...simpCache.keys()]) if (els.some((e) => k.startsWith(e.fj + ':')) && !k.endsWith(`:${chosen}`)) simpCache.delete(k);
  groupResults.set(g.name, { els, err: chosen, src, tris: chosenCount });
  console.log(`${g.name.padEnd(15)} elements=${String(els.length).padStart(4)} src=${String(src).padStart(8)} -> ${String(chosenCount).padStart(7)} tris (relErr ${chosen.toExponential(2)})`);
}

// ---------------------------------------------------------------- merge per group
function buildGroupGeometry(name) {
  const r = groupResults.get(name);
  let vCount = 0, iCount = 0;
  const parts = r.els.map((e) => {
    const idx = r.err ? simplifyElement(e, r.err) : e.indices;
    // compact vertices
    const remap = new Int32Array(e.positions.length / 3).fill(-1);
    let n = 0;
    for (const v of idx) if (remap[v] < 0) remap[v] = n++;
    const pos = new Float32Array(n * 3);
    for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) pos.set(e.positions.subarray(v * 3, v * 3 + 3), remap[v] * 3);
    const ind = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) ind[i] = remap[idx[i]];
    vCount += n; iCount += ind.length;
    return { pos, ind };
  });
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const indices = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const { pos, ind } of parts) {
    positions.set(pos, vo * 3);
    for (let i = 0; i < ind.length; i++) indices[io + i] = ind[i] + vo;
    // smooth area-weighted normals, per element
    for (let t = 0; t < ind.length; t += 3) {
      const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { normals[vo * 3 + q] += nx; normals[vo * 3 + q + 1] += ny; normals[vo * 3 + q + 2] += nz; }
    }
    vo += pos.length / 3; io += ind.length;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; } else normals[i + 1] = 1;
  }
  return { positions, normals, indices, triangles: indices.length / 3 };
}

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
}

const DETAIL_LAYERS = new Set(['arteries', 'veins', 'nerves']);
const outputs = split
  ? [
    { file: 'body.glb', layers: LAYERS.filter((l) => !DETAIL_LAYERS.has(l.layer)) },
    { file: 'body-detail.glb', layers: LAYERS.filter((l) => DETAIL_LAYERS.has(l.layer)) },
  ]
  : [{ file: 'body.glb', layers: LAYERS }];

const manifestNodes = [];
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const fileInfo = [];
for (const out of outputs) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'nasaspaceapps tools/anatomy (BodyParts3D -> glTF)';
  doc.getRoot().getAsset().copyright = ATTRIBUTION_BY;
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const root = doc.createNode('body').setExtras({
    units: 'm', up: '+Y', front: '+Z',
    source: 'BodyParts3D 4.0 (DBCLS)', attribution: ATTRIBUTION_BY, sourceUrl: SOURCE_URL,
  });
  scene.addChild(root);
  for (const L of out.layers) {
    const groups = GROUPS.filter((g) => g.layer === L.layer && groupResults.has(g.name));
    if (!groups.length) continue;
    const layerNode = doc.createNode(L.name).setExtras({ layer: L.layer, label: L.label });
    root.addChild(layerNode);
    for (const g of groups) {
      const geo = buildGroupGeometry(g.name);
      const mat = doc.createMaterial(`mat_${g.system}`)
        .setBaseColorFactor([...hexToLinear(g.color), 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(g.roughness)
        .setDoubleSided(false);
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(geo.positions).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(geo.normals).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(geo.indices).setBuffer(buffer))
        .setMaterial(mat);
      const mesh = doc.createMesh(g.name).addPrimitive(prim);
      const extras = { system: g.system, layer: g.layer, label: g.label };
      const node = doc.createNode(g.name).setMesh(mesh).setExtras(extras);
      layerNode.addChild(node);
      const r = groupResults.get(g.name);
      const notes = [];
      if (r.els.some((e) => e.source === 'generated')) notes.push('includes a generated spinal-cord approximation (tube along the BodyParts3D vertebral canal); BodyParts3D 4.0 has no spinal cord or peripheral nerve meshes besides the orbital/optic nerves');
      if (r.els.some((e) => e.source === 'BodyParts3D 3.0')) notes.push('lung lobe surfaces taken from BodyParts3D 3.0 (release 4.0 has only the bronchial trees)');
      manifestNodes.push({
        name: g.name, system: g.system, layer: g.layer, label: g.label, triangles: geo.triangles,
        file: out.file, color: g.color, sourceElements: r.els.length, sourceTriangles: r.src,
        ...(notes.length ? { notes } : {}),
      });
    }
  }
  await doc.transform(
    weld(),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high', quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10 }),
  );
  const target = path.join(outDir, out.file);
  await io.write(target, doc);
  const size = fs.statSync(target).size;
  fileInfo.push({ file: out.file, bytes: size, layers: out.layers.map((l) => l.name) });
  console.log(`wrote ${target} (${(size / 1048576).toFixed(2)} MB)`);
}

// ---------------------------------------------------------------- manifest
const round = (v) => +v.toFixed(4);
const finalBB = {
  min: [bb.min[0] + offset[0], bb.min[1] + offset[1], bb.min[2] + offset[2]].map(round),
  max: [bb.max[0] + offset[0], bb.max[1] + offset[1], bb.max[2] + offset[2]].map(round),
};
const manifest = {
  files: fileInfo,
  nodes: manifestNodes,
  layers: LAYERS.filter((l) => manifestNodes.some((n) => n.layer === l.layer)).map((l) => ({
    name: l.name, layer: l.layer, label: l.label,
    children: manifestNodes.filter((n) => n.layer === l.layer).map((n) => n.name),
  })),
  totalTriangles: manifestNodes.reduce((s, n) => s + n.triangles, 0),
  boundingBox: { ...finalBB, size: finalBB.max.map((v, i) => round(v - finalBB.min[i])) },
  units: 'm',
  up: '+Y',
  front: '+Z',
  left: "+X (subject's left)",
  orientationChecks: checks,
  compression: 'EXT_meshopt_compression + KHR_mesh_quantization (decode with three/examples/jsm/libs/meshopt_decoder.module.js)',
  source: {
    name: 'BodyParts3D',
    version: '4.0 (2013-06-19; polygon reduction rate 99%, is-a + part-of OBJ sets)'
      + (lungsV3Dir ? ' + lung lobes from 3.0 (2011-09-15)' : ''),
    url: SOURCE_URL,
    generated: elements.some((e) => e.source === 'generated') ? ['approximate spinal cord in sys_nerves (not BodyParts3D data)'] : [],
  },
  attribution: ATTRIBUTION_BY,
  attributionCurrentLicense: ATTRIBUTION_BY_CURRENT,
  license: 'CC BY-SA 2.1 JP (derivative work; see ATTRIBUTION.md)',
};
fs.writeFileSync(path.join(outDir, 'body-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// ---------------------------------------------------------------- build report (kept out of public/)
const report = {
  dropped: cls.dropped,
  missingFiles,
  groups: Object.fromEntries([...groupResults].map(([k, v]) => [k, {
    elements: v.els.length, sourceTriangles: v.src, triangles: v.tris, relativeError: v.err,
    members: v.els.map((e) => `${e.fj} ${e.name}`),
  }])),
  landmarks: lm, orientationChecks: checks,
};
const reportPath = path.join(path.dirname(rawDir), 'build-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log('manifest + report written; total triangles', manifest.totalTriangles.toLocaleString());
