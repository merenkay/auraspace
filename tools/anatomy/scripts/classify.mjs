// Classify every BodyParts3D element mesh (FJxxxx) into an output group.
//
// Usage: node scripts/classify.mjs <rawDir> [outJson] [objDir[,objDir2]]
//   rawDir  folder holding the official *_parts_list_e.txt / *_element_parts.txt /
//           *_inclusion_relation_list.txt files (read as plain text only)
//   outJson optional output path (default: <rawDir>/../classification.json)
//   objDir  optional OBJ folder(s); the '# English name' header of each FJ file is the
//           element's canonical name and is preferred over names inferred from the lists.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLists } from './bp3d-lists.mjs';
import { RULES } from './groups.mjs';

/** Reads '# Concept ID' / '# English name' from the first bytes of an OBJ (text only). */
export function readObjHeader(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(2048);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const header = {};
  for (const line of buf.subarray(0, n).toString('utf8').split(/\r?\n/)) {
    const m = /^#\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
    if (m) header[m[1]] = m[2].trim();
  }
  return { concept: header['Concept ID'] ?? '', name: header['English name'] ?? '' };
}

function loadParents(rawDir) {
  const parents = new Map();
  for (const t of ['isa', 'partof']) {
    const lines = fs.readFileSync(path.join(rawDir, `${t}_inclusion_relation_list.txt`), 'utf8')
      .split(/\r?\n/).slice(1).filter(Boolean);
    for (const l of lines) {
      const [p, , c] = l.split('\t').map((x) => x.trim());
      if (!parents.has(c)) parents.set(c, new Set());
      parents.get(c).add(p);
    }
  }
  return parents;
}

export function classify(rawDir, objDirs = []) {
  const L = loadLists(rawDir);
  const parents = loadParents(rawDir);
  const addAncestors = (member, start) => {
    const stack = [...start];
    while (stack.length) {
      const c = stack.pop();
      for (const p of parents.get(c) ?? []) if (!member.has(p)) { member.add(p); stack.push(p); }
    }
  };

  // Own concepts of an element = concepts represented by exactly that one mesh.
  const ownConcepts = new Map();
  for (const [c, set] of L.elementsOf) {
    if (set.size !== 1) continue;
    const [fj] = set;
    if (!ownConcepts.has(fj)) ownConcepts.set(fj, []);
    ownConcepts.get(fj).push(c);
  }

  const missing = new Set();
  const ruleSets = RULES.map((r) => {
    const set = new Set();
    for (const c of r.concepts ?? []) {
      if (!L.conceptName.has(c)) { missing.add(c); continue; }
      set.add(c);
    }
    return { ...r, conceptSet: set };
  });

  const elements = {};
  const dropped = [];
  for (const fj of [...L.conceptsOfElement.keys()].sort()) {
    // Membership: compounds that list this element + is-a/part-of ancestors of its own concepts.
    const member = new Set(L.conceptsOfElement.get(fj));
    addAncestors(member, ownConcepts.get(fj) ?? []);

    const objFile = objDirs.map((d) => path.join(d, `${fj}.obj`)).find((p) => fs.existsSync(p));
    const hdr = objFile ? readObjHeader(objFile) : null;
    if (hdr?.concept && L.conceptName.has(hdr.concept)) {
      member.add(hdr.concept);
      addAncestors(member, [hdr.concept]);
    }

    // Names: OBJ header name, else own concept names, else the smallest compound containing it.
    let names = (ownConcepts.get(fj) ?? []).map((c) => L.conceptName.get(c));
    let label;
    if (hdr?.name) {
      names = [hdr.name];
      label = hdr.name;
    } else if (names.length) {
      label = [...names].sort((a, b) => b.length - a.length)[0];
    } else {
      const smallest = [...L.conceptsOfElement.get(fj)]
        .map((c) => [L.elementsOf.get(c).size, L.conceptName.get(c)])
        .sort((a, b) => a[0] - b[0] || b[1].length - a[1].length);
      const minSize = smallest[0][0];
      names = smallest.filter((x) => x[0] === minSize).map((x) => x[1]);
      label = `${names[0]} (part)`;
    }
    const text = names.join(' | ');
    const hit = ruleSets.find((r) => {
      if (r.exclude && r.exclude.test(text)) return false;
      if (r.match && r.matchOnly) return r.match.test(text);
      if ([...r.conceptSet].some((c) => member.has(c))) return true;
      return !!(r.match && r.match.test(text));
    });
    if (hit && hit.group !== 'drop') elements[fj] = { group: hit.group, label };
    else dropped.push({ fj, label, reason: hit ? hit.note : 'unclassified' });
  }
  return { elements, dropped, missingConcepts: [...missing] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawDir = process.argv[2];
  if (!rawDir) { console.error('usage: node scripts/classify.mjs <rawDir> [outJson] [objDir[,objDir2]]'); process.exit(1); }
  const out = process.argv[3] ?? path.join(rawDir, '..', 'classification.json');
  const res = classify(rawDir, (process.argv[4] ?? '').split(',').filter(Boolean));
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const counts = {};
  for (const { group } of Object.values(res.elements)) counts[group] = (counts[group] ?? 0) + 1;
  console.log('elements per group:', counts);
  console.log('missing concept ids:', res.missingConcepts);
  console.log(`dropped ${res.dropped.length}:`);
  for (const d of res.dropped) console.log(`  ${d.fj}\t${d.label}\t[${d.reason}]`);
  console.log('wrote', out);
}
