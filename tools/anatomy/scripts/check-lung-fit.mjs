// Diagnostic: how well do the BodyParts3D 3.0 lung lobes fit the 4.0 thorax?
// Usage (from tools/anatomy, after classify.mjs wrote .cache/classification.json):
//   node scripts/check-lung-fit.mjs <v4 OBJ dir> <dir with FMA7333/7383/7337/7370/7371.obj>
// Prints the share of sampled points of 4.0 structures that fall inside the lobes, unscaled and
// for a few shrink factors (the build uses --lungs-v3-scale 0.95).
import fs from 'node:fs';
import path from 'node:path';
import { readObj } from './obj.mjs';
const [v4dir, v3dir] = process.argv.slice(2);
const cls = JSON.parse(fs.readFileSync('.cache/classification.json'));
const load = (f) => readObj(f);
const bbox = (P) => { const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9]; for (let i=0;i<P.length;i+=3) for (let k=0;k<3;k++){mn[k]=Math.min(mn[k],P[i+k]);mx[k]=Math.max(mx[k],P[i+k]);} return [mn.map(v=>v.toFixed(0)),mx.map(v=>v.toFixed(0))]; };
// point-in-mesh by ray parity along +X
function inside(mesh, p) {
  const P = mesh.positions, I = mesh.indices; let c = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a=I[t]*3,b=I[t+1]*3,d=I[t+2]*3;
    // project to YZ plane, check if (p.y,p.z) in triangle and intersection x > p.x
    const y0=P[a+1],z0=P[a+2],y1=P[b+1],z1=P[b+2],y2=P[d+1],z2=P[d+2];
    const den=(y1-y0)*(z2-z0)-(y2-y0)*(z1-z0); if (Math.abs(den)<1e-12) continue;
    const u=((p[1]-y0)*(z2-z0)-(y2-y0)*(p[2]-z0))/den, v=((y1-y0)*(p[2]-z0)-(p[1]-y0)*(z1-z0))/den;
    if (u<0||v<0||u+v>1) continue;
    const x=P[a]+u*(P[b]-P[a])+v*(P[d]-P[a]); if (x>p[0]) c++;
  }
  return c % 2 === 1;
}
const lobes = fs.readdirSync(v3dir).map((f) => ({ f, m: load(path.join(v3dir, f)) }));
for (const l of lobes) console.log('v3', l.f, 'tris', l.m.indices.length/3, 'bbox', JSON.stringify(bbox(l.m.positions)));
const pick = (re) => Object.entries(cls.elements).filter(([fj, e]) => re.test(e.label)).map(([fj]) => load(path.join(v4dir, fj + '.obj')));
const sample = (meshes, step) => { const pts=[]; for (const m of meshes) for (let i=0;i<m.positions.length;i+=3*step) pts.push([m.positions[i],m.positions[i+1],m.positions[i+2]]); return pts; };
const insideAny = (p) => lobes.some((l) => inside(l.m, p));
for (const [name, re, step] of [['bronchial trees', /segmental bronchial tree|lingular bronchial tree/i, 40], ['ribs', /\brib$/i, 60], ['heart', /ventricle|atrium/i, 40], ['vertebrae T', /thoracic vertebra$/i, 60], ['pulmonary veins', /pulmonary vein/i, 20], ['liver', /hepatovenous segment/i, 80], ['intercostal', /intercostal muscle/i, 200]]) {
  const ms = pick(re); const pts = sample(ms, step);
  const n = pts.filter(insideAny).length;
  console.log(name.padEnd(16), 'elements', ms.length, 'samples', pts.length, 'inside lungs', (100*n/pts.length).toFixed(1)+'%');
}
console.log('--- scaled about each lung centroid (right: 7333/7337/7383, left: 7370/7371)');
const groups = { right: lobes.filter(l => /7333|7337|7383/.test(l.f)), left: lobes.filter(l => /7370|7371/.test(l.f)) };
const orig = new Map(lobes.map(l => [l.f, Float32Array.from(l.m.positions)]));
for (const s of [0.97, 0.95, 0.93]) {
  for (const g of Object.values(groups)) {
    let cx=0,cy=0,cz=0,n=0; for (const l of g){const P=orig.get(l.f); for(let i=0;i<P.length;i+=3){cx+=P[i];cy+=P[i+1];cz+=P[i+2];n++;}} cx/=n;cy/=n;cz/=n;
    for (const l of g){const P=orig.get(l.f); const Q=l.m.positions; for(let i=0;i<P.length;i+=3){Q[i]=cx+(P[i]-cx)*s;Q[i+1]=cy+(P[i+1]-cy)*s;Q[i+2]=cz+(P[i+2]-cz)*s;}}
  }
  const res=[];
  for (const [name, re, step] of [['bronchi', /segmental bronchial tree|lingular bronchial tree/i, 40], ['ribs', /\brib$/i, 60], ['heart', /ventricle|atrium/i, 40], ['intercostal', /intercostal muscle/i, 200]]) {
    const pts = sample(pick(re), step); res.push(name+' '+(100*pts.filter(insideAny).length/pts.length).toFixed(1)+'%');
  }
  console.log('scale', s, res.join('  '));
}
