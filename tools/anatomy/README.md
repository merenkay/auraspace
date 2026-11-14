# Anatomy model pipeline (BodyParts3D to GLB)

This offline tool builds `public/models/body.glb`, `public/models/body-manifest.json` and the
preview checks from the open **BodyParts3D** dataset (DBCLS, CC BY-SA 2.1 JP; see
`public/models/ATTRIBUTION.md`). It is separate from the app: it has its own `package.json`
and nothing here is bundled.

## Requirements

- Node 20+ (tested with Node 26)
- `unzip` (Git Bash ships it; `tar -xf` also works on Windows 10+)
- about 1.5 GB of free disk space in `.cache/` (git-ignored)

## Commands

Run from `tools/anatomy/`. Once the archives are extracted (steps 1 and 2), `npm run build`,
`npm run validate` and `npm run preview` wrap steps 4 to 6 with the default paths.

```bash
npm install

# 1. Download the official files (about 340 MB) into .cache/raw/.
#    They are data only; nothing in .cache is ever executed.
node scripts/download.mjs .cache/raw
#    (optional, for the lung-lobe surfaces that release 4.0 lacks; about 134 MB)
mkdir -p .cache/raw/v3 && curl -L -C - -o .cache/raw/v3/BodyParts3D_3.0_obj_99.zip \
  https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/BodyParts3D_3.0_obj_99.zip

# 2. Extract
unzip -q -o .cache/raw/isa_BP3D_4.0_obj_99.zip    -d .cache/raw/extracted
unzip -q -o .cache/raw/partof_BP3D_4.0_obj_99.zip -d .cache/raw/extracted
#    (the 3.0 zip uses backslash paths, so junk the paths and pick the 5 lobe files)
unzip -q -o -j .cache/raw/v3/BodyParts3D_3.0_obj_99.zip '*FMA7333.obj' '*FMA7383.obj' '*FMA7337.obj' \
  '*FMA7370.obj' '*FMA7371.obj' -d .cache/raw/v3/lungs

# 3. (optional) inspect the classification: per-group counts and every dropped element
node scripts/classify.mjs .cache/raw .cache/classification.json \
  .cache/raw/extracted/isa_BP3D_4.0_obj_99,.cache/raw/extracted/partof_BP3D_4.0_obj_99

# 4. Build public/models/body.glb + body-manifest.json (about 1 min)
node --max-old-space-size=8192 scripts/build.mjs \
  --raw .cache/raw \
  --obj .cache/raw/extracted/isa_BP3D_4.0_obj_99,.cache/raw/extracted/partof_BP3D_4.0_obj_99 \
  --lungs-v3 .cache/raw/v3/lungs \
  --out ../../public/models
#    add --split to write body.glb (skeleton, organs, muscles, skin) and body-detail.glb
#    (arteries, veins, nerves) separately; --scale 0.8 scales every triangle budget;
#    --no-spinal-cord skips the generated spinal-cord tube.

# 5. Validate: load the GLB back, print the hierarchy, triangles, bounds, size and orientation checks
node scripts/validate.mjs ../../public/models/body.glb

# 6. (optional) software-rendered preview PNGs for a visual check
node scripts/render-preview.mjs .cache/preview ../../public/models/body.glb
SETS=nerves+veins node scripts/render-preview.mjs .cache/preview ../../public/models/body.glb
```

`build.mjs` also writes `.cache/build-report.json`, which lists every element per group,
the dropped elements, the landmark coordinates and the orientation checks.

## What the scripts do

| file | purpose |
| --- | --- |
| `scripts/download.mjs` | fetches the release 4.0 lists and OBJ zips from `dbarchive.biosciencedbc.jp` |
| `scripts/bp3d-lists.mjs` | parses the is-a / part-of parts lists, element lists and inclusion lists |
| `scripts/groups.mjs` | **output groups** (node name, layer, label, colour, triangle budget) and the ordered **classification rules** |
| `scripts/classify.mjs` | assigns every `FJxxxx.obj` element to a group using FMA concept membership, ancestors and the OBJ header name |
| `scripts/obj.mjs` | minimal OBJ reader (`v`, `vn`, `f`, header comments) |
| `scripts/spinal-cord.mjs` | generates the approximate spinal cord, because BodyParts3D has none |
| `scripts/build.mjs` | load, weld, change coordinates, simplify, merge per group, write GLB + manifest |
| `scripts/validate.mjs` | reads the GLB(s) back with `@gltf-transform/core` + `MeshoptDecoder` and checks them |
| `scripts/render-preview.mjs` | orthographic z-buffer renderer that writes PNG previews |
| `scripts/check-lung-fit.mjs` | diagnostic: how well the 3.0 lung lobes fit the 4.0 ribs and bronchi, for several shrink factors |

## Current output (default budgets)

`public/models/body.glb` is 2.34 MB with 582,322 triangles. It holds 13 mesh nodes under
7 layer nodes, built from 2,187 source elements (about 6.59 M triangles).

| node | triangles | source elements |
| --- | ---: | ---: |
| sys_bones | 160,000 | 286 |
| sys_brain | 33,996 | 103 |
| sys_eyes | 6,000 | 22 |
| sys_heart | 32,000 | 84 |
| sys_lungs | 30,000 | 128 (incl. 5 lobes from 3.0) |
| sys_metabolism | 48,000 | 108 |
| sys_renal | 8,000 | 6 |
| sys_immune | 3,410 | 3 |
| sys_arteries | 65,996 | 581 |
| sys_veins | 45,000 | 384 |
| sys_nerves | 9,996 | 41 + generated spinal cord |
| sys_muscles | 110,000 | 438 |
| sys_skin | 29,924 | 3 (skin, external ears, lips) |

To change the level of detail, edit `budget` in `scripts/groups.mjs` or pass `--scale`, then
rebuild. The 10 MB file budget leaves a lot of room; the triangle count is the real limit.

## Using it in the app (three.js / R3F)

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const url = `${import.meta.env.BASE_URL}models/body.glb`; // vite base is './'
// drei: useGLTF(url, false)  -> no Draco needed; drei sets MeshoptDecoder by default
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // plain three.js
```

Toggle layers through `scene.getObjectByName('layer_veins').visible`. Each `sys_*` mesh has
`userData = { system, layer, label }`, which you can use for picking. Node transforms carry
the quantization scale and offset, so do not reset them.

### Coordinate change

BodyParts3D uses millimetres with +X to the subject's left, +Y posterior and +Z superior.
The output is `(x, y, z) to (x, z, -y) / 1000`, a −90° rotation about X with no mirroring. The
result uses metres, +Y up, +Z anterior (the body faces +Z) and +X the subject's left. It is
then translated so the bounding box is centred on X/Z and the soles touch y = 0.

### Simplification

Each element is simplified separately with `meshoptimizer` (`simplify`, absolute error).
The allowed error is `relErr × elementScale`, where `elementScale` is the geometric mean of the
element's bounding-box diagonal and its thickness (6·volume/area). Thin vessels and small bones
therefore keep their shape. For each group, `relErr` is binary-searched so the group fits its
triangle budget in `groups.mjs`. Duplicate vertices are welded and the vertex buffer is compacted
before simplification; otherwise meshoptimizer locks the seams and stops early.

### Gaps in the dataset (handled in the pipeline)

- **No lung surfaces in release 4.0.** It ships only the segmental bronchial trees and the
  pulmonary vessels. With `--lungs-v3`, the five lobe surfaces from release 3.0 are added to `sys_lungs`.
- **No spinal cord or peripheral nerves.** BodyParts3D 4.0 only has the orbital and optic nerves,
  the ciliary ganglia and a 36 mm piece of the central canal. `spinal-cord.mjs` adds an
  approximate cord: a tube running from the bottom of the BP3D medulla oblongata, just behind
  each BP3D intervertebral disk, down to L1/L2, with textbook radii. The manifest marks it as generated.
- No lymph nodes, thyroid gland or skin appendages beyond hair, so `sys_immune` contains only the spleen and thymus.
