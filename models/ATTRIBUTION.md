# Attribution: 3D human anatomy model

`body.glb` and `body-manifest.json` in this folder are derived from **BodyParts3D**,
made by the Database Center for Life Science (DBCLS), Japan.

## Required credit

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan

Show this line where users can see it, for example in the app's credits/about panel or
next to the 3D viewer.

- Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
  - Release 4.0 data (2013-06-19): https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/
    (`isa_BP3D_4.0_obj_99.zip`, `partof_BP3D_4.0_obj_99.zip` and the parts/element list files)
  - Release 3.0 data (2011-09-15), used only for the five lung-lobe surfaces:
    https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/ (`BodyParts3D_3.0_obj_99.zip`)
- License: Creative Commons Attribution-Share Alike 2.1 Japan,
  https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en
- Reference: Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K.
  *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Res. 2009;37:D782–D785. PMID 18835852.

### License note

The OBJ files (releases 3.0 and 4.0) state CC BY-SA 2.1 Japan in their headers, and that is the
license this derivative is distributed under. On 2025-02-27, DBCLS changed the license page of the
database to Creative Commons Attribution 4.0 International, with the credit line
"BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
(https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Distributing the derivative under
CC BY-SA 2.1 JP with the credit above meets both the old and the new terms.

## This is a modified derivative work

`body.glb` is **not** the original data. It was converted, merged and simplified with the
reproducible pipeline in `tools/anatomy/` of this repository:

- converted from Wavefront OBJ to glTF 2.0 binary (GLB)
- rotated and scaled from the BodyParts3D frame (mm, +Z superior, −Y anterior) to metres, +Y up,
  +Z anterior, re-centred on X/Z with the soles at y = 0
- 2,182 release-4.0 element meshes and 5 release-3.0 lung lobes merged into 13 system meshes; the
  3.0 lobes are shrunk by 5% about each lung's centroid so they fit inside the 4.0 rib cage
- 52 elements omitted: hair, eyebrows, tentorium cerebelli, CSF spaces, genital organs, adrenal glands,
  lacrimal apparatus, eyelid tarsal plates, orbital check ligaments, raphes
- welded, then simplified with meshoptimizer (about 6.5 M to about 0.6 M triangles); normals recomputed
- quantized (KHR_mesh_quantization) and compressed (EXT_meshopt_compression)
- plain PBR materials with illustrative colours added
- **added geometry that is not part of BodyParts3D:** an approximate spinal-cord tube in `sys_nerves`,
  generated along the vertebral canal of the BodyParts3D spine (BodyParts3D 4.0 has no spinal-cord mesh)

This derivative is distributed under the same license, CC BY-SA 2.1 JP. If you change it and
share the result, keep the credit line above, say that you changed it, and share it under the same license.

DBCLS does not endorse this app. BodyParts3D states that its data may still contain errors, so
use the model for illustration only, not for diagnosis.
