// Realistic 3D anatomy viewer (BodyParts3D-derived GLB). Loaded lazily; see BodyViewer for the fallback.
//
// Picking policy (see `rankHits`): every pointer position is resolved by casting rays through ALL visible
// layers (BVH accelerated, about 0.05 ms per ray) and ranking what lies along them, instead of taking the
// nearest mesh. Hover and click share the same resolver, so the tooltip always names what a click selects.
import { PerformanceMonitor, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { CENTER, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh'
import type { SystemId } from '../../data/systems'
import { STATUS_COLOR, type Status } from '../../data/vitals'

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

/** An organ at most this far (metres) behind the first bone or vessel on the ray is "directly behind the cage". */
export const CAGE_DEPTH = 0.06
/** A more specific organ at most this far (metres) behind the first organ on the ray wins (thin lung edge over the heart). */
export const THIN_COVER = 0.03

export type RayHit = { node: string; kind: PickKind; d: number }

/**
 * Orders everything a ray passes through, best pick first:
 * 1. Organs beat the cage in front of them (ribs, skull, vessels) when they lie within CAGE_DEPTH of it;
 *    among organs the front-most wins, unless a more specific one starts within THIN_COVER behind it.
 * 2. Otherwise the opaque surface that is actually seen wins (arm bone in front of the chest, spine from behind).
 * 3. Translucent shells (muscle, skin) come last, so they only win where nothing else is under the pointer.
 * The rest of the list is what repeated clicks on the same spot step through.
 */
export function rankHits(hits: RayHit[]): RayHit[] {
  const of = (kind: PickKind) => hits.filter((h) => h.kind === kind).sort((a, b) => a.d - b.d)
  const organs = of('organ')
  const cage = of('cage')
  const shells = of('shell')
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
const PICK_RADIUS: Record<string, number> = { mouse: 10, pen: 12, touch: 22 }
const CYCLE_RADIUS: Record<string, number> = { mouse: 8, pen: 10, touch: 20 }
const RING: [number, number][] = [0.5, 1].flatMap((r) =>
  Array.from({ length: 8 }, (_, i): [number, number] => [r * Math.cos((i * Math.PI) / 4), r * Math.sin((i * Math.PI) / 4)]),
)

// ---------------------------------------------------------------------------------------------------------
// BVH cache: built once per loaded geometry (the loader caches the model for the lifetime of the page),
// one mesh per task so the main thread is never blocked for long. Shared by every mount of the viewer.
// ---------------------------------------------------------------------------------------------------------
const bvhCache = new WeakMap<THREE.BufferGeometry, Promise<MeshBVH>>()
let bvhQueue: Promise<unknown> = Promise.resolve()
const bvhStats = { builds: 0, ms: 0, longest: 0 }

function ensureBvh(geometry: THREE.BufferGeometry): Promise<MeshBVH> {
  let job = bvhCache.get(geometry)
  if (!job) {
    job = bvhQueue
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      .then(() => {
        const t = performance.now()
        // indirect: the index buffer used for rendering is left untouched
        // (a runtime option of three-mesh-bvh 0.8 that its type declarations do not list yet)
        const options: MeshBVHOptions & { indirect: boolean } = { strategy: CENTER, maxLeafTris: 10, indirect: true }
        const tree = new MeshBVH(geometry, options)
        const ms = performance.now() - t
        bvhStats.builds++
        bvhStats.ms += ms
        bvhStats.longest = Math.max(bvhStats.longest, ms)
        return tree
      })
    bvhQueue = job.catch(() => undefined)
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

type Instance = { root: THREE.Group; recs: NodeRec[]; materials: THREE.MeshStandardMaterial[]; height: number; radius: number; centerY: Partial<Record<SystemId, number>> }

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
  const one = new THREE.Box3()
  for (const r of recs) {
    if (PRIMARY_NODE[r.system] !== r.name) continue
    one.setFromObject(r.mesh)
    centerY[r.system] = (one.min.y + one.max.y) / 2
  }
  centerY.bones = BODY_HEIGHT / 2
  centerY.radiation = BODY_HEIGHT / 2
  return { root, recs, materials: [...mats.values()], height: BODY_HEIGHT, radius: (Math.max(size.x, size.z) * scale) / 2, centerY }
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
 * Systems under a pointer, best first. `radius` > 0 adds a ring of rays around the pointer: a more specific
 * target found there (an eye next to the pointer, anything at all next to empty space) takes the lead.
 */
function pickSystems(inst: Instance, camera: THREE.Camera, w: number, h: number, x: number, y: number, radius: number, showRadiation: boolean): SystemId[] {
  const t0 = performance.now()
  for (const rec of inst.recs) rec.inverse.copy(rec.mesh.matrixWorld).invert()
  const center = castRanked(inst, camera, w, h, x, y, showRadiation)
  let lead: string | null = center[0]?.node ?? null
  let leadSpec = lead ? (SPECIFICITY[lead] ?? 0) : -1
  if (radius > 0 && leadSpec < MAX_SPECIFICITY) {
    for (const [dx, dy] of RING) {
      const near = castRanked(inst, camera, w, h, x + dx * radius, y + dy * radius, showRadiation)[0]
      if (!near) continue
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

export type ViewerControls = { zoom: (direction: 1 | -1) => void; reset: () => void }

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
}

const CYAN = '#53D7FF'
const GHOST_TINT = new THREE.Color('#86b4d6')
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

function Model(props: Body3DProps) {
  const loaded = useGLTF(props.files, false) as unknown as { scene: THREE.Group } | { scene: THREE.Group }[]
  const scenes = (Array.isArray(loaded) ? loaded : [loaded]).map((g) => g.scene)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inst = useMemo(() => buildInstance(scenes), [props.files.join('|')])
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
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
    bvhReady: false,
    frames: 0,
    time: 0,
    readySent: false,
  }).current

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
    const list = pickSystems(inst, camera, width, height, x, y, st.bvhReady ? (PICK_RADIUS[type] ?? 10) : 0, live.current.showRadiation !== false)
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
      if (g && g.id === e.pointerId && !g.moved && !g.multi && st.pointers.size === 0 && e.button === 0) {
        const p = local(e)
        const hit = resolve(p.x, p.y, g.type)
        st.cycle = hit ? { x: hit.cycling && st.cycle ? st.cycle.x : p.x, y: hit.cycling && st.cycle ? st.cycle.y : p.y, list: hit.list, index: hit.index } : null
        if (hit) live.current.onSelect(hit.id)
      }
      if (st.pointers.size === 0) {
        st.gesture = null
        touchIdle()
      }
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
      const dy = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -40, 40)
      zoomBy(Math.exp(dy * 0.012), worldYAt(local(e).y))
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
    }
    return () => {
      ref.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.controlsRef, inst])

  // dev-only test hooks (used by the viewer probe; not present in production builds)
  useEffect(() => {
    if (!import.meta.env.DEV) return
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
      const dim = rec.shell ? 0.6 : 1
      if (rec.system === p.selected) {
        m.emissive.set(status === 'ok' ? CYAN : STATUS_COLOR[status])
        m.emissiveIntensity = (0.42 + 0.3 * pulse) * dim
      } else if (rec.system === hoverId) {
        m.emissive.set(STATUS_COLOR[status])
        m.emissiveIntensity = 0.5 * dim
      } else if (status !== 'ok') {
        m.emissive.set(STATUS_COLOR[status])
        m.emissiveIntensity = (status === 'crit' ? 0.6 : 0.34) * (p.reducedMotion ? 0.6 : pulse) * dim
      }
    }

    st.frames++
    if (!st.readySent && st.frames >= 2) {
      st.readySent = true
      p.onReady?.()
    }
  })

  return <primitive object={inst.root} />
}

function ScanRing({ still }: { still?: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const time = useRef(0)
  useFrame((_, dt) => {
    if (!ref.current) return
    if (!still) time.current += Math.min(dt, 0.1)
    const t = time.current
    ref.current.position.y = 0.05 + ((Math.sin(t * 0.6) + 1) / 2) * 1.7
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.12 * Math.sin(t * 1.2)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[0.42, 0.45, 96]} />
      <meshBasicMaterial color={CYAN} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function Platform() {
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <ringGeometry args={[0.55, 0.57, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <circleGeometry args={[0.55, 64]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <gridHelper args={[3, 30, '#1E3A55', '#12263A']} position={[0, -0.001, 0]} />
    </group>
  )
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

export default function Body3D(props: Body3DProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(true)
  const [dpr, setDpr] = useState(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))

  // stop rendering while the viewer is scrolled out of sight
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1].isIntersecting), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={dpr}
        frameloop={inView ? 'always' : 'never'}
        camera={{ position: [0, 1, 3.4], fov: FOV, near: 0.05, far: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <ContextWatch onLost={props.onLost} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#bfe9ff', '#0b1a2c', 0.7]} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.7} color={CYAN} />
        <pointLight position={[0, 1.2, 1.5]} intensity={0.6} color="#A5E9FF" />
        <Suspense fallback={null}>
          <Model {...props} />
        </Suspense>
        <ScanRing still={props.reducedMotion} />
        <Platform />
      </Canvas>
    </div>
  )
}
