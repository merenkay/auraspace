// Download the official BodyParts3D 4.0 files from the DBCLS archive.
// Usage: node scripts/download.mjs <destDir>
// Files are saved as data only; nothing in <destDir> is ever executed.
// (curl -C - can be used instead to resume large downloads; see README.md.)
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST';
const FILES = [
  'README_e.html',
  'isa_parts_list_e.txt',
  'partof_parts_list_e.txt',
  'isa_inclusion_relation_list.txt',
  'partof_inclusion_relation_list.txt',
  'isa_element_parts.txt',
  'partof_element_parts.txt',
  'isa_BP3D_4.0_obj_99.zip',     // ~143 MB, all 2234 element meshes (incl. muscles)
  'partof_BP3D_4.0_obj_99.zip',  // ~65 MB, 1258 element meshes (part-of tree)
];

const dest = process.argv[2];
if (!dest) { console.error('usage: node scripts/download.mjs <destDir>'); process.exit(1); }
fs.mkdirSync(dest, { recursive: true });

for (const f of FILES) {
  const target = path.join(dest, f);
  const head = await fetch(`${BASE}/${f}`, { method: 'HEAD' });
  const expected = Number(head.headers.get('content-length') ?? 0);
  if (fs.existsSync(target) && expected && fs.statSync(target).size === expected) {
    console.log(`ok (cached) ${f}`);
    continue;
  }
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target));
  const size = fs.statSync(target).size;
  if (expected && size !== expected) throw new Error(`${f}: size ${size} != ${expected}`);
  console.log(`downloaded ${f} (${size.toLocaleString()} bytes)`);
}
