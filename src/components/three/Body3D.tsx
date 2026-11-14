// Realistic 3D anatomy viewer (BodyParts3D-derived GLB). Loaded lazily; see BodyViewer for the fallback.
//
// Picking policy (see `rankHits`): every pointer position is resolved by casting rays through ALL visible
// layers (BVH accelerated, about 0.05 ms per ray) and ranking what lies along them, instead of taking the
// nearest mesh. Hover and click share the same resolver, so the tooltip always names what a click selects.
import { PerformanceMonitor, useGLTF } from '@react-three/drei'
import { createRoot, extend, useFrame, useThree, type ReconcilerRoot } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { BvhJob, BvhReply } from './bvh.worker'
import { BVH_OPTIONS } from './bvhOptions'
import type { SystemId } from '../../data/systems'
import { STATUS_COLOR, type Status } from '../../data/vitals'
import { DEV_HOOKS } from '../../lib/devHooks'

export const NODE_SYSTEM: Record<string, SystemId> = {
  sys_heart: 'heart',
  sys_arteries: 'heart',
  sys_veins: 'heart',
  sys_lungs: 'lungs',
  sys_brain: 'brain',
  sys_nerves: 'brain',
  sys_eyes: 'eyes',
  sys_metabolism: 'metabolism',
  sys_renal: 'renal',
  sys_immune: 'immune',
  sys_bones: 'bones',
  sys_muscles: 'bones',
  sys_skin: 'radiation',
}

export type LayerId = 'skin' | 'muscles' | 'skeleton' | 'organs' | 'arteries' | 'veins' | 'nerves'

export const LAYER_NODES: Record<LayerId, string[]> = {
  skin: ['sys_skin'],
  muscles: ['sys_muscles'],
  skeleton: ['sys_bones'],
  organs: ['sys_brain', 'sys_eyes', 'sys_heart', 'sys_lungs', 'sys_metabolism', 'sys_renal', 'sys_immune'],
  arteries: ['sys_arteries'],
  veins: ['sys_veins'],
  nerves: ['sys_nerves'],
}

const NODE_LAYER: Record<string, LayerId> = Object.fromEntries(
  (Object.entries(LAYER_NODES) as [LayerId, string[]][]).flatMap(([layer, nodes]) => nodes.map((n) => [n, layer])),
)

// The mesh that stands for a system. It is shown while that system is selected even if its layer is switched off.
const PRIMARY_NODE: Record<SystemId, string> = {
  brain: 'sys_brain',
  eyes: 'sys_eyes',
  heart: 'sys_heart',
  lungs: 'sys_lungs',
  metabolism: 'sys_metabolism',
  immune: 'sys_immune',
  bones: 'sys_bones',
  renal: 'sys_renal',
  radiation: 'sys_skin',
}

const BASE_COLOR: Record<string, string> = {
  sys_bones: '#e9dfc9',
  sys_muscles: '#b9574d',
  sys_skin: '#7fd4f0',
  sys_heart: '#c8372d',
  sys_lungs: '#e9a3a0',
  sys_brain: '#eab8bb',
  sys_eyes: '#f4f4f4',
  sys_metabolism: '#a8573a',
  sys_renal: '#8f3a48',
  sys_immune: '#8a5cc2',
  sys_arteries: '#e0362f',
  sys_veins: '#3f6ae0',
  sys_nerves: '#f5d547',
}

const SHELLS = new Set(['sys_skin', 'sys_muscles'])

// ---------------------------------------------------------------------------------------------------------
// Picking policy
// ---------------------------------------------------------------------------------------------------------
// organ: a solid organ, the thing people point at.
// cage:  opaque structure that wraps organs (skeleton, vessels, nerves, or a shell drawn solid).
// shell: translucent wrapper (muscle and skin layers in their normal see-through mode).
type PickKind = 'organ' | 'cage' | 'shell'

const NODE_KIND: Record<string, PickKind> = {
  sys_brain: 'organ',
  sys_eyes: 'organ',
  sys_heart: 'organ',
  sys_lungs: 'organ',
  sys_metabolism: 'organ',
  sys_renal: 'organ',
  sys_immune: 'organ',
  sys_bones: 'cage',
  sys_arteries: 'cage',
  sys_veins: 'cage',
  sys_nerves: 'cage',
  sys_muscles: 'shell',
  sys_skin: 'shell',
}

// Small organs outrank the big ones they hide behind or sit next to (the same idea as padding a small button).
const SPECIFICITY: Record<string, number> = {
  sys_eyes: 4,
  sys_heart: 3,
  sys_immune: 3,
  sys_renal: 3,
  sys_brain: 2,
  sys_lungs: 1,
  sys_metabolism: 1,
}
const MAX_SPECIFICITY = 4
const THIN_NETWORK = new Set(['sys_arteries', 'sys_veins', 'sys_nerves'])

/** An organ at most this far (metres) behind the first bone or vessel on the ray is "directly behind the cage". */
export const CAGE_DEPTH = 0.06
/** A more specific organ at most this far (metres) behind the first organ on the ray wins (thin lung edge over the heart). */
export const THIN_COVER = 0.03

export type RayHit = { node: string; kind: PickKind; d: number }

/**
 * Orders everything a ray passes through, best pick first:
 * 1. Organs beat the cage in front of them (ribs, skull, vessels) when they lie within CAGE_DEPTH of it;
 *    among organs the front-most wins, unless a more specific one starts within THIN_COVER behind it.
 * 2. Otherwise the opaque surface that is actually seen wins (arm bone in front of the chest, spine from behind);
 *    a bone at most THIN_COVER behind a vessel or nerve wins over that thin line.
 * 3. Translucent shells (muscle, skin) come last, so they only win where nothing else is under the pointer.
 * The rest of the list is what repeated clicks on the same spot step through.
 */
export function rankHits(hits: RayHit[]): RayHit[] {
  const of = (kind: PickKind) => hits.filter((h) => h.kind === kind).sort((a, b) => a.d - b.d)
  const organs = of('organ')
  const cage = of('cage')
  // the skin is the outermost catch-all: a muscle under the pointer comes before it
  const shells = of('shell').sort((x, y) => Number(x.node === 'sys_skin') - Number(y.node === 'sys_skin') || x.d - y.d)
  // a vessel or nerve is a thin line: the bone right behind it (shin, forearm) is what a click on that spot means
  if (cage.length > 1 && THIN_NETWORK.has(cage[0].node)) {
    const bulk = cage.find((c) => !THIN_NETWORK.has(c.node) && c.d - cage[0].d <= THIN_COVER)
    if (bulk) cage.unshift(...cage.splice(cage.indexOf(bulk), 1))
  }
  if (!organs.length) return [...cage, ...shells]
  const first = organs[0]
  let best = first
  for (const o of organs) {
    if (o.d - first.d <= THIN_COVER && (SPECIFICITY[o.node] ?? 0) > (SPECIFICITY[best.node] ?? 0)) best = o
  }
  const rest = organs.filter((o) => o !== best)
  const direct = !cage.length || best.d - cage[0].d <= CAGE_DEPTH
  return direct ? [best, ...rest, ...cage, ...shells] : [cage[0], best, ...rest, ...cage.slice(1), ...shells]
}

// pointer tolerances in CSS pixels
const CLICK_SLOP: Record<string, number> = { mouse: 5, pen: 8, touch: 12 }
// EDGE: a pointer just off the body (or over a see-through shell only) snaps to what is next to it.
// ORGAN: a pointer on a bone or a big organ snaps to a more specific organ this close (eyes, spleen, kidneys, heart).
// 'hand': the camera hand cursor (less precise than a finger on glass, so the most forgiving)
const EDGE_RADIUS: Record<string, number> = { mouse: 10, pen: 12, touch: 22, hand: 30 }
const ORGAN_RADIUS: Record<string, number> = { mouse: 4, pen: 6, touch: 12, hand: 18 }
const CYCLE_RADIUS: Record<string, number> = { mouse: 8, pen: 10, touch: 20, hand: 30 }
const RING: [number, number][] = Array.from({ length: 8 }, (_, i): [number, number] => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])

// ---------------------------------------------------------------------------------------------------------
// BVH cache: built once per loaded geometry (the loader caches the model for the lifetime of the page) and
// shared by every mount of the viewer. The builds run in a worker (bvh.worker.ts): the main thread only copies
// each mesh's position and index arrays out and gets the packed tree back (a 650 ms main-thread stall on the
// largest mesh before). Fallback without workers: one mesh per task on the main thread, as before.
// ---------------------------------------------------------------------------------------------------------
const bvhCache = new WeakMap<THREE.BufferGeometry, Promise<MeshBVH>>()
let bvhQueue: Promise<unknown> = Promise.resolve()
const bvhStats = { builds: 0, ms: 0, longest: 0, worker: 0 }

let bvhWorker: Worker | null | undefined
let bvhSeq = 0
const bvhWaiting = new Map<number, { resolve: (r: BvhReply & { ok: true }) => void; reject: (e: Error) => void }>()

function getBvhWorker(): Worker | null {
  if (bvhWorker !== undefined) return bvhWorker
  try {
    bvhWorker = typeof Worker === 'undefined' ? null : new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module', name: 'aura-bvh' })
  } catch {
    bvhWorker = null
  }
  if (bvhWorker) {
    bvhWorker.onmessage = (e: MessageEvent<BvhReply>) => {
      const w = bvhWaiting.get(e.data.id)
      bvhWaiting.delete(e.data.id)
      if (!w) return
      if (e.data.ok) w.resolve(e.data)
      else w.reject(new Error(e.data.error))
    }
    bvhWorker.onerror = () => {
      // the worker could not start (or died): everything waiting, and everything after, builds on the main thread
      bvhWorker?.terminate()
      bvhWorker = null
      for (const w of bvhWaiting.values()) w.reject(new Error('bvh worker failed'))
      bvhWaiting.clear()
    }
  }
  return bvhWorker
}

function buildInWorker(geometry: THREE.BufferGeometry): Promise<MeshBVH> | null {
  const worker = getBvhWorker()
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  if (!worker || !pos) return null
  const interleaved = (pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true
  // copy just this mesh's range (a typed-array view may sit inside the whole model's buffer)
  const array = (interleaved ? (pos as THREE.InterleavedBufferAttribute).data.array : (pos as THREE.BufferAttribute).array) as unknown as Float32Array
  const job: BvhJob = {
    id: ++bvhSeq,
    array: array.slice(),
    stride: interleaved ? (pos as THREE.InterleavedBufferAttribute).data.stride : pos.itemSize,
    offset: interleaved ? (pos as THREE.InterleavedBufferAttribute).offset : 0,
    itemSize: pos.itemSize,
    normalized: pos.normalized,
    interleaved,
    index: geometry.index ? (geometry.index.array as Uint32Array).slice() : null,
  }
  return new Promise<BvhReply & { ok: true }>((resolve, reject) => {
    bvhWaiting.set(job.id, { resolve, reject })
    worker.postMessage(job, [job.array.buffer, ...(job.index ? [job.index.buffer] : [])])
  }).then((r) => {
    bvhStats.builds++
    bvhStats.worker++
    bvhStats.ms += r.ms
    bvhStats.longest = Math.max(bvhStats.longest, r.ms)
    return MeshBVH.deserialize({ roots: r.roots, index: null as unknown as Uint32Array, indirectBuffer: r.indirectBuffer } as unknown as Parameters<typeof MeshBVH.deserialize>[0], geometry, { setIndex: false })
  })
}

function buildOnMainThread(geometry: THREE.BufferGeometry): Promise<MeshBVH> {
  const job = bvhQueue
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .then(() => {
      const t = performance.now()
      const tree = new MeshBVH(geometry, BVH_OPTIONS)
      const ms = performance.now() - t
      bvhStats.builds++
      bvhStats.ms += ms
      bvhStats.longest = Math.max(bvhStats.longest, ms)
      return tree
    })
  bvhQueue = job.catch(() => undefined)
  return job
}

function ensureBvh(geometry: THREE.BufferGeometry): Promise<MeshBVH> {
  let job = bvhCache.get(geometry)
  if (!job) {
    job = (buildInWorker(geometry) ?? buildOnMainThread(geometry)).catch(() => buildOnMainThread(geometry))
    bvhCache.set(geometry, job)
  }
  return job
}

// ---------------------------------------------------------------------------------------------------------
// Model instance (one per mounted viewer; geometry buffers and BVHs are shared with the loader cache)
// ---------------------------------------------------------------------------------------------------------
type NodeRec = {
  name: string
  system: SystemId
  layer: LayerId
  shell: boolean
  mesh: THREE.Mesh
  source: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  base: THREE.Color
  tree: MeshBVH | null
  inverse: THREE.Matrix4
  visible: boolean
  solid: boolean
}

type Instance = {
  root: THREE.Group
  recs: NodeRec[]
  materials: THREE.MeshStandardMaterial[]
  height: number
  radius: number
  centerY: Partial<Record<SystemId, number>>
  /** world-space centre and bounding radius of each system's primary mesh (for overlays that point at it) */
  anchors: Partial<Record<SystemId, { center: THREE.Vector3; radius: number }>>
}

const BODY_HEIGHT = 1.75

function sysNameOf(o: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = o
  while (cur) {
    if (cur.name && BASE_COLOR[cur.name]) return cur.name
    const extra = (cur.userData as { system?: string } | undefined)?.system
    if (extra && BASE_COLOR[`sys_${extra}`]) return `sys_${extra}`
    cur = cur.parent
  }
  return null
}

// A light geometry object that shares the loader's attribute buffers. Each viewer gets its own, so disposing
// one viewer's GPU buffers never touches another renderer and the cached model keeps no reference to a dead renderer.
function shareGeometry(source: THREE.BufferGeometry) {
  const g = new THREE.BufferGeometry()
  g.setIndex(source.index)
  for (const key of Object.keys(source.attributes)) g.setAttribute(key, source.attributes[key])
  for (const group of source.groups) g.addGroup(group.start, group.count, group.materialIndex)
  if (!source.boundingBox) source.computeBoundingBox()
  if (!source.boundingSphere) source.computeBoundingSphere()
  g.boundingBox = source.boundingBox!.clone()
  g.boundingSphere = source.boundingSphere!.clone()
  return g
}

function buildInstance(scenes: THREE.Object3D[]): Instance {
  const root = new THREE.Group()
  const recs: NodeRec[] = []
  const mats = new Map<string, THREE.MeshStandardMaterial>()
  // clone(true) copies the node hierarchy (node transforms carry the quantization scale/offset) and shares geometry
  for (const s of scenes) root.add(s.clone(true))
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const name = sysNameOf(mesh)
    if (!name) {
      mesh.visible = false
      return
    }
    const shell = SHELLS.has(name)
    let material = mats.get(name)
    if (!material) {
      // Always "transparent" with an explicit render order (see applyLooks): switching between solid, shell and
      // x-ray ghost then never needs a shader recompile, so selecting a system cannot cause a frame hitch.
      material = new THREE.MeshStandardMaterial({
        color: BASE_COLOR[name],
        roughness: name === 'sys_bones' ? 0.55 : 0.42,
        metalness: 0.05,
        transparent: true,
        opacity: 1,
        depthWrite: true,
        side: shell ? THREE.DoubleSide : THREE.FrontSide,
        emissive: new THREE.Color('#000000'),
        emissiveIntensity: 0,
      })
      mats.set(name, material)
    }
    const source = mesh.geometry
    mesh.geometry = shareGeometry(source)
    mesh.material = material
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.raycast = () => {} // picking goes through the BVH resolver below, never through the generic raycaster
    recs.push({
      name,
      system: NODE_SYSTEM[name],
      layer: NODE_LAYER[name],
      shell,
      mesh,
      source,
      material,
      base: new THREE.Color(BASE_COLOR[name]),
      tree: null,
      inverse: new THREE.Matrix4(),
      visible: true,
      solid: !shell,
    })
  })
  // fit: BODY_HEIGHT tall, centred on the vertical axis, soles on y = 0
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const r of recs) box.expandByObject(r.mesh)
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.2), new THREE.Vector3(0.5, BODY_HEIGHT, 0.2))
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = BODY_HEIGHT / Math.max(size.y, 0.001)
  root.scale.setScalar(scale)
  root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  root.updateMatrixWorld(true)
  const centerY: Partial<Record<SystemId, number>> = {}
  const anchors: Instance['anchors'] = {}
  const one = new THREE.Box3()
  for (const r of recs) {
    if (PRIMARY_NODE[r.system] !== r.name) continue
    one.setFromObject(r.mesh)
    centerY[r.system] = (one.min.y + one.max.y) / 2
    anchors[r.system] = { center: one.getCenter(new THREE.Vector3()), radius: one.getSize(new THREE.Vector3()).length() / 2 }
  }
  centerY.bones = BODY_HEIGHT / 2
  centerY.radiation = BODY_HEIGHT / 2
  // whole-body systems point at the trunk
  anchors.bones = { center: new THREE.Vector3(0, BODY_HEIGHT * 0.55, 0), radius: 0.25 }
  anchors.radiation = { center: new THREE.Vector3(0, BODY_HEIGHT * 0.62, 0), radius: 0.25 }
  return { root, recs, materials: [...mats.values()], height: BODY_HEIGHT, radius: (Math.max(size.x, size.z) * scale) / 2, centerY, anchors }
}

// ---------------------------------------------------------------------------------------------------------
// Ray casting against the instance
// ---------------------------------------------------------------------------------------------------------
const _rc = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _local = new THREE.Ray()
const _fwd = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _slow: THREE.Intersection[] = []
const _anchor = new THREE.Vector3()
const _anchorUp = new THREE.Vector3()
const pickStats = { rays: 0, picks: 0, ms: 0, last: 0, max: 0 }

/** What one ray (canvas pixel x, y) passes through, ranked. Only visible, selectable meshes take part. */
function castRanked(inst: Instance, camera: THREE.Camera, w: number, h: number, x: number, y: number, showRadiation: boolean): RayHit[] {
  _rc.setFromCamera(_ndc.set((x / w) * 2 - 1, -((y / h) * 2 - 1)), camera)
  const ray = _rc.ray
  // start at the near plane: geometry the camera has moved past is not drawn, so it must not be pickable
  camera.getWorldDirection(_fwd)
  const near = (camera as THREE.PerspectiveCamera).near ?? 0
  ray.origin.addScaledVector(ray.direction, near / Math.max(1e-6, ray.direction.dot(_fwd)))
  pickStats.rays++
  const hits: RayHit[] = []
  for (const rec of inst.recs) {
    if (!rec.visible) continue
    if (rec.system === 'radiation' && !showRadiation) continue
    let d = Infinity
    if (rec.tree) {
      _local.copy(ray).applyMatrix4(rec.inverse)
      const hit = rec.tree.raycastFirst(_local, THREE.FrontSide)
      if (hit) d = _pt.copy(hit.point).applyMatrix4(rec.mesh.matrixWorld).distanceTo(ray.origin)
    } else {
      // BVH not built yet (first second after the very first load): exact but slow fallback, used for clicks only
      _slow.length = 0
      THREE.Mesh.prototype.raycast.call(rec.mesh, _rc, _slow)
      for (const s of _slow) if (s.distance < d) d = s.distance
    }
    if (d < Infinity) hits.push({ node: rec.name, kind: rec.shell ? (rec.solid ? 'cage' : 'shell') : NODE_KIND[rec.name], d })
  }
  return rankHits(hits)
}

/**
 * Systems under a pointer, best first. With tolerances, rings of rays around the pointer are consulted too:
 * a more specific organ within `organRadius` takes the lead, and where the centre ray finds nothing solid
 * (empty space or only a see-through shell) the best target within `edgeRadius` does.
 */
function pickSystems(inst: Instance, camera: THREE.Camera, w: number, h: number, x: number, y: number, organRadius: number, edgeRadius: number, showRadiation: boolean): SystemId[] {
  const t0 = performance.now()
  for (const rec of inst.recs) rec.inverse.copy(rec.mesh.matrixWorld).invert()
  const center = castRanked(inst, camera, w, h, x, y, showRadiation)
  let lead: string | null = center[0]?.node ?? null
  let leadSpec = lead ? (SPECIFICITY[lead] ?? 0) : -1
  const open = !center[0] || center[0].kind === 'shell'
  for (const radius of open ? [organRadius, edgeRadius] : [organRadius]) {
    if (radius <= 0 || leadSpec >= MAX_SPECIFICITY) continue
    for (const [dx, dy] of RING) {
      const near = castRanked(inst, camera, w, h, x + dx * radius, y + dy * radius, showRadiation)[0]
      if (!near || (near.kind === 'shell' && center[0])) continue
      const spec = SPECIFICITY[near.node] ?? 0
      if (spec > leadSpec) {
        lead = near.node
        leadSpec = spec
      }
    }
  }
  const out: SystemId[] = []
  const push = (node: string | null) => {
    const sys = node ? NODE_SYSTEM[node] : undefined
    if (sys && !out.includes(sys)) out.push(sys)
  }
  push(lead)
  for (const hit of center) push(hit.node)
  const ms = performance.now() - t0
  pickStats.picks++
  pickStats.ms += ms
  pickStats.last = ms
  pickStats.max = Math.max(pickStats.max, ms)
  return out
}

// ---------------------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------------------
export type HoverMeta = {
  /** the next click steps to this system because the same spot was just clicked */
  cycling: boolean
  /** how many systems lie under the pointer */
  count: number
}

/** A system's centre on screen, relative to the canvas (CSS pixels); `r` is its approximate radius in pixels. */
export type ViewerAnchor = { x: number; y: number; r: number }

/**
 * Imperative control of the viewer for other input methods (buttons, hand control). Client coordinates are
 * viewport pixels, as in a PointerEvent. None of these change what the mouse and touch handlers do.
 */
export type ViewerControls = {
  zoom: (direction: 1 | -1) => void
  reset: () => void
  /** rotate as a drag of (dx, dy) canvas pixels would */
  rotateBy: (dx: number, dy: number) => void
  /** multiply the camera distance (< 1 moves closer), keeping the body height under clientY in place */
  zoomBy: (factor: number, clientY?: number) => void
  /** select what a click at this point would select (same ranked resolver, hand-cursor tolerances); returns it */
  pickAt: (clientX: number, clientY: number) => SystemId | null
  /** hover feedback (highlight + tooltip) for the system a pick at this point would select; null clears it */
  hoverAt: (clientX: number | null, clientY?: number) => void
  /** the system highlighted by the hover right now (what a pick at the hover point would select) */
  hovered: () => SystemId | null
  /** where a system is on screen right now, or null when it is behind the camera */
  anchor: (id: SystemId) => ViewerAnchor | null
}

export type Body3DProps = {
  files: string[]
  layers: Record<LayerId, boolean>
  statuses: Record<SystemId, Status>
  selected: SystemId | null
  onSelect: (id: SystemId) => void
  autoRotate: boolean
  /** id is what a click at (x, y) would select; x, y are relative to the canvas */
  onHover: (id: SystemId | null, x?: number, y?: number, meta?: HoverMeta) => void
  /** the user rotated, panned or zoomed the view */
  onInteract: () => void
  /** optional highlight driven from outside (for example a hovered list row) */
  hovered?: SystemId | null
  /** fade everything except the selected system (default true) */
  xray?: boolean
  /** false: the skin layer cannot select 'radiation' */
  showRadiation?: boolean
  /** pixels at the top and bottom of the canvas covered by overlay controls; the body is framed between them */
  insets?: { top: number; bottom: number }
  reducedMotion?: boolean
  onReady?: () => void
  /** the WebGL context was lost and did not come back */
  onLost?: () => void
  /** the user scrolled over the viewer without Ctrl (the page scrolls; zoom needs Ctrl or a pinch) */
  onZoomHint?: () => void
  controlsRef?: RefObject<ViewerControls | null>
  /** lighter rendering while camera hand control runs: pixel ratio 1 and at most 30 frames a second */
  lowPower?: boolean
  /** called after a frame in which the camera moved (or the canvas resized), for overlays that track a system */
  onView?: () => void
}

// neutral highlight (the ink token); status colours come from STATUS_COLOR
const NEUTRAL_GLOW = '#F3F0EA'
const GHOST_TINT = new THREE.Color('#a39f97')
const FOV = 38
const POLAR_HOME = 1.5
const POLAR_MIN = 0.5
const POLAR_MAX = Math.PI - 0.6
const MIN_DIST = 0.8
const TAN_HALF_FOV = Math.tan((FOV * Math.PI) / 360)
const SPIN_SPEED = 0.115 // rad/s, one turn in about 55 s
const IDLE_BEFORE_SPIN = 3500 // ms without interaction before auto-rotation resumes

type View = { az: number; pol: number; dist: number; ty: number }
type Gesture = { id: number; type: string; x0: number; y0: number; x: number; y: number; moved: boolean; multi: boolean; pan: boolean; pinch: number; pinchDist: number; midY: number }
type HoverHit = { id: SystemId; list: SystemId[]; index: number; cycling: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type ModelProps = Body3DProps & { /** a new mount of the viewer reusing this (pooled) renderer */ session: number }

function Model(props: ModelProps) {
  const loaded = useGLTF(props.files, false) as unknown as { scene: THREE.Group } | { scene: THREE.Group }[]
  const scenes = (Array.isArray(loaded) ? loaded : [loaded]).map((g) => g.scene)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inst = useMemo(() => buildInstance(scenes), [props.files.join('|')])
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)

  const live = useRef(props)
  live.current = props
  const sizeRef = useRef(size)
  sizeRef.current = size

  const st = useRef({
    view: { az: 0, pol: POLAR_HOME, dist: 3.4, ty: BODY_HEIGHT / 2 } as View,
    goal: { az: 0, pol: POLAR_HOME, dist: 3.4, ty: BODY_HEIGHT / 2 } as View,
    home: 3.4,
    maxDist: 5.5,
    spin: 0,
    idleUntil: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    gesture: null as Gesture | null,
    inside: false,
    pointer: null as { x: number; y: number; type: string } | null,
    hoverDirty: false,
    hover: null as HoverHit | null,
    cycle: null as { x: number; y: number; list: SystemId[]; index: number } | null,
    tap: null as { x: number; y: number; type: string; at: number } | null,
    bvhReady: false,
    frames: 0,
    time: 0,
    readySent: false,
    viewDirty: true,
    /** shaders compiled (asynchronously, before the first picture) */
    compiled: false,
    /** what the last drawn picture depended on: a frame with the same values is not drawn again */
    sig: [] as number[],
    drawnAt: 0,
    pendingMinor: false,
    session: props.session,
  }).current

  // The renderer is pooled (see Body3D below): a new visit to the page re-uses this mounted scene. Start it like a
  // fresh mount: home view, nothing hovered, ready reported again once it has drawn.
  useLayoutEffect(() => {
    if (st.session === props.session) return
    st.session = props.session
    Object.assign(st.view, { az: 0, pol: POLAR_HOME, dist: st.home, ty: BODY_HEIGHT / 2 })
    Object.assign(st.goal, st.view)
    Object.assign(st, { spin: 0, idleUntil: 0, gesture: null, inside: false, pointer: null, hover: null, cycle: null, tap: null, readySent: false, frames: 0, viewDirty: true, hoverDirty: false, sig: [] })
    st.pointers.clear()
    applyLooks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.session])

  // ----- appearance -------------------------------------------------------------------------------------
  const applyLooks = () => {
    const { layers, selected } = live.current
    const xray = live.current.xray !== false
    const hoverId = live.current.hovered ?? st.hover?.id ?? null
    for (const rec of inst.recs) rec.visible = !!layers[rec.layer] || (selected != null && PRIMARY_NODE[selected] === rec.name)
    const anyInner = inst.recs.some((r) => r.visible && !r.shell)
    const onlySkin = !inst.recs.some((r) => r.visible && r.name !== 'sys_skin')
    const isolating = xray && selected != null && selected !== 'radiation'
    for (const rec of inst.recs) {
      const m = rec.material
      const inSelection = rec.system === selected
      const hovered = rec.system === hoverId
      let opacity = 1
      let order = 0
      rec.solid = true
      m.color.copy(rec.base)
      if (rec.shell) {
        const alone = rec.name === 'sys_muscles' ? !anyInner : onlySkin
        if (isolating && !inSelection) {
          // faint body outline around an isolated organ
          rec.solid = false
          opacity = hovered ? 0.2 : 0.05
          order = 3
        } else if (!alone) {
          rec.solid = false
          opacity = rec.name === 'sys_skin' ? (inSelection ? 0.32 : hovered ? 0.2 : 0.12) : inSelection || hovered ? 0.24 : 0.16
          order = rec.name === 'sys_skin' ? 4 : 3
        }
      } else if (isolating && !inSelection) {
        // x-ray ghost: still there and still clickable, but it no longer hides the selection
        rec.solid = false
        opacity = hovered ? 0.55 : rec.name === 'sys_bones' ? 0.07 : 0.1
        order = hovered ? 2 : 1
        if (!hovered) m.color.lerp(GHOST_TINT, 0.7)
      }
      rec.mesh.visible = rec.visible
      rec.mesh.renderOrder = order
      m.opacity = opacity
      m.depthWrite = rec.solid
    }
  }

  useLayoutEffect(applyLooks)

  // ----- camera rig -------------------------------------------------------------------------------------
  const insetTop = props.insets?.top ?? 0
  const insetBottom = props.insets?.bottom ?? 0

  const clampGoal = () => {
    const g = st.goal
    g.dist = clamp(g.dist, MIN_DIST, st.maxDist)
    g.pol = clamp(g.pol, POLAR_MIN, POLAR_MAX)
    // the closer the camera, the further the pivot may slide along the body; at the home distance it is centred
    const k = clamp((st.home - g.dist) / Math.max(0.001, st.home - MIN_DIST), 0, 1)
    const mid = inst.height / 2
    g.ty = clamp(g.ty, mid - (mid - 0.1) * k, mid + (inst.height - 0.08 - mid) * k)
  }

  const placeCamera = () => {
    const v = st.view
    const s = Math.sin(v.pol)
    camera.position.set(v.dist * s * Math.sin(v.az), v.ty + v.dist * Math.cos(v.pol), v.dist * s * Math.cos(v.az))
    camera.lookAt(0, v.ty, 0)
    camera.updateMatrixWorld()
  }

  // frame the whole body between the overlay controls, for any container size
  useLayoutEffect(() => {
    const { width: w, height: h } = size
    if (w < 2 || h < 2) return
    const t = TAN_HALF_FOV
    const safeH = Math.max(140, h - insetTop - insetBottom)
    const safeW = Math.max(140, w - 24)
    const fitH = ((inst.height * 1.07) / (2 * t)) * (h / safeH)
    const fitW = ((2 * inst.radius * 1.08) / (2 * t)) * (h / safeW)
    const home = Math.max(fitH, fitW) + inst.radius * 0.3
    const ratio = home / st.home
    st.home = home
    st.maxDist = home * 1.5
    st.goal.dist *= ratio
    st.view.dist *= ratio
    clampGoal()
    st.view.dist = clamp(st.view.dist, MIN_DIST, st.maxDist)
    camera.fov = FOV
    // shift the picture so that its centre sits in the middle of the free area (keeps the orbit pivot on the body)
    camera.setViewOffset(w, h, 0, (insetBottom - insetTop) / 2, w, h)
    placeCamera()
    st.hoverDirty = true
    st.viewDirty = true
    return () => camera.clearViewOffset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, insetTop, insetBottom, camera, inst])

  const zoomBy = (factor: number, anchorY?: number) => {
    const g = st.goal
    const d0 = g.dist
    const d1 = clamp(d0 * factor, MIN_DIST, st.maxDist)
    if (anchorY != null && d1 !== d0) g.ty += (anchorY - g.ty) * (1 - d1 / d0)
    g.dist = d1
    clampGoal()
  }

  // metres per canvas pixel on the plane through the pivot
  const perPixel = () => (2 * st.goal.dist * TAN_HALF_FOV) / Math.max(1, sizeRef.current.height)
  // world height shown at canvas pixel y (the view offset moves the picture centre between the overlay bars)
  const worldYAt = (y: number) => {
    const ins = live.current.insets
    const centre = sizeRef.current.height / 2 - ((ins?.bottom ?? 0) - (ins?.top ?? 0)) / 2
    return st.goal.ty + (centre - y) * perPixel()
  }

  // ----- hover / click resolution -----------------------------------------------------------------------
  const resolve = (x: number, y: number, type: string): HoverHit | null => {
    const c = st.cycle
    // a second click on the same spot steps to the next system under the pointer
    if (c && c.list.length > 1 && c.list[c.index] === live.current.selected && Math.hypot(x - c.x, y - c.y) <= (CYCLE_RADIUS[type] ?? 8)) {
      const index = (c.index + 1) % c.list.length
      return { id: c.list[index], list: c.list, index, cycling: true }
    }
    const { width, height } = sizeRef.current
    const fast = st.bvhReady
    const list = pickSystems(inst, camera, width, height, x, y, fast ? (ORGAN_RADIUS[type] ?? 4) : 0, fast ? (EDGE_RADIUS[type] ?? 10) : 0, live.current.showRadiation !== false)
    return list.length ? { id: list[0], list, index: 0, cycling: false } : null
  }

  const setHover = (hit: HoverHit | null, x?: number, y?: number) => {
    const prev = st.hover
    const changed = (prev?.id ?? null) !== (hit?.id ?? null)
    st.hover = hit
    if (changed) applyLooks()
    if (hit) live.current.onHover(hit.id, x, y, { cycling: hit.cycling, count: hit.list.length })
    else if (prev) live.current.onHover(null)
  }

  // a click (or an air-tap) at canvas point (x, y): select through the resolver, remember the spot for click-again cycling
  const selectAt = (x: number, y: number, type: string): SystemId | null => {
    const hit = resolve(x, y, type)
    st.cycle = hit ? { x: hit.cycling && st.cycle ? st.cycle.x : x, y: hit.cycling && st.cycle ? st.cycle.y : y, list: hit.list, index: hit.index } : null
    if (hit) live.current.onSelect(hit.id)
    return hit?.id ?? null
  }

  useEffect(() => {
    const el = gl.domElement
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const touchIdle = () => {
      st.idleUntil = performance.now() + IDLE_BEFORE_SPIN
    }
    const endGesture = () => {
      st.pointers.clear()
      st.gesture = null
      touchIdle()
    }
    const pinchState = () => {
      const [a, b] = [...st.pointers.values()]
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), midY: (a.y + b.y) / 2 }
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      const p = local(e)
      st.pointers.set(e.pointerId, p)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      if (st.pointers.size === 1) {
        st.gesture = { id: e.pointerId, type: e.pointerType || 'mouse', x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, multi: false, pan: e.button === 2 || e.shiftKey, pinch: 0, pinchDist: 0, midY: 0 }
      } else if (st.gesture && st.pointers.size === 2) {
        const s = pinchState()
        st.gesture.multi = true
        st.gesture.pinch = s.dist
        st.gesture.pinchDist = st.goal.dist
        st.gesture.midY = s.midY
      }
      st.tap = null
      st.pointer = null
      st.hoverDirty = false
      setHover(null)
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      const g = st.gesture
      if (!g || !st.pointers.has(e.pointerId)) {
        // plain hover (mouse or pen only: a finger has no hover)
        if (e.pointerType === 'touch' || e.buttons) return
        st.inside = true
        st.pointer = { x: p.x, y: p.y, type: e.pointerType || 'mouse' }
        st.hoverDirty = true
        return
      }
      st.pointers.set(e.pointerId, p)
      const h = sizeRef.current.height
      if (st.pointers.size >= 2) {
        // pinch = zoom towards the fingers, two-finger vertical drag = slide along the body
        const s = pinchState()
        if (g.pinch > 0 && s.dist > 0) {
          const anchor = worldYAt(s.midY)
          st.goal.ty += perPixel() * (s.midY - g.midY)
          g.midY = s.midY
          const next = clamp(g.pinchDist * (g.pinch / s.dist), MIN_DIST, st.maxDist)
          zoomBy(next / st.goal.dist, anchor)
          if (!g.moved) live.current.onInteract()
          g.moved = true
        }
        return
      }
      if (e.pointerId !== g.id) return
      const dx = p.x - g.x
      const dy = p.y - g.y
      g.x = p.x
      g.y = p.y
      if (!g.moved) {
        if (Math.hypot(p.x - g.x0, p.y - g.y0) <= (CLICK_SLOP[g.type] ?? 5)) return
        g.moved = true
        st.cycle = null
        live.current.onInteract()
      }
      if (g.pan) {
        st.goal.ty += perPixel() * dy
      } else {
        st.goal.az -= (2 * Math.PI * dx) / h
        st.goal.pol -= (2 * Math.PI * dy) / h
      }
      clampGoal()
    }

    const onUp = (e: PointerEvent) => {
      if (!st.pointers.has(e.pointerId)) return
      const g = st.gesture
      st.pointers.delete(e.pointerId)
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
      // A press that never moved is a tap. The selection itself happens on the browser's own click event (below):
      // selecting here would let that click land on whatever the page opens in response (a sheet backdrop on phones).
      st.tap = g && g.id === e.pointerId && !g.moved && !g.multi && st.pointers.size === 0 && e.button === 0 ? { ...local(e), type: g.type, at: performance.now() } : null
      if (st.pointers.size === 0) {
        st.gesture = null
        touchIdle()
      }
    }

    const onClick = () => {
      const tap = st.tap
      st.tap = null
      if (!tap || performance.now() - tap.at > 1000) return // a drag, a pinch, or a click that is not ours
      selectAt(tap.x, tap.y, tap.type)
    }

    const onCancel = (e: PointerEvent) => {
      st.pointers.delete(e.pointerId)
      if (st.pointers.size === 0) endGesture()
    }
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') st.inside = true
    }
    const onLeave = () => {
      st.inside = false
      st.pointer = null
      st.hoverDirty = false
      setHover(null)
      touchIdle()
    }
    const onWheel = (e: WheelEvent) => {
      // Plain scrolling belongs to the page (the viewer is tall; trapping the wheel would make pages hard to scroll).
      // Ctrl/Cmd + wheel zooms, which is also what a trackpad pinch sends.
      if (!e.ctrlKey && !e.metaKey) {
        live.current.onZoomHint?.()
        return
      }
      e.preventDefault()
      const dy = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -30, 30)
      zoomBy(Math.exp(dy * 0.01), worldYAt(local(e).y))
      st.cycle = null
      st.hoverDirty = true
      touchIdle()
      live.current.onInteract()
    }
    // Safari sends pinch gestures as its own events
    let gestureDist = 0
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureDist = st.goal.dist
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const scale = (e as Event & { scale?: number }).scale
      if (!scale || !gestureDist) return
      zoomBy(clamp(gestureDist / scale, MIN_DIST, st.maxDist) / st.goal.dist)
      live.current.onInteract()
    }
    const onContextMenu = (e: Event) => e.preventDefault()
    const onHidden = () => {
      if (document.hidden) {
        endGesture()
        onLeave()
      }
    }

    // one finger: horizontal drags rotate, vertical swipes still scroll the page
    const prevTouchAction = el.style.touchAction
    el.style.touchAction = 'pan-y'
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('click', onClick)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('blur', onLeave)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      el.style.touchAction = prevTouchAction
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('click', onClick)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', onLeave)
      document.removeEventListener('visibilitychange', onHidden)
      st.pointers.clear()
      st.gesture = null
      st.inside = false
      st.pointer = null
      if (st.hover) {
        st.hover = null
        live.current.onHover(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, inst])

  // ----- shaders: compiled in the background (KHR_parallel_shader_compile where available) before the first
  // picture, instead of synchronously inside the first frame (the viewer's skeleton stays up meanwhile)
  useLayoutEffect(() => {
    let alive = true
    st.compiled = false
    // the error check reads every program's log synchronously (it waits for the compile): development only
    gl.debug.checkShaderErrors = import.meta.env.DEV
    const done = () => {
      if (alive) st.compiled = true
    }
    try {
      const p = (gl as THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, s?: THREE.Object3D) => Promise<unknown> }).compileAsync?.(scene, camera, scene)
      if (p) {
        p.then(done, done)
        // never wait longer than this for the background compile: draw (and compile, if still needed) anyway
        const t = setTimeout(done, 4000)
        return () => {
          alive = false
          clearTimeout(t)
        }
      }
    } catch {
      /* draws (and compiles) in the first frame instead */
    }
    done()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, inst])

  // ----- BVHs, GPU resources, imperative controls -------------------------------------------------------
  useEffect(() => {
    let alive = true
    st.bvhReady = false
    Promise.all(
      inst.recs.map((rec) =>
        ensureBvh(rec.source).then((tree) => {
          if (alive) rec.tree = tree
        }),
      ),
    )
      .then(() => {
        if (!alive) return
        st.bvhReady = true
        st.hoverDirty = true
      })
      .catch(() => {
        /* clicks keep working through the slow path */
      })
    return () => {
      alive = false
      // free this renderer's GPU buffers and detach it from the cached model
      for (const rec of inst.recs) rec.mesh.geometry.dispose()
      for (const m of inst.materials) m.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst])

  useEffect(() => {
    if (props.autoRotate) st.idleUntil = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoRotate])

  // an outside selection (list, alert) invalidates the click-again cycle
  useEffect(() => {
    if (st.cycle && st.cycle.list[st.cycle.index] !== props.selected) st.cycle = null
    st.hoverDirty = true
    st.viewDirty = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected, props.layers, props.showRadiation])

  useEffect(() => {
    const ref = props.controlsRef
    if (!ref) return
    ref.current = {
      zoom: (direction) => {
        const sel = live.current.selected
        // zoom towards the selected system, or straight in when nothing is selected
        zoomBy(direction > 0 ? 0.72 : 1 / 0.72, direction > 0 && sel ? inst.centerY[sel] : undefined)
        st.idleUntil = performance.now() + IDLE_BEFORE_SPIN
      },
      reset: () => {
        const turns = Math.round(st.goal.az / (2 * Math.PI)) * 2 * Math.PI
        st.goal.az = turns
        st.goal.pol = POLAR_HOME
        st.goal.dist = st.home
        st.goal.ty = inst.height / 2
        st.cycle = null
      },
      rotateBy: (dx, dy) => {
        const h = Math.max(1, sizeRef.current.height)
        st.goal.az -= (2 * Math.PI * dx) / h
        st.goal.pol -= (2 * Math.PI * dy) / h
        clampGoal()
        st.cycle = null
        st.idleUntil = performance.now() + IDLE_BEFORE_SPIN
        live.current.onInteract()
      },
      zoomBy: (factor, clientY) => {
        const top = gl.domElement.getBoundingClientRect().top
        zoomBy(factor, clientY == null ? undefined : worldYAt(clientY - top))
        st.cycle = null
        st.hoverDirty = true
        st.idleUntil = performance.now() + IDLE_BEFORE_SPIN
        live.current.onInteract()
      },
      pickAt: (clientX, clientY) => {
        const r = gl.domElement.getBoundingClientRect()
        return selectAt(clientX - r.left, clientY - r.top, 'hand')
      },
      hoverAt: (clientX, clientY) => {
        if (clientX == null || clientY == null) {
          st.inside = false
          st.pointer = null
          st.hoverDirty = false
          setHover(null)
          st.idleUntil = performance.now() + IDLE_BEFORE_SPIN
          return
        }
        const r = gl.domElement.getBoundingClientRect()
        st.inside = true
        st.pointer = { x: clientX - r.left, y: clientY - r.top, type: 'hand' }
        st.hoverDirty = true
      },
      hovered: () => st.hover?.id ?? null,
      anchor: (id) => {
        const a = inst.anchors[id]
        if (!a) return null
        const { width: w, height: h } = sizeRef.current
        const p = _anchor.copy(a.center).project(camera)
        if (p.z > 1 || p.z < -1) return null
        const x = ((p.x + 1) / 2) * w
        const y = ((1 - p.y) / 2) * h
        const q = _anchorUp.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(a.radius).add(a.center).project(camera)
        return { x, y, r: Math.hypot(((q.x + 1) / 2) * w - x, ((1 - q.y) / 2) * h - y) }
      },
    }
    return () => {
      ref.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.controlsRef, inst])

  // dev-only test hooks (used by the viewer probe; not present in production builds)
  useEffect(() => {
    if (!DEV_HOOKS) return
    const api = {
      pick: (clientX: number, clientY: number, type = 'mouse') => {
        const r = gl.domElement.getBoundingClientRect()
        return resolve(clientX - r.left, clientY - r.top, type)
      },
      project: (x: number, y: number, z: number) => {
        const r = gl.domElement.getBoundingClientRect()
        const p = new THREE.Vector3(x, y, z).project(camera)
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
      },
      view: (next?: Partial<View>) => {
        if (next) {
          Object.assign(st.goal, next)
          clampGoal()
          Object.assign(st.view, st.goal)
          placeCamera()
        }
        return { ...st.view, home: st.home }
      },
      stats: () => ({ pick: { ...pickStats, mean: pickStats.picks ? pickStats.ms / pickStats.picks : 0 }, bvh: { ...bvhStats, ready: st.bvhReady }, frames: st.frames, memory: { ...gl.info.memory }, calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
      resetStats: () => Object.assign(pickStats, { rays: 0, picks: 0, ms: 0, last: 0, max: 0 }),
      nodes: () => inst.recs.map((r) => ({ name: r.name, visible: r.visible, solid: r.solid, opacity: +r.material.opacity.toFixed(2), emissive: `#${r.material.emissive.getHexString()}`, intensity: +r.material.emissiveIntensity.toFixed(2), order: r.mesh.renderOrder })),
      loseContext: () => gl.getContext().getExtension('WEBGL_lose_context')?.loseContext(),
      state: () => ({ hover: st.hover, cycle: st.cycle, inside: st.inside, spin: st.spin, gesture: !!st.gesture }),
      three: () => ({ camera, root: inst.root }),
    }
    const w = window as unknown as { __auraViewer?: typeof api }
    w.__auraViewer = api
    return () => {
      if (w.__auraViewer === api) delete w.__auraViewer
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, inst])

  // ----- per-frame work ---------------------------------------------------------------------------------
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    st.time += dt
    const p = live.current
    const now = performance.now()

    // auto-rotation: only while nobody is pointing at or touching the viewer, eased in and out
    const spinning = p.autoRotate && !p.reducedMotion && !st.inside && st.pointers.size === 0 && now >= st.idleUntil
    st.spin += ((spinning ? 1 : 0) - st.spin) * (1 - Math.exp(-dt * 3))
    if (st.spin > 0.001) {
      const step = SPIN_SPEED * st.spin * dt
      st.goal.az += step
      st.view.az += step
    }
    if (Math.abs(st.goal.az) > 64 * Math.PI) {
      const turns = Math.trunc(st.goal.az / (2 * Math.PI)) * 2 * Math.PI
      st.goal.az -= turns
      st.view.az -= turns
    }

    // damped follow
    const k = 1 - Math.exp(-dt * 12)
    const v = st.view
    const g = st.goal
    const moving = Math.abs(g.az - v.az) + Math.abs(g.pol - v.pol) + Math.abs(g.dist - v.dist) + Math.abs(g.ty - v.ty) > 1e-4
    if (moving) {
      v.az += (g.az - v.az) * k
      v.pol += (g.pol - v.pol) * k
      v.dist += (g.dist - v.dist) * k
      v.ty += (g.ty - v.ty) * k
      if (st.pointer) st.hoverDirty = true
    }
    placeCamera()
    if (p.onView && (moving || st.spin > 0.001 || st.viewDirty)) {
      st.viewDirty = false
      p.onView()
    }

    // hover: at most one resolve per frame, never during a drag, only once the BVHs exist
    if (st.hoverDirty && st.bvhReady && !st.gesture) {
      st.hoverDirty = false
      if (st.pointer) setHover(resolve(st.pointer.x, st.pointer.y, st.pointer.type), st.pointer.x, st.pointer.y)
    }

    // status / selection glow
    const pulse = p.reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(st.time * 3.2)
    const hoverId = p.hovered ?? st.hover?.id ?? null
    for (const m of inst.materials) m.emissiveIntensity = 0
    for (const rec of inst.recs) {
      const m = rec.material
      const status = p.statuses[rec.system] ?? 'ok'
      const dim = rec.shell ? 0.6 : PRIMARY_NODE[rec.system] === rec.name ? 1 : 0.45
      if (rec.system === p.selected) {
        m.emissive.set(status === 'ok' ? NEUTRAL_GLOW : STATUS_COLOR[status])
        m.emissiveIntensity = (0.42 + 0.3 * pulse) * dim
      } else if (rec.system === hoverId) {
        m.emissive.set(STATUS_COLOR[status])
        m.emissiveIntensity = 0.5 * dim
      } else if (status !== 'ok') {
        m.emissive.set(STATUS_COLOR[status])
        m.emissiveIntensity = (status === 'crit' ? 0.6 : 0.34) * (p.reducedMotion ? 0.6 : pulse) * dim
      }
    }

    // ----- draw (this frame callback has a priority, so it does the drawing instead of R3F) -----------------
    if (!st.compiled) return
    if (draw(now) || st.frames > 0) st.frames++
    if (!st.readySent && st.frames >= 2) {
      st.readySent = true
      p.onReady?.()
    }
  }, 1)

  /**
   * Draws the scene unless the picture would be identical to the last one: the camera, the canvas size and every
   * mesh's visibility, colours, opacity and glow are compared. A frame whose only change is the slow status
   * pulse is drawn at most 30 times a second. Returns whether it drew.
   */
  const draw = (now: number) => {
    const sig = st.sig
    let i = 0
    let major = false
    let minor = false
    const put = (v: number, isMinor = false) => {
      if (sig[i] !== v) {
        sig[i] = v
        if (isMinor) minor = true
        else major = true
      }
      i++
    }
    const c = camera
    put(c.position.x)
    put(c.position.y)
    put(c.position.z)
    put(c.quaternion.x)
    put(c.quaternion.y)
    put(c.quaternion.z)
    put(c.quaternion.w)
    put(c.projectionMatrix.elements[0])
    put(c.projectionMatrix.elements[5])
    put(c.projectionMatrix.elements[9])
    put(sizeRef.current.width)
    put(sizeRef.current.height)
    put(gl.getPixelRatio())
    for (const rec of inst.recs) {
      const m = rec.material
      put(rec.mesh.visible ? 1 : 0)
      put(rec.mesh.renderOrder)
      put(m.opacity)
      put(m.depthWrite ? 1 : 0)
      put(m.color.getHex())
      put(m.emissive.getHex())
      put(m.emissiveIntensity, true)
    }
    if (minor) st.pendingMinor = true
    if (!major && !(st.pendingMinor && now - st.drawnAt >= 32)) return false
    st.pendingMinor = false
    st.drawnAt = now
    gl.render(scene, camera)
    return true
  }

  return <primitive object={inst.root} />
}


// If the GPU drops the WebGL context and does not give it back, tell the parent so it can show the SVG fallback.
function ContextWatch({ onLost }: { onLost?: () => void }) {
  const gl = useThree((s) => s.gl)
  const cb = useRef(onLost)
  cb.current = onLost
  useEffect(() => {
    const el = gl.domElement
    let timer: ReturnType<typeof setTimeout> | undefined
    const lost = (e: Event) => {
      e.preventDefault() // allow the browser to restore it
      clearTimeout(timer)
      timer = setTimeout(() => cb.current?.(), 2500)
    }
    const restored = () => clearTimeout(timer)
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl])
  return null
}

// Renders at most `fps` frames a second (with frameloop 'demand'): frees the GPU and main thread for hand tracking.
function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / fps)
    return () => clearInterval(id)
  }, [invalidate, fps])
  return null
}

// ---------------------------------------------------------------------------------------------------------
// Renderer pool. Every visit to Overview or Diagnostics used to create a WebGL context, compile the shaders and,
// on leaving, destroy the context again (forceContextLoss): together several hundred milliseconds of main-thread
// stall per tab switch. The canvas, its R3F root and the mounted scene are now kept for the page's lifetime and
// moved into whichever viewer mounts next; while parked the render loop is stopped.
// ---------------------------------------------------------------------------------------------------------
type Slot = { canvas: HTMLCanvasElement; root: ReconcilerRoot<HTMLCanvasElement>; busy: boolean }
const slots: Slot[] = []
let sessions = 0
/** contexts kept while no viewer shows them (a second, simultaneous viewer gets its own and gives it back) */
const MAX_PARKED = 1
// MSAA is wasted on high-density screens: their pixel ratio already smooths edges. Fixed per context.
const GL_PROPS = { antialias: typeof window === 'undefined' || (window.devicePixelRatio || 1) < 1.5, alpha: true, powerPreference: 'high-performance' as const }
// <Canvas> registers the THREE namespace for JSX (<ambientLight> ...); a root made with createRoot needs it too
extend(THREE as unknown as Parameters<typeof extend>[0])
const CAMERA = { position: [0, 1, 3.4] as [number, number, number], fov: FOV, near: 0.05, far: 50 }

function acquireSlot(): Slot {
  let slot = slots.find((s) => !s.busy)
  if (!slot) {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    slot = { canvas, root: createRoot(canvas), busy: false }
    slots.push(slot)
  }
  slot.busy = true
  return slot
}

function releaseSlot(slot: Slot) {
  slot.busy = false
  slot.canvas.remove()
  if (slots.filter((s) => !s.busy).length <= MAX_PARKED) return
  // too many idle contexts: destroy this one when the browser is idle (never in the middle of a navigation)
  const i = slots.indexOf(slot)
  if (i >= 0) slots.splice(i, 1)
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const drop = () => slot.root.unmount()
  if (w.requestIdleCallback) w.requestIdleCallback(drop, { timeout: 5000 })
  else setTimeout(drop, 2000)
}

/** Drops a slot whose renderer could not be created (no WebGL). */
function discardSlot(slot: Slot) {
  const i = slots.indexOf(slot)
  if (i >= 0) slots.splice(i, 1)
  slot.canvas.remove()
}

export default function Body3D(props: Body3DProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(true)
  const [dpr, setDpr] = useState(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))
  const [failure, setFailure] = useState<unknown>(null)
  const slot = useRef<Slot | null>(null)
  const session = useRef(0)
  const size = useRef({ width: 0, height: 0, top: 0, left: 0 })

  // stop rendering while the viewer is scrolled out of sight
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1].isIntersecting), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const frameloop: 'always' | 'demand' | 'never' = !inView ? 'never' : props.lowPower ? 'demand' : 'always'
  const pixelRatio = props.lowPower ? 1 : dpr

  const paint = () => {
    const s = slot.current
    if (!s) return
    try {
      s.root.configure({ gl: GL_PROPS, camera: CAMERA, size: size.current, dpr: pixelRatio, frameloop })
      s.root.render(
        <>
          <PerformanceMonitor onDecline={() => setDpr(1)} />
          <ContextWatch onLost={props.onLost} />
          {props.lowPower && inView && <FrameCap fps={30} />}
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#f1ede6', '#12110F', 0.7]} />
          <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
          <directionalLight position={[-3, 2, -2]} intensity={0.7} />
          <pointLight position={[0, 1.2, 1.5]} intensity={0.6} />
          <Suspense fallback={null}>
            <Model {...props} session={session.current} />
          </Suspense>
        </>,
      )
    } catch (e) {
      // no WebGL (or the context could not be created): the parent's error boundary shows the 2D body map
      discardSlot(s)
      slot.current = null
      setFailure(e ?? new Error('WebGL unavailable'))
    }
  }

  // take a renderer from the pool, put its canvas here, give it back on unmount (render loop stopped)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const s = acquireSlot()
    slot.current = s
    session.current = ++sessions
    el.appendChild(s.canvas)
    const measure = () => {
      const r = el.getBoundingClientRect()
      size.current = { width: r.width, height: r.height, top: r.top, left: r.left }
    }
    measure()
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const before = size.current
        measure()
        if (before.width !== size.current.width || before.height !== size.current.height) slot.current?.root.configure({ size: size.current })
      })
      ro.observe(el)
    }
    return () => {
      ro?.disconnect()
      if (slot.current !== s) return
      slot.current = null
      try {
        s.root.configure({ frameloop: 'never' })
      } catch {
        /* parked as is */
      }
      releaseSlot(s)
    }
  }, [])

  // every render: pass the current props on to the scene (as <Canvas> did)
  useLayoutEffect(paint)

  if (failure) throw failure
  return <div ref={wrap} className="absolute inset-0 overflow-hidden" />
}
