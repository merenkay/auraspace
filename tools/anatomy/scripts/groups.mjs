// Group definitions for the BodyParts3D -> GLB pipeline.
//
// Classification is driven by FMA concept IDs from the official BodyParts3D 4.0
// list files (is-a + part-of trees) plus name patterns on each element's OBJ
// header ('# English name'). RULES are tested in order; the first match wins.
// Elements matching no rule, or a 'drop' rule, are left out and reported.
// `budget` is the triangle budget per merged group mesh after simplification.

/** Output groups (one merged mesh each), in scene order. */
export const GROUPS = [
  // name            layer        system        label                              color (sRGB)  triangle budget
  { name: 'sys_bones',      layer: 'skeleton', system: 'bones',      label: 'Skeleton',                          color: '#e6dcc3', roughness: 0.65, budget: 160000 },
  { name: 'sys_brain',      layer: 'organs',   system: 'brain',      label: 'Brain',                             color: '#e3a9a6', roughness: 0.6,  budget: 34000 },
  { name: 'sys_eyes',       layer: 'organs',   system: 'eyes',       label: 'Eyes',                              color: '#f1efe8', roughness: 0.3,  budget: 6000 },
  { name: 'sys_heart',      layer: 'organs',   system: 'heart',      label: 'Heart',                             color: '#a3312c', roughness: 0.45, budget: 32000 },
  { name: 'sys_lungs',      layer: 'organs',   system: 'lungs',      label: 'Lungs & Airways',                   color: '#e19b97', roughness: 0.7,  budget: 30000 },
  { name: 'sys_metabolism', layer: 'organs',   system: 'metabolism', label: 'Digestive & Metabolic Organs',      color: '#c97f63', roughness: 0.55, budget: 48000 },
  { name: 'sys_renal',      layer: 'organs',   system: 'renal',      label: 'Kidneys & Urinary Tract',           color: '#8f3b37', roughness: 0.5,  budget: 8000 },
  { name: 'sys_immune',     layer: 'organs',   system: 'immune',     label: 'Spleen & Thymus (Immune)',          color: '#7a3d5e', roughness: 0.55, budget: 4000 },
  { name: 'sys_arteries',   layer: 'arteries', system: 'arteries',   label: 'Arteries',                          color: '#c42b2b', roughness: 0.4,  budget: 66000 },
  { name: 'sys_veins',      layer: 'veins',    system: 'veins',      label: 'Veins',                             color: '#2f5aa8', roughness: 0.4,  budget: 45000 },
  { name: 'sys_nerves',     layer: 'nerves',   system: 'nerves',     label: 'Nerves & Spinal Cord',              color: '#f0cf4f', roughness: 0.5,  budget: 10000 },
  { name: 'sys_muscles',    layer: 'muscles',  system: 'muscles',    label: 'Skeletal Muscles',                  color: '#b4473f', roughness: 0.6,  budget: 110000 },
  { name: 'sys_skin',       layer: 'skin',     system: 'skin',       label: 'Skin',                              color: '#dfb498', roughness: 0.7,  budget: 30000 },
];

/** Top-level layer nodes, in scene order. */
export const LAYERS = [
  { name: 'layer_skeleton', layer: 'skeleton', label: 'Skeleton' },
  { name: 'layer_organs',   layer: 'organs',   label: 'Organs' },
  { name: 'layer_arteries', layer: 'arteries', label: 'Arteries' },
  { name: 'layer_veins',    layer: 'veins',    label: 'Veins' },
  { name: 'layer_nerves',   layer: 'nerves',   label: 'Nerves' },
  { name: 'layer_muscles',  layer: 'muscles',  label: 'Muscles' },
  { name: 'layer_skin',     layer: 'skin',     label: 'Skin' },
];

/**
 * Ordered classification rules: { group, concepts, match, note }.
 *  - concepts: FMA ids; an element matches if it is an element of the compound
 *    (official *_element_parts.txt) or one of its own concepts descends from it
 *    (official *_inclusion_relation_list.txt, is-a + part-of).
 *  - match: optional regex tested against the element's own English names.
 *  - exclude: optional regex; if it matches the element name the rule is skipped.
 * First matching rule wins. 'drop' discards the element on purpose.
 */
export const RULES = [
  // Deliberate drops: envelopes / spaces that would hide what is inside, hair, genitals, glands with no target group.
  { group: 'drop', note: 'fascia, dura, CSF spaces, hair, raphe (envelopes / non-structural)', matchOnly: true,
    match: /investing fascia|dura mater|tentorium|falx|subarachnoid|conduit space|foramen|fossa|\bhairs?\b|eyebrow|raphe/i },
  { group: 'drop', note: 'genital system (no target group)',
    match: /genital|penis|testis|epididym|deferent duct|seminal vesicle|prostate/i, exclude: /pudendal/i },
  { group: 'drop', note: 'adrenal glands (endocrine; no target group)', match: /adrenal gland/i },
  { group: 'drop', note: 'lacrimal apparatus, eyelid tarsal plates, orbital ligaments', match: /lacrimal|nasolacrimal|tarsal plate|check ligament|common tendinous ring/i, exclude: /bone|nerve/i },

  { group: 'sys_skin', concepts: ['FMA7163' /* skin */], match: /^external ear$|^lip$/i, note: 'body surface, external ears, lips' },
  // Heart first so coronary vessels, valves and papillary muscles stay with the heart.
  { group: 'sys_heart', concepts: ['FMA7088' /* heart */, 'FMA86212' /* region of wall of heart */], note: 'heart incl. coronary vessels on its surface' },
  { group: 'sys_brain', concepts: ['FMA50801' /* brain */, 'FMA79876' /* brainstem */, 'FMA55676' /* segment of brain */],
    match: /cerebr|cerebell|thalam|caudate nucleus|putamen|globus pallidus|amygdala|fornix|corpus callosum|commissure|colliculus|geniculate|gyrus|lobule|stria|septum of telencephalon|pituitary|lamina terminalis|lamina of cerebral|mammillary|diencephalon|midbrain|ventricular system|pons|medulla oblongata|insula|hippocamp|lobe$/i,
    exclude: /artery|arterial|vein|venous|nerve/i,
    note: 'cerebrum, deep nuclei, cerebellum, brainstem, pituitary' },
  { group: 'sys_eyes', concepts: ['FMA12514' /* right eyeball */, 'FMA12515' /* left eyeball */, 'FMA58101' /* layer of wall of eyeball */, 'FMA225818' /* region of layer of wall of eyeball */],
    match: /\bretina\b|corona ciliaris|chamber of .*eyeball|cornea|sclera|\blens\b|vitreous|\biris\b|choroid/i, exclude: /nerve|artery|vein|retinaculum/i,
    note: 'eyeballs incl. internal structures' },
  { group: 'sys_nerves', concepts: ['FMA7647' /* spinal cord */, 'FMA65132' /* nerve */, 'FMA5865' /* cranial nerve */, 'FMA5913' /* nerve trunk */, 'FMA50863' /* optic nerve */, 'FMA5884' /* ganglion */],
    match: /nerve|nervous system|ganglion|spinal cord/i, note: 'spinal cord + every nerve element present in BP3D' },
  { group: 'sys_veins', concepts: ['FMA50723' /* vein */, 'FMA86188' /* segment of venous tree organ */],
    match: /\bveins?\b|\bvenous\b|\bvena\b|\bsinus\b/i, exclude: /hepatovenous|paranasal|sinus of|sphenoidal sinus|frontal sinus|maxillary sinus/i, note: 'all veins (systemic, pulmonary, portal)' },
  { group: 'sys_arteries', concepts: ['FMA50720' /* artery */, 'FMA86187' /* segment of arterial tree organ */],
    match: /arter|aorta|aortic|palmar arch|branch of arch of aorta|oesophageal branches/i, note: 'all arteries (systemic, pulmonary, cerebral)' },
  // Teeth read as part of the skull.
  { group: 'sys_bones', concepts: ['FMA12516' /* tooth */, 'FMA5018' /* bone organ */], note: 'teeth and every bone organ (e.g. mandible, hyoid) before organ rules' },
  { group: 'sys_lungs', concepts: ['FMA7309' /* right lung */, 'FMA7310' /* left lung */, 'FMA7394' /* trachea */, 'FMA7393' /* tracheobronchial tree */, 'FMA55108' /* laryngeal cartilage */],
    match: /lung|bronch|trachea|laryn|vocal ligament|conus elasticus|thyrohyoid membrane|thyrohyoid ligament|cricothyroid ligament|epiglott(?!icus)/i,
    note: 'lung parenchyma, bronchial tree, trachea, larynx' },
  { group: 'sys_muscles', concepts: ['FMA5022' /* muscle organ */, 'FMA10474' /* zone of muscle organ */, 'FMA85453' /* head of muscle organ */, 'FMA9721' /* tendon */, 'FMA13295' /* diaphragm */],
    match: /muscle|head of |part of (right|left) (deltoid|trapezius|pectoralis|longus colli)|vastus|rectus femoris|interossei|lumbricals|levatores|intertransversarii|interspinales|longus colli|coccygeus|puborectalis|aryepiglotticus|cricothyroid|tendon|retinaculum|linea alba|iliotibial tract|aponeurosis/i,
    note: 'skeletal muscles, tendons, retinacula, linea alba, iliotibial tract, diaphragm' },
  { group: 'sys_renal', concepts: ['FMA7159' /* urinary system */, 'FMA7203' /* kidney */, 'FMA9704' /* ureter */, 'FMA15900' /* urinary bladder */],
    match: /kidney|ureter|urinary|urethra/i, note: 'kidneys, ureters, bladder' },
  { group: 'sys_immune', concepts: ['FMA7196' /* spleen */, 'FMA9607' /* thymus */, 'FMA71193' /* lobe of thymus */],
    match: /spleen|thymus|tonsil|lymph/i, note: 'spleen, thymus' },
  { group: 'sys_metabolism', concepts: ['FMA7152' /* alimentary system */, 'FMA71132' /* gastrointestinal tract */, 'FMA7197' /* liver */, 'FMA7148' /* stomach */, 'FMA7198' /* pancreas */, 'FMA7202' /* gallbladder */, 'FMA7131' /* esophagus */, 'FMA7200' /* small intestine */, 'FMA7201' /* large intestine */, 'FMA14665' /* biliary tree */, 'FMA265228' /* pancreaticobiliary system */, 'FMA9597' /* salivary gland */],
    match: /liver|hepat|biliary|bile|duct of .*lobe|gallbladder|pancrea|stomach|gastr|duoden|jejun|ile(um|al)|cecum|caecum|colon|rect(um|al)|appendix|intestin|esophag|oesophag|pharyn|salivary|sublingual|parotid|submandibular|tongue|mouth/i,
    note: 'GI tract, liver, pancreas, gallbladder, biliary tree, salivary glands, pharynx' },
  { group: 'sys_bones', concepts: ['FMA5018' /* bone organ */, 'FMA23881' /* skeletal system */, 'FMA55107' /* cartilage organ */, 'FMA10446' /* intervertebral disk */, 'FMA25624' /* skeletal ligament */, 'FMA54839' /* interosseous membrane */],
    match: /bone|vertebra|\bribs?\b|sternum|cartilage|skull|ligament|membrane|meniscus|\bdis[ck]\b/i,
    note: 'bones, cartilages, intervertebral disks, skeletal ligaments' },
];
