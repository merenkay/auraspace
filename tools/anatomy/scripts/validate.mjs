// Validate output GLB(s): load them back, print hierarchy, triangles, bounds, size and orientation checks.
// Usage: node scripts/validate.mjs <file.glb> [more.glb ...]
import fs from 'node:fs';
import { readGlb, extractMeshes } from './glb-read.mjs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node scripts/validate.mjs <file.glb> [...]'); process.exit(1); }

const all = [];
let failed = false;
for (const file of files) {
  const bytes = fs.statSync(file).size;
  const doc = await readGlb(file);
  const root = doc.getRoot();
  console.log(`\n== ${file}  ${(bytes / 1048576).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`);
  console.log('extensionsUsed:', root.listExtensionsUsed().map((e) => e.extensionName).join(', '));
  const printNode = (n, depth) => {
    const mesh = n.getMesh();
    const tris = mesh ? mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0) : null;
    console.log(`${'  '.repeat(depth)}${n.getName()}${tris != null ? `  [${tris.toLocaleString()} tris]` : ''}  ${JSON.stringify(n.getExtras())}`);
    for (const c of n.listChildren()) printNode(c, depth + 1);
  };
  for (const s of root.listScenes()) for (const n of s.listChildren()) printNode(n, 0);
  const meshes = extractMeshes(doc);
  for (const m of meshes) {
    if (!m.hasNormals) { console.log(`!! ${m.name} has no NORMAL attribute`); failed = true; }
    if (!/^sys_/.test(m.name)) { console.log(`!! unexpected mesh node ${m.name}`); failed = true; }
  }
  all.push(...meshes);
}

const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
const cent = {};
let total = 0;
for (const m of all) {
  let sx = 0, sy = 0, sz = 0;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], p[i + k]); bb.max[k] = Math.max(bb.max[k], p[i + k]); }
    sx += p[i]; sy += p[i + 1]; sz += p[i + 2];
  }
  const n = p.length / 3;
  cent[m.name] = [sx / n, sy / n, sz / n];
  total += m.triangles;
}
console.log('\ntriangles per node:');
for (const m of all) console.log(`  ${m.name.padEnd(16)} ${String(m.triangles).padStart(8)}   centroid ${cent[m.name].map((v) => v.toFixed(3)).join(', ')}`);
console.log(`  ${'TOTAL'.padEnd(16)} ${String(total).padStart(8)}`);
console.log('world bounding box (m): min', bb.min.map((v) => v.toFixed(4)), 'max', bb.max.map((v) => v.toFixed(4)));

const checks = [];
const c = cent;
if (c.sys_heart && c.sys_bones) checks.push(['feet at y=0 (min Y ~ 0)', Math.abs(bb.min[1]) < 0.002]);
checks.push(['centred on X', Math.abs(bb.min[0] + bb.max[0]) < 0.002]);
checks.push(['centred on Z', Math.abs(bb.min[2] + bb.max[2]) < 0.002]);
checks.push(['height plausible for adult (1.5-2.0 m)', bb.max[1] > 1.5 && bb.max[1] < 2.0]);
if (c.sys_brain && c.sys_heart) checks.push(['brain above heart (+Y up)', c.sys_brain[1] > c.sys_heart[1]]);
if (c.sys_eyes && c.sys_brain) checks.push(['eyes anterior of brain (+Z front)', c.sys_eyes[2] > c.sys_brain[2]]);
if (c.sys_heart) checks.push(["heart on subject's left (+X)", c.sys_heart[0] > 0]);
const bones = all.find((m) => m.name === 'sys_bones');
if (bones) {
  // feet point forward: mean Z of foot bones (y < 3 cm) vs. mean Z of the shin bones (30-50 cm)
  let fz = 0, fn = 0, sz = 0, sn = 0;
  const p = bones.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < 0.03) { fz += p[i + 2]; fn++; } else if (p[i + 1] > 0.3 && p[i + 1] < 0.5) { sz += p[i + 2]; sn++; }
  }
  checks.push(['feet extend anterior (+Z) of the shins', fn && sn && fz / fn > sz / sn]);
  // In the midline chest band (heart height +-5 cm, |x| < 2 cm) most bone vertices belong to the
  // thoracic vertebrae, so the heart must lie in front of their median depth.
  if (c.sys_heart) {
    const zs = [];
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < 0.02 && Math.abs(p[i + 1] - c.sys_heart[1]) < 0.05) zs.push(p[i + 2]);
    zs.sort((a, b) => a - b);
    checks.push(['heart is anterior (+Z) of the midline bone mass (spine) at heart height', zs.length > 0 && c.sys_heart[2] > zs[Math.floor(zs.length / 2)]]);
  }
}
console.log('\nchecks:');
for (const [d, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${d}`); if (!ok) failed = true; }
process.exit(failed ? 1 : 0);
