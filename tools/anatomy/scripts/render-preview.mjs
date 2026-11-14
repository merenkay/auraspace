// Tiny software rasterizer: renders orthographic preview PNGs of the output GLB(s) for visual checks.
// Usage: node scripts/render-preview.mjs <outDir> <file.glb> [more.glb ...]
// Writes <outDir>/preview-<view>-<set>.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readGlb, extractMeshes } from './glb-read.mjs';

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) { console.error('usage: node scripts/render-preview.mjs <outDir> <file.glb> [...]'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const meshes = [];
for (const f of files) meshes.push(...extractMeshes(await readGlb(f)));

// ---- PNG writer
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// ---- views: right/up/forward(towards camera) basis
const VIEWS = {
  front: { right: [1, 0, 0], up: [0, 1, 0], toCam: [0, 0, 1] },   // camera on +Z looking at the face
  side: { right: [0, 0, -1], up: [0, 1, 0], toCam: [1, 0, 0] },   // camera on +X (subject's left side); anterior is screen-left
  back: { right: [-1, 0, 0], up: [0, 1, 0], toCam: [0, 0, -1] },
};
const SETS = {
  skin: (m) => m.extras.layer === 'skin',
  muscles: (m) => ['muscles', 'skeleton'].includes(m.extras.layer),
  skeleton: (m) => m.extras.layer === 'skeleton',
  inside: (m) => !['skin', 'muscles'].includes(m.extras.layer),
  organs: (m) => ['organs', 'arteries', 'veins', 'nerves'].includes(m.extras.layer),
  nerves: (m) => ['skeleton', 'nerves'].includes(m.extras.layer),
  viscera: (m) => m.extras.layer === 'organs',
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function render(viewName, setName, W = 420, H = 900, crop = null) {
  const v = VIEWS[viewName];
  const filter = SETS[setName] ?? ((m) => setName.split('+').includes(m.extras.layer));
  const sel = meshes.filter(filter);
  // bounds in view space
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    const p = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
    const u = dot(p, v.right), w = dot(p, v.up);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, w); maxV = Math.max(maxV, w);
  }
  if (crop) { minV = crop[0]; maxV = crop[1]; const cu = (minU + maxU) / 2; const half = ((maxV - minV) * W) / H / 2; minU = cu - half; maxU = cu + half; }
  const scale = Math.min((W - 20) / (maxU - minU), (H - 20) / (maxV - minV));
  const ox = W / 2 - ((minU + maxU) / 2) * scale, oy = H / 2 + ((minV + maxV) / 2) * scale;
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = 24; img[i * 3 + 1] = 28; img[i * 3 + 2] = 36; }
  const light = [0.35, 0.5, 0.79];
  for (const m of sel) {
    const P = m.positions, I = m.indices;
    const col = m.color;
    for (let t = 0; t < I.length; t += 3) {
      const pts = [I[t], I[t + 1], I[t + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
      const e1 = pts[1].map((x, k) => x - pts[0][k]), e2 = pts[2].map((x, k) => x - pts[0][k]);
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(...n) || 1; n = n.map((x) => x / nl);
      const facing = dot(n, v.toCam);
      // light in view space
      const nv = [dot(n, v.right), dot(n, v.up), facing];
      const shade = facing >= 0 ? 0.25 + 0.75 * Math.max(0, dot(nv, light)) : 0.12; // back faces dark (shows winding problems)
      const rgb = [0, 1, 2].map((k) => Math.round(255 * Math.min(1, toSrgb(col[k] * shade))));
      const s = pts.map((p) => [ox + dot(p, v.right) * scale, oy - dot(p, v.up) * scale, dot(p, v.toCam)]);
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      if (Math.abs(area) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
        const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
        const k = y * W + x;
        if (z > zbuf[k]) { zbuf[k] = z; img[k * 3] = rgb[0]; img[k * 3 + 1] = rgb[1]; img[k * 3 + 2] = rgb[2]; }
      }
    }
  }
  const file = path.join(outDir, `preview-${viewName}-${setName}${crop ? '-crop' : ''}.png`);
  writePng(file, W, H, img);
  console.log('wrote', file);
}

const sets = (process.env.SETS ?? 'skin,muscles,skeleton,inside,organs').split(',');
for (const s of sets) for (const view of ['front', 'side']) render(view, s);
if (process.env.CROP) {
  const [a, b] = process.env.CROP.split(',').map(Number);
  for (const s of sets) render('front', s, 700, 700, [a, b]);
}
