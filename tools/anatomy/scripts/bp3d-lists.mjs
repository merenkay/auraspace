// Parses the BodyParts3D 4.0 tab-separated list files (is-a and part-of trees).
// Pure data parsing; never executes anything from the download folder.
import fs from 'node:fs';
import path from 'node:path';

function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  lines.shift(); // header
  return lines.map((l) => l.split('\t').map((s) => s.trim()));
}

/**
 * Loads both trees. Returns:
 *  conceptName: Map<FMA, name>
 *  elementsOf:  Map<FMA, Set<FJ>>  (compound -> element mesh files), per tree merged
 *  conceptsOfElement: Map<FJ, Set<FMA>>
 *  ownNames: Map<FJ, string[]>  names of concepts represented by exactly that one element
 */
export function loadLists(rawDir) {
  const conceptName = new Map();
  const elementsOf = new Map();
  const tree = { isa: new Map(), partof: new Map() };
  for (const t of ['isa', 'partof']) {
    for (const [id, , en] of readTsv(path.join(rawDir, `${t}_parts_list_e.txt`))) {
      if (en && !conceptName.has(id)) conceptName.set(id, en);
    }
    for (const [id, name, fj] of readTsv(path.join(rawDir, `${t}_element_parts.txt`))) {
      if (!conceptName.has(id)) conceptName.set(id, name);
      for (const m of [elementsOf, tree[t]]) {
        if (!m.has(id)) m.set(id, new Set());
        m.get(id).add(fj);
      }
    }
  }
  const conceptsOfElement = new Map();
  for (const [id, set] of elementsOf) {
    for (const fj of set) {
      if (!conceptsOfElement.has(fj)) conceptsOfElement.set(fj, new Set());
      conceptsOfElement.get(fj).add(id);
    }
  }
  const ownNames = new Map();
  for (const [id, set] of elementsOf) {
    if (set.size !== 1) continue;
    const [fj] = set;
    if (!ownNames.has(fj)) ownNames.set(fj, []);
    const n = conceptName.get(id);
    if (!ownNames.get(fj).includes(n)) ownNames.get(fj).push(n);
  }
  return { conceptName, elementsOf, tree, conceptsOfElement, ownNames };
}
