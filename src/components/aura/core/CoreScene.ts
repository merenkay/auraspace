// The AURA core in WebGL: four layers you can dive through (mission shell, vitals orbit, body-systems lattice,
// voice nucleus) around the voice posture: three rings, a geodesic lattice of points and a nucleus.
// Loaded lazily (this file is the only one in the folder that imports three.js). Everything is procedural:
// no model, no texture. Flat hairlines of a constant pixel width, no glow, no blur, no post-processing.
//
// Cost control: one small context, three shader programs compiled before the first picture, a draw loop that
// runs at 30 frames a second while the core idles, at the display rate only while a voice level or a drag is
// actually moving it, and not at all when the pose is still (urgent after its pulses, voice off, reduced
// motion), when the canvas is off screen or when the tab is hidden.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Euler, Group, Mesh, PerspectiveCamera, Points, Quaternion, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer } from 'three'
import { geodesic, polygon, spread } from './geometry'
import { cabinSlots, clampDepth, diveByFactor, EMPTY_DATA, GEO, INNER_SCALE, LAYERS, MAX_DEPTH, nearestLayer, passFade, passFlash, vitalSlots, zoomForDepth, type CoreData, type CoreItem, type ItemStatus } from './layers'
import { ARC_PERIOD, follow, frameRate, HOME_VIEW, homeFor, OCTAGON_RADIUS, POSES, POSE_TAU, rotateView, TICK_RADIUS, URGENT_PULSES, urgentPulse, viewSettled, type CoreState, type RingPose, type Tone, type View } from './model'

export type CorePalette = Record<Tone | 'bg' | 'warn', string>

/** Where an item of the focused layer is on the stage right now (CSS pixels), for labels drawn in the DOM. */
export type CoreAnchor = { id: string; x: number; y: number; front: boolean }

export type CoreSceneOptions = {
  canvas: HTMLCanvasElement
  palette: CorePalette
  state: CoreState
  /** a voice level is being fed right now (listening or speaking) */
  live: boolean
  reduced: boolean
  lowPower: boolean
  /** size of the canvas in CSS pixels */
  width: number
  height: number
  /** 0..1, read once per drawn frame */
  level: () => number
  /** what the layers show; replaced with setData when the app's data changes */
  data?: CoreData
  /** the core fills the display: more margin around it, a lower pixel-ratio cap on big screens */
  full?: boolean
  /** called after every drawn frame: the labels follow their anchors */
  onFrame?: () => void
  /** the layer in focus changed (index into LAYERS) */
  onLayer?: (index: number) => void
  onReady: () => void
  /** the WebGL context was lost: the caller switches to the flat fallback */
  onLost: () => void
}

export type CoreStats = { ready: boolean; running: boolean; paused: boolean; frames: number; rate: number; state: CoreState; level: number; view: View; pixelRatio: number; depth: number; layer: number; calls: number }

const FOV = 30
const BASE_DIST = 6.45
const TAN_HALF = Math.tan((FOV * Math.PI) / 360)
const VIEW_TAU = 0.12
/** below this canvas size (CSS px) the lattice is left out and the tick ring is thinned: the compact strip */
const COMPACT_BELOW = 120

const LINE_VERT = /* glsl */ `
uniform float uHalf;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
attribute vec3 aDir;
attribute float aAlong;
varying float vZ;
varying float vAlong;
varying vec2 vP;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vec3 d = mat3(modelViewMatrix) * aDir;
  mv.xyz += normalize(d) * (length(aDir) * uHalf);
  vZ = (mv.z + uCam) / uScale;
  vAlong = aAlong;
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`

const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBack;
uniform float uDash;
uniform float uClip;
varying float vZ;
varying float vAlong;
varying vec2 vP;
void main() {
  if (uDash > 0.0 && fract(vAlong / uDash) > 0.5) discard;
  // a zoomed-in core fades out at the fixed tick ring instead of being cut by the edge of the canvas
  float window = 1.0 - smoothstep(uClip * 0.9, uClip, length(vP));
  gl_FragColor = vec4(uColor, uOpacity * window * mix(uBack, 1.0, smoothstep(-1.1, 0.0, vZ)));
  #include <colorspace_fragment>
}`

const POINT_VERT = /* glsl */ `
uniform float uSize;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
varying float vZ;
varying vec2 vP;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vZ = (mv.z + uCam) / uScale;
  gl_PointSize = uSize * (0.8 + 0.4 * smoothstep(-1.0, 1.0, vZ));
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`

const POINT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBack;
uniform float uClip;
varying float vZ;
varying vec2 vP;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.34, 0.5, d)) * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP))) * uOpacity * mix(uBack, 1.0, smoothstep(-1.1, 0.0, vZ));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`

const NUCLEUS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`

const NUCLEUS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBg;
uniform float uFill;
uniform float uRim;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = smoothstep(uRim - 0.04, uRim + 0.04, f);
  gl_FragColor = vec4(mix(mix(uBg, uColor, uFill), uColor, rim), 1.0);
  #include <colorspace_fragment>
}`

// flat bands in the plane of the instrument (dials, arcs, bars, markers): colour and alpha per vertex
const BAND_VERT = /* glsl */ `
uniform float uAspect;
attribute vec4 aColor;
varying vec4 vC;
varying vec2 vP;
void main() {
  vC = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`

const BAND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTint;
uniform float uOpacity;
uniform float uClip;
varying vec4 vC;
varying vec2 vP;
void main() {
  float a = vC.a * uOpacity * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vC.rgb, uColor, uTint), a);
  #include <colorspace_fragment>
}`

// the named nodes of the lattice: a shape per status (disc normal, diamond attention, octagon ring urgent,
// thin ring no data), so status never rests on colour alone
const NODE_VERT = /* glsl */ `
uniform float uSize;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
attribute vec3 aColor;
attribute float aShape;
attribute float aBig;
varying float vZ;
varying vec2 vP;
varying vec3 vC;
varying float vShape;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vZ = (mv.z + uCam) / uScale;
  vC = aColor;
  vShape = aShape;
  gl_PointSize = uSize * aBig * (0.85 + 0.3 * smoothstep(-1.0, 1.0, vZ));
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`

const NODE_FRAG = /* glsl */ `
uniform vec3 uBg;
uniform float uOpacity;
uniform float uClip;
varying float vZ;
varying vec2 vP;
varying vec3 vC;
varying float vShape;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = vShape > 0.5 && vShape < 1.5 ? (abs(q.x) + abs(q.y)) * 0.92 : vShape > 1.5 && vShape < 2.5 ? max(max(abs(q.x), abs(q.y)), (abs(q.x) + abs(q.y)) * 0.7071) * 1.06 : length(q);
  float body = 1.0 - smoothstep(0.42, 0.5, d);
  float hole = vShape > 0.5 ? 1.0 - smoothstep(vShape > 2.5 ? 0.3 : 0.24, vShape > 2.5 ? 0.38 : 0.32, d) : 0.0;
  float a = body * uOpacity * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP))) * mix(0.3, 1.0, smoothstep(-0.9, 0.1, vZ));
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vC, uBg, hole), a);
  #include <colorspace_fragment>
}`

/** Collects flat bands (arcs, dots, polygons) into one geometry: one draw call per layer. Angles: degrees, clockwise from the top. */
class Bands {
  private pos: number[] = []
  private col: number[] = []
  private idx: number[] = []
  arc(from: number, to: number, r0: number, r1: number, c: Color, a: number) {
    if (!(to > from)) return
    const steps = Math.max(1, Math.ceil((to - from) / 2.5))
    const base = this.pos.length / 3
    for (let s = 0; s <= steps; s++) {
      const ang = ((from + ((to - from) * s) / steps) * Math.PI) / 180
      const x = Math.sin(ang)
      const y = Math.cos(ang)
      this.pos.push(x * r0, y * r0, 0, x * r1, y * r1, 0)
      this.col.push(c.r, c.g, c.b, a, c.r, c.g, c.b, a)
    }
    for (let s = 0; s < steps; s++) {
      const i = base + s * 2
      this.idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3)
    }
  }
  dots(from: number, to: number, r0: number, r1: number, c: Color, a: number, on = 1.3, off = 2.1) {
    for (let x = from; x < to - 0.01; x += on + off) this.arc(x, Math.min(to, x + on), r0, r1, c, a)
  }
  /** a small regular polygon centred on the circle of radius r: filled, or a ring when `inner` > 0 */
  ngon(deg: number, r: number, size: number, sides: number, inner: number, turn: number, c: Color, a: number) {
    const ang = (deg * Math.PI) / 180
    const cx = Math.sin(ang) * r
    const cy = Math.cos(ang) * r
    const base = this.pos.length / 3
    for (let k = 0; k < sides; k++) {
      const t = turn + (k / sides) * Math.PI * 2
      this.pos.push(cx + Math.cos(t) * size * inner, cy + Math.sin(t) * size * inner, 0, cx + Math.cos(t) * size, cy + Math.sin(t) * size, 0)
      this.col.push(c.r, c.g, c.b, a, c.r, c.g, c.b, a)
    }
    for (let k = 0; k < sides; k++) {
      const i = base + k * 2
      const j = base + ((k + 1) % sides) * 2
      this.idx.push(i, i + 1, j, j, i + 1, j + 1)
    }
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(this.col), 4))
    g.setIndex(new BufferAttribute(this.pos.length / 3 > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1))
    return g
  }
}

function bandMaterial(): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, uniforms: { uColor: { value: new Color() }, uTint: { value: 0 }, uOpacity: { value: 1 }, uAspect: { value: 1 }, uClip: { value: 10 } }, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide })
}

type Hot = { item: CoreItem; layer: number; inShell: boolean; anchor: Vector3; pts: Vector3[] }

type Frame = { p: Vector3; n: Vector3; b: Vector3; along: number }
type Path = { frames: Frame[]; closed: boolean }

/**
 * Thin tubes along paths. The vertex keeps the centre line in `position`; the shader pushes it out along `aDir`
 * by a half-width given in pixels, so a line is the same width at every canvas size and zoom.
 */
function sweep(paths: Path[], sides: number): BufferGeometry {
  let count = 0
  let quads = 0
  for (const p of paths) {
    count += p.frames.length * sides
    quads += (p.closed ? p.frames.length : p.frames.length - 1) * sides
  }
  const pos = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const along = new Float32Array(count)
  const index = count > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6)
  let v = 0
  let i = 0
  for (const path of paths) {
    const start = v
    const m = path.frames.length
    for (const f of path.frames) {
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2
        const c = Math.cos(a)
        const s = Math.sin(a)
        pos[v * 3] = f.p.x
        pos[v * 3 + 1] = f.p.y
        pos[v * 3 + 2] = f.p.z
        dir[v * 3] = f.n.x * c + f.b.x * s
        dir[v * 3 + 1] = f.n.y * c + f.b.y * s
        dir[v * 3 + 2] = f.n.z * c + f.b.z * s
        along[v] = f.along
        v++
      }
    }
    const segs = path.closed ? m : m - 1
    for (let s = 0; s < segs; s++) {
      const a = start + s * sides
      const b = start + ((s + 1) % m) * sides
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides
        index[i++] = a + k
        index[i++] = b + k
        index[i++] = a + k2
        index[i++] = a + k2
        index[i++] = b + k
        index[i++] = b + k2
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aDir', new BufferAttribute(dir, 3))
  g.setAttribute('aAlong', new BufferAttribute(along, 1))
  g.setIndex(new BufferAttribute(index, 1))
  return g
}

const Z = new Vector3(0, 0, 1)

/** part of a unit circle in the XY plane, from angle a0 to a1 */
function arcPath(a0: number, a1: number, segments: number, closed: boolean): Path {
  const frames: Frame[] = []
  const n = closed ? segments : segments + 1
  for (let s = 0; s < n; s++) {
    const a = a0 + ((a1 - a0) * s) / segments
    const r = new Vector3(Math.cos(a), Math.sin(a), 0)
    frames.push({ p: r, n: r.clone(), b: Z, along: Math.abs(a - a0) })
  }
  return { frames, closed }
}

function polygonPath(sides: number): Path {
  const miter = 1 / Math.cos(Math.PI / sides)
  let along = 0
  const side = 2 * Math.sin(Math.PI / sides)
  const frames = polygon(sides, 1).map(([x, y]) => {
    const p = new Vector3(x, y, 0)
    const f = { p, n: p.clone().multiplyScalar(miter), b: Z, along }
    along += side
    return f
  })
  return { frames, closed: true }
}

function tickPaths(count: number, r0: number, minor: number, major: number, every: number): Path[] {
  const out: Path[] = []
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + Math.PI / 2
    const r = new Vector3(Math.cos(a), Math.sin(a), 0)
    const t = new Vector3(-Math.sin(a), Math.cos(a), 0)
    const len = k % every === 0 ? major : minor
    out.push({ frames: [{ p: r.clone().multiplyScalar(r0), n: t, b: Z, along: 0 }, { p: r.clone().multiplyScalar(r0 + len), n: t, b: Z, along: len }], closed: false })
  }
  return out
}

function lineMaterial(back: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: { uColor: { value: new Color() }, uOpacity: { value: 1 }, uBack: { value: back }, uDash: { value: 0 }, uHalf: { value: 0.01 }, uAmp: { value: 0 }, uJit: { value: 0 }, uTime: { value: 0 }, uCam: { value: BASE_DIST }, uScale: { value: 1 }, uAspect: { value: 1 }, uClip: { value: 10 } },
    transparent: true,
    depthWrite: false,
  })
}

function nucleusMaterial(): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: NUCLEUS_VERT, fragmentShader: NUCLEUS_FRAG, uniforms: { uColor: { value: new Color() }, uBg: { value: new Color() }, uFill: { value: 0.14 }, uRim: { value: 0.7 } } })
}

type Ring = { mesh: Mesh<BufferGeometry, ShaderMaterial>; q: Quaternion; radius: number; opacity: number; angle: number }

/** Run in a later task, when the browser has a moment (never in the task that asked). */
function later(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 400 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 0)
  return () => clearTimeout(id)
}

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0)

export class CoreScene {
  private o: CoreSceneOptions
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV, 1, 0.5, 40)
  private object = new Group()
  /** scaled by the dive but never turned: the fixed tick ring and the shell being passed */
  private frame = new Group()
  /** the voice posture (rings, lattice, nucleus), drawn inside the data layers */
  private inner = new Group()
  private shell = new Group()
  private shellMesh!: Mesh<BufferGeometry, ShaderMaterial>
  private vitalsMesh!: Mesh<BufferGeometry, ShaderMaterial>
  private bars!: Mesh<BufferGeometry, ShaderMaterial>
  private gate!: Mesh<BufferGeometry, ShaderMaterial>
  private nodes!: Points<BufferGeometry, ShaderMaterial>
  private nodeIndex: number[] = []
  private latticeVerts: [number, number, number][] = []
  private data: CoreData
  private selected: string | null = null
  private hots: Hot[] = []
  private anchors: CoreAnchor[] = []
  private full: boolean
  private depth = 0
  private targetDepth = 0
  private snapAt = 0
  private layerIndex = 0
  private hist = new Float32Array(GEO.bars.count)
  private histClock = 0
  private histLive = false
  private readonly tmpV = new Vector3()
  private rings: Ring[] = []
  private ticks!: Mesh<BufferGeometry, ShaderMaterial>
  private ticksCompact!: Mesh<BufferGeometry, ShaderMaterial>
  private octagon!: Mesh<BufferGeometry, ShaderMaterial>
  private arc!: Mesh<BufferGeometry, ShaderMaterial>
  private edges!: Mesh<BufferGeometry, ShaderMaterial>
  private points!: Points<BufferGeometry, ShaderMaterial>
  private nucleus!: Mesh<SphereGeometry, ShaderMaterial>
  private dot!: Mesh<SphereGeometry, ShaderMaterial>
  private lineMats: ShaderMaterial[] = []
  private disposables: { dispose: () => void }[] = []

  private state: CoreState
  private live: boolean
  private reduced: boolean
  private lowPower: boolean
  private palette: Record<Tone | 'bg' | 'warn', Color>
  private width: number
  private height: number
  private pixelRatio = 1
  private compact = false

  private view: View = { ...HOME_VIEW }
  private target: View = { ...HOME_VIEW }
  private level = 0
  private level1 = 0
  private level2 = 0
  private time = 0
  private sinceChange = 0
  private sinceUrgent = 0
  private interactUntil = 0
  private snap = true
  private shellRadius: number
  private shellJit = 0
  private edgeOpacity = 0
  private pointOpacity = 0
  private pointSize = 2.6
  private nucleusRadius: number
  private dotRadius: number
  private fill: number
  private octagonOpacity = 0
  private arcOpacity = 0
  private moving = true

  private raf = 0
  private lastDraw = 0
  private frames = 0
  private built = false
  private ready = false
  private cancelStart: () => void = () => undefined
  private paused = false
  private disposed = false
  private readonly tmpQ = new Quaternion()
  private readonly tmpQ2 = new Quaternion()
  private readonly tmpE = new Euler()

  constructor(o: CoreSceneOptions) {
    this.o = o
    this.state = o.state
    this.live = o.live
    this.reduced = o.reduced
    this.lowPower = o.lowPower
    this.width = o.width
    this.height = o.height
    this.data = o.data ?? EMPTY_DATA
    this.full = !!o.full
    this.palette = { accent: new Color(), edge: new Color(), dim: new Color(), soft: new Color(), ink: new Color(), crit: new Color(), bg: new Color(), warn: new Color() }
    const pose = POSES[this.state]
    this.shellRadius = pose.shell.radius
    this.nucleusRadius = pose.nucleus.radius
    this.dotRadius = pose.nucleus.dot
    this.fill = pose.nucleus.fill

    // throws when WebGL is unavailable: the caller keeps the flat fallback
    this.renderer = new WebGLRenderer({ canvas: o.canvas, alpha: true, antialias: true, stencil: false, powerPreference: 'default' })
    this.renderer.setClearColor(0x000000, 0)
    // the error check reads every program log synchronously (it waits for the compile): development only
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV
    o.canvas.addEventListener('webglcontextlost', this.onLost)
    // Start-up is spread over three short tasks (context, scene, shaders) so none of them can hold a frame.
    this.cancelStart = later(() => this.build())
  }

  private build() {
    if (this.disposed) return
    const o = this.o
    const pose = POSES[this.state]
    const line = (g: BufferGeometry, back: number, order: number) => {
      const m = lineMaterial(back)
      this.lineMats.push(m)
      this.disposables.push(g, m)
      const mesh = new Mesh(g, m)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      return mesh
    }

    // fixed reference: 72 ticks (every ninth longer); it never turns, so every other motion reads against it
    this.ticks = line(sweep(tickPaths(72, TICK_RADIUS, 0.045, 0.09, 9), 4), 1, 3)
    this.ticksCompact = line(sweep(tickPaths(24, TICK_RADIUS - 0.04, 0.1, 0.1, 1), 4), 1, 3)
    this.frame.add(this.ticks, this.ticksCompact)
    this.scene.add(this.frame)

    const circle = sweep([arcPath(0, Math.PI * 2, 144, true)], 5)
    this.disposables.push(circle)
    for (let i = 0; i < 3; i++) {
      const m = lineMaterial(0.38)
      this.lineMats.push(m)
      this.disposables.push(m)
      const mesh = new Mesh(circle, m)
      mesh.frustumCulled = false
      mesh.renderOrder = 3
      this.rings.push({ mesh, q: new Quaternion(), radius: pose.rings[i].radius, opacity: pose.rings[i].opacity, angle: 0 })
      this.inner.add(mesh)
    }
    // the shell you are passing lights up in the accent as you cross it
    this.gate = line(circle, 1, 4)
    this.gate.visible = false
    this.frame.add(this.gate)
    // the work arc rides on ring C (the outer one): a quarter of the circle, from the top to the right
    this.arc = line(sweep([arcPath(Math.PI / 2, 0, 40, false)], 5), 1, 4)
    this.rings[2].mesh.add(this.arc)
    this.octagon = line(sweep([polygonPath(8)], 5), 1, 4)
    this.inner.add(this.octagon)

    // lattice: 92 points and 270 edges of a geodesic sphere, displaced in the vertex shader
    const lattice = geodesic(3)
    const paths: Path[] = lattice.edges.map(([ia, ib]) => {
      const a = new Vector3(...lattice.vertices[ia])
      const b = new Vector3(...lattice.vertices[ib])
      const t = b.clone().sub(a).normalize()
      const n = t.clone().cross(a.clone().add(b)).normalize()
      const b2 = t.clone().cross(n).normalize()
      return { frames: [{ p: a, n, b: b2, along: 0 }, { p: b, n, b: b2, along: 1 }], closed: false }
    })
    this.edges = line(sweep(paths, 3), 0.22, 3)
    const pg = new BufferGeometry()
    pg.setAttribute('position', new BufferAttribute(new Float32Array(lattice.vertices.flat()), 3))
    const pm = new ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uColor: { value: new Color() }, uOpacity: { value: 1 }, uBack: { value: 0.35 }, uSize: { value: 4 }, uAmp: { value: 0 }, uJit: { value: 0 }, uTime: { value: 0 }, uCam: { value: BASE_DIST }, uScale: { value: 1 }, uAspect: { value: 1 }, uClip: { value: 10 } },
      transparent: true,
      depthWrite: false,
    })
    this.disposables.push(pg, pm)
    this.points = new Points(pg, pm)
    this.points.frustumCulled = false
    this.points.renderOrder = 3
    // named nodes: body systems on evenly spread lattice points (attributes are filled by setData)
    this.latticeVerts = lattice.vertices
    this.nodeIndex = spread(lattice.vertices, 12)
    const ng = new BufferGeometry()
    ng.setAttribute('position', new BufferAttribute(new Float32Array(this.nodeIndex.length * 3), 3))
    ng.setAttribute('aColor', new BufferAttribute(new Float32Array(this.nodeIndex.length * 3), 3))
    ng.setAttribute('aShape', new BufferAttribute(new Float32Array(this.nodeIndex.length), 1))
    ng.setAttribute('aBig', new BufferAttribute(new Float32Array(this.nodeIndex.length), 1))
    const nmat = new ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      uniforms: { uBg: { value: new Color() }, uOpacity: { value: 1 }, uSize: { value: 10 }, uAmp: { value: 0 }, uJit: { value: 0 }, uTime: { value: 0 }, uCam: { value: BASE_DIST }, uScale: { value: 1 }, uAspect: { value: 1 }, uClip: { value: 10 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    this.disposables.push(ng, nmat)
    this.nodes = new Points(ng, nmat)
    this.nodes.frustumCulled = false
    this.nodes.renderOrder = 5
    this.shell.add(this.edges, this.points, this.nodes)
    this.inner.add(this.shell)

    // data layers: one merged mesh each (rebuilt only when the data or the selection changes)
    const band = (order: number) => {
      const m = bandMaterial()
      this.disposables.push(m)
      const mesh = new Mesh(new BufferGeometry(), m)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      return mesh
    }
    this.shellMesh = band(2)
    this.vitalsMesh = band(2)
    // voice level history: 72 bars round the nucleus, the newest at the top, running clockwise into the past
    const bg = new Bands()
    for (let k = 0; k < GEO.bars.count; k++) bg.arc(k * 5 + 1.2, k * 5 + 3.8, GEO.bars.r, GEO.bars.r + GEO.bars.rest, this.palette.ink, 1)
    const barGeo = bg.geometry()
    ;(barGeo.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage)
    this.disposables.push(barGeo)
    this.bars = band(2)
    this.bars.geometry.dispose()
    this.bars.geometry = barGeo
    this.bars.material.uniforms.uTint.value = 1
    this.object.add(this.shellMesh, this.vitalsMesh, this.bars)

    // nucleus: an opaque shell in the page colour with a flat tint and a rim line, and a solid centre
    const sphere = new SphereGeometry(1, 40, 24)
    const nm = nucleusMaterial()
    const dm = nucleusMaterial()
    dm.depthTest = false
    dm.uniforms.uFill.value = 1
    dm.uniforms.uRim.value = 2
    this.disposables.push(sphere, nm, dm)
    this.nucleus = new Mesh(sphere, nm)
    this.nucleus.renderOrder = 1
    this.dot = new Mesh(sphere, dm)
    this.dot.renderOrder = 2
    this.inner.add(this.nucleus, this.dot)
    this.object.add(this.inner)
    this.scene.add(this.object)

    this.built = true
    this.setPalette(o.palette)
    this.rebuildData()
    this.resize(this.width, this.height)
    this.update(0) // pose everything before the compile, so the first picture is the right one

    // shaders are compiled in the background where the browser can (KHR_parallel_shader_compile); the first
    // picture is drawn only once they are ready
    const begin = () => {
      if (this.disposed) return
      this.renderer.render(this.scene, this.camera)
      this.frames++
      this.ready = true
      this.o.onFrame?.()
      this.lastDraw = performance.now()
      this.o.onReady()
      this.wake()
    }
    this.cancelStart = later(() => {
      if (this.disposed) return
      try {
        this.renderer.compileAsync(this.scene, this.camera).then(begin, begin)
      } catch {
        begin()
      }
    })
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    if (this.disposed) return
    this.pause(true)
    this.o.onLost()
  }

  // ----- inputs from the component -----

  setState(state: CoreState, live: boolean) {
    if (state === this.state && live === this.live) return
    if (state !== this.state) {
      this.sinceChange = 0
      // a new state swings the view home so its pose is seen as designed (idle keeps where the person left it)
      if (state !== 'idle') this.target = homeFor(this.view)
      if (state === 'urgent') {
        this.sinceUrgent = 0
        this.snap = true // urgent appears at once, never eased in
      }
      this.state = state
      this.applyColors()
    }
    this.live = live
    this.wake()
  }

  setPalette(p: CorePalette) {
    for (const k of Object.keys(this.palette) as (Tone | 'bg' | 'warn')[]) {
      try {
        this.palette[k].set(p[k])
      } catch {
        /* keep the previous colour */
      }
    }
    this.applyColors()
    this.rebuildData()
    this.wake()
  }

  /** New data for the layers (the app's evaluation, mission or cabin readings changed). */
  setData(data: CoreData) {
    if (data === this.data) return
    this.data = data
    this.rebuildData()
    this.wake()
  }

  setSelected(id: string | null) {
    if (id === this.selected) return
    this.selected = id
    this.rebuildData()
    this.wake()
  }

  setFull(full: boolean) {
    if (full === this.full) return
    this.full = full
    this.resize(this.width, this.height)
  }

  private statusColor(s: ItemStatus, normal: Color): Color {
    return s === 'crit' ? this.palette.crit : s === 'warn' ? this.palette.warn : s === 'none' ? this.palette.edge : normal
  }

  /** Builds the two data meshes, the node attributes and the pick/label anchors from `data`. Not per frame. */
  private rebuildData() {
    if (!this.built) return
    const d = this.data
    const c = this.palette
    const sel = this.selected
    const on = (id: string) => (sel && sel !== id ? 0.42 : 1)
    const hots: Hot[] = []
    const arcHot = (item: CoreItem, layer: number, from: number, to: number, r: number, anchorR: number) => {
      const pts: Vector3[] = []
      for (let s = 0; s <= 6; s++) {
        const a = ((from + ((to - from) * s) / 6) * Math.PI) / 180
        pts.push(new Vector3(Math.sin(a) * r, Math.cos(a) * r, 0))
      }
      const m = (((from + to) / 2) * Math.PI) / 180
      hots.push({ item, layer, inShell: false, anchor: new Vector3(Math.sin(m) * anchorR, Math.cos(m) * anchorR, 0), pts })
    }

    // ----- layer 0: mission dial, cabin rail and dials -----
    const sb = new Bands()
    const dial = GEO.dial
    const step = 360 / dial.segments
    const flown = d.missionFraction == null ? 0 : Math.round(d.missionFraction * dial.segments)
    for (let k = 0; k < dial.segments; k++) {
      const filled = k < flown
      sb.arc(k * step + dial.gap / 2, (k + 1) * step - dial.gap / 2, dial.r0, dial.r1, filled ? c.soft : c.edge, (filled ? 0.95 : 0.38) * on('mission'))
    }
    if (d.mission) arcHot(d.mission, 0, GEO.missionAt - 14, GEO.missionAt + 14, (dial.r0 + dial.r1) / 2, dial.r1)
    if (d.cabin.length) sb.arc(0, 360, GEO.rail - 0.004, GEO.rail + 0.004, c.edge, 0.5)
    else sb.dots(0, 360, GEO.rail - 0.005, GEO.rail + 0.005, c.edge, 0.7, 0.9, 2.1)
    const cs = cabinSlots(d.cabin)
    cs.forEach((slot, i) => {
      const it = d.cabin[i]
      const a = on(it.id)
      sb.arc(slot.from, slot.to, GEO.rail - 0.02, GEO.rail + 0.02, c.edge, 0.55 * a)
      if (it.fraction != null) sb.arc(slot.from, slot.from + (slot.to - slot.from) * Math.max(0.03, it.fraction), GEO.rail - 0.02, GEO.rail + 0.02, this.statusColor(it.status, c.ink), a)
      // end stops, so a dial reads as a dial even when empty
      sb.arc(slot.from - 0.5, slot.from, GEO.rail - 0.04, GEO.rail + 0.04, c.dim, a)
      sb.arc(slot.to, slot.to + 0.5, GEO.rail - 0.04, GEO.rail + 0.04, c.dim, a)
      arcHot(it, 0, slot.from, slot.to, GEO.rail, GEO.rail + 0.02)
    })
    this.shellMesh.geometry.dispose()
    this.shellMesh.geometry = sb.geometry()

    // ----- layer 1: one arc per vital -----
    const vb = new Bands()
    const V = GEO.vitals
    const vs = vitalSlots(d.vitals)
    if (!vs.length) vb.dots(0, 360, V.track - 0.005, V.track + 0.005, c.edge, 0.7, 0.9, 2.1)
    vs.forEach((slot, i) => {
      const it = d.vitals[i]
      const a = on(it.id)
      if (it.status === 'none') vb.dots(slot.from, slot.to, V.r0 + 0.012, V.r1 - 0.012, c.edge, 0.85 * a)
      else {
        vb.arc(slot.from, slot.to, V.track - 0.004, V.track + 0.004, c.edge, 0.6 * a)
        const end = it.fraction == null ? slot.to : slot.from + (slot.to - slot.from) * Math.max(0.04, it.fraction)
        vb.arc(slot.from, end, V.r0, V.r1, this.statusColor(it.status, c.soft), a)
        if (it.status === 'warn') vb.ngon(slot.mid, V.marker, 0.034, 4, 0.5, 0, c.warn, a)
        if (it.status === 'crit') vb.ngon(slot.mid, V.marker, 0.036, 8, 0.56, Math.PI / 8, c.crit, a)
      }
      if (sel === it.id) {
        vb.arc(slot.from - 0.9, slot.from - 0.3, V.r0 - 0.035, V.r1 + 0.035, c.ink, 1)
        vb.arc(slot.to + 0.3, slot.to + 0.9, V.r0 - 0.035, V.r1 + 0.035, c.ink, 1)
      }
      arcHot(it, 1, slot.from, slot.to, (V.r0 + V.r1) / 2, V.r1)
    })
    this.vitalsMesh.geometry.dispose()
    this.vitalsMesh.geometry = vb.geometry()

    // ----- layer 2: named nodes -----
    const g = this.nodes.geometry
    const pos = g.getAttribute('position') as BufferAttribute
    const col = g.getAttribute('aColor') as BufferAttribute
    const shape = g.getAttribute('aShape') as BufferAttribute
    const big = g.getAttribute('aBig') as BufferAttribute
    const n = Math.min(d.systems.length, this.nodeIndex.length)
    for (let i = 0; i < this.nodeIndex.length; i++) {
      const v = this.latticeVerts[this.nodeIndex[i]]
      pos.setXYZ(i, v[0], v[1], v[2])
      if (i >= n) {
        big.setX(i, 0)
        continue
      }
      const it = d.systems[i]
      const cc = this.statusColor(it.status, c.ink)
      col.setXYZ(i, cc.r, cc.g, cc.b)
      shape.setX(i, it.status === 'warn' ? 1 : it.status === 'crit' ? 2 : it.status === 'none' ? 3 : 0)
      big.setX(i, (it.status === 'ok' ? 0.8 : 1.15) * (sel === it.id ? 1.5 : 1) * (sel && sel !== it.id ? 0.8 : 1))
      const p = new Vector3(v[0], v[1], v[2])
      hots.push({ item: it, layer: 2, inShell: true, anchor: p, pts: [p] })
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    shape.needsUpdate = true
    big.needsUpdate = true
    this.nodes.geometry.setDrawRange(0, n)
    this.hots = hots
  }

  setReduced(reduced: boolean) {
    if (reduced === this.reduced) return
    this.reduced = reduced
    this.snap = true
    this.wake()
  }

  setLowPower(lowPower: boolean) {
    if (lowPower === this.lowPower) return
    this.lowPower = lowPower
    this.resize(this.width, this.height)
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    // full screen on a big display: the drawing buffer stays within about 2.5 megapixels
    const budget = this.full ? Math.sqrt(2_500_000 / (this.width * this.height)) : 2
    this.pixelRatio = Math.max(0.75, Math.min(dpr, this.lowPower ? 1.25 : 2, budget))
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.compact = Math.min(this.width, this.height) < COMPACT_BELOW
    if (!this.built) return
    this.ticks.visible = !this.compact
    this.ticksCompact.visible = this.compact
    this.wake()
  }

  /** Off screen or in a hidden tab: stop drawing entirely. */
  pause(paused: boolean) {
    if (paused === this.paused) return
    this.paused = paused
    if (paused) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else this.wake()
  }

  // ----- view controls (pointer, keyboard, hand control) -----

  rotateBy(dx: number, dy: number) {
    this.view = rotateView(this.view, dx, dy)
    this.target = { ...this.target, yaw: this.view.yaw, pitch: this.view.pitch }
    this.touch()
  }

  /** A zoom factor (below 1 = closer) dives: pinch, Ctrl + wheel and the two-hand spread all arrive here. */
  zoomBy(factor: number, smooth = false) {
    if (this.compact) return
    this.targetDepth = diveByFactor(this.targetDepth, factor)
    if (!smooth) this.depth = this.targetDepth
    this.snapAt = performance.now() + 380 // settle on the nearest layer once the input stops
    this.touch()
  }

  /** Go to a layer (0 = shell … 3 = voice). */
  diveTo(layer: number) {
    if (this.compact) return
    this.targetDepth = clampDepth(Math.round(layer))
    this.snapAt = 0
    this.touch()
  }

  /** One layer deeper (+1) or back out (-1); false when already at the end. */
  diveBy(delta: number): boolean {
    const here = nearestLayer(this.targetDepth)
    const next = clampDepth(here + (delta > 0 ? 1 : -1))
    if (next === here) return false
    this.diveTo(next)
    return true
  }

  layer(): number {
    return nearestLayer(this.targetDepth)
  }

  reset() {
    this.target = homeFor(this.view)
    this.targetDepth = 0
    this.snapAt = 0
    this.touch()
  }

  private worldOf(h: Hot, p: Vector3, out: Vector3): Vector3 {
    return out.copy(p).applyMatrix4((h.inShell ? this.shell : this.object).matrixWorld)
  }

  /** The item under a point of the stage (CSS pixels from its top left), within `tolerance` pixels; front side only. */
  pick(x: number, y: number, tolerance = 22): CoreItem | null {
    if (!this.ready || this.compact) return null
    const focus = nearestLayer(this.targetDepth)
    let best: CoreItem | null = null
    let bestD = tolerance
    for (const h of this.hots) {
      if (h.layer < focus) continue // passed layers are behind you
      for (const p of h.pts) {
        const w = this.worldOf(h, p, this.tmpV)
        if (h.inShell && w.z < -0.02) continue
        w.project(this.camera)
        const dx = (w.x * 0.5 + 0.5) * this.width - x
        const dy = (0.5 - w.y * 0.5) * this.height - y
        // the focused layer wins a near tie
        const dd = Math.hypot(dx, dy) * (h.layer === focus ? 0.8 : 1)
        if (dd < bestD) {
          bestD = dd
          best = h.item
        }
      }
    }
    return best
  }

  /** Stage positions of the items of the layer in focus (the array and its objects are reused between calls). */
  layout(): CoreAnchor[] {
    const focus = nearestLayer(this.targetDepth)
    let n = 0
    for (const h of this.hots) {
      if (h.layer !== focus) continue
      const w = this.worldOf(h, h.anchor, this.tmpV)
      const front = !h.inShell || w.z > 0.04 * this.shellRadius
      w.project(this.camera)
      const a = this.anchors[n] ?? (this.anchors[n] = { id: '', x: 0, y: 0, front: true })
      a.id = h.item.id
      a.x = (w.x * 0.5 + 0.5) * this.width
      a.y = (0.5 - w.y * 0.5) * this.height
      a.front = front
      n++
    }
    this.anchors.length = n
    return this.anchors
  }

  private touch() {
    this.interactUntil = performance.now() + 160
    this.wake()
  }

  stats(): CoreStats {
    return { ready: this.ready, running: this.raf !== 0, paused: this.paused, frames: this.frames, rate: this.rate(), state: this.state, level: this.level, view: { ...this.view }, pixelRatio: this.pixelRatio, depth: this.depth, layer: nearestLayer(this.targetDepth), calls: this.renderer.info.render.calls }
  }

  // ----- drawing -----

  private rate() {
    return frameRate({ state: this.state, live: this.live, reduced: this.reduced, lowPower: this.lowPower, moving: this.moving, level: this.level })
  }

  private wake() {
    if (this.raf || this.paused || this.disposed || !this.ready) return
    this.moving = true // at least one frame is drawn after any change
    this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    this.raf = 0
    if (this.disposed || this.paused) return
    const rate = this.rate()
    const gap = now - this.lastDraw
    if (rate !== 30 || gap >= 1000 / 30 - 3) {
      // after a pause or a still period the clock does not jump
      const dt = gap > 250 ? 1 / 60 : Math.max(0, gap / 1000)
      this.lastDraw = now
      this.update(dt)
      this.renderer.render(this.scene, this.camera)
      this.frames++
      this.o.onFrame?.()
    }
    if (this.rate() > 0) this.raf = requestAnimationFrame(this.tick)
  }

  private applyColors() {
    if (!this.built) return
    const pose = POSES[this.state]
    const c = this.palette
    pose.rings.forEach((r, i) => (this.rings[i].mesh.material.uniforms.uColor.value as Color).copy(c[r.tone]))
    ;(this.ticks.material.uniforms.uColor.value as Color).copy(c.edge)
    ;(this.ticksCompact.material.uniforms.uColor.value as Color).copy(c.edge)
    ;(this.octagon.material.uniforms.uColor.value as Color).copy(c.crit)
    ;(this.arc.material.uniforms.uColor.value as Color).copy(c.accent)
    ;(this.gate.material.uniforms.uColor.value as Color).copy(c.accent)
    ;(this.bars.material.uniforms.uColor.value as Color).copy(this.state === 'off' ? c.edge : c[pose.nucleus.tone])
    ;(this.nodes.material.uniforms.uBg.value as Color).copy(c.bg)
    ;(this.edges.material.uniforms.uColor.value as Color).copy(c.dim)
    ;(this.points.material.uniforms.uColor.value as Color).copy(c[pose.shell.tone])
    for (const m of [this.nucleus.material, this.dot.material]) {
      ;(m.uniforms.uColor.value as Color).copy(c[pose.nucleus.tone])
      ;(m.uniforms.uBg.value as Color).copy(c.bg)
    }
  }

  private ringTarget(r: RingPose, angle: number, out: Quaternion) {
    const e = this.tmpE
    const q = this.tmpQ2
    if (r.motion === 'gimbalY') out.setFromEuler(e.set(0, r.tilt + angle, 0))
    else out.setFromEuler(e.set(r.tilt + (r.motion === 'gimbalX' ? angle : 0), 0, 0))
    out.premultiply(q.setFromEuler(e.set(0, 0, r.roll)))
    if (r.motion === 'precess') out.premultiply(q.setFromEuler(e.set(0, angle, 0)))
    return out
  }

  private update(dt: number) {
    const pose = POSES[this.state]
    const still = this.reduced
    const snap = this.snap || still
    this.snap = false
    const k = snap ? 1 : 1 - Math.exp(-dt / POSE_TAU)
    this.sinceChange += dt
    if (this.state === 'urgent') this.sinceUrgent += dt
    if (!still) this.time += dt

    // voice level: quick to rise, slow to settle; two delayed copies make the rings follow one after another
    const raw = this.live && !still ? clamp01(this.o.level()) : 0
    this.level = snap && still ? 0 : follow(this.level, raw, dt, 0.06, 0.3)
    this.level1 = follow(this.level1, this.level, dt, 0.08)
    this.level2 = follow(this.level2, this.level1, dt, 0.08)
    if (this.level < 0.001) this.level = 0
    const pulse = this.state === 'urgent' && !still ? urgentPulse(this.sinceUrgent) : 0

    // view
    if (still || viewSettled(this.view, this.target)) this.view = { ...this.target }
    else {
      const kv = 1 - Math.exp(-dt / VIEW_TAU)
      this.view = { yaw: this.view.yaw + (this.target.yaw - this.view.yaw) * kv, pitch: this.view.pitch + (this.target.pitch - this.view.pitch) * kv, zoom: this.view.zoom + (this.target.zoom - this.view.zoom) * kv }
    }
    this.object.quaternion.setFromEuler(this.tmpE.set(this.view.pitch, this.view.yaw, 0))
    const aspect = this.width / this.height
    // the dive: depth eases to its target and settles on the nearest layer once the input stops (reduced motion: a cut)
    const nowMs = performance.now()
    if (this.compact) this.targetDepth = 0
    if (this.snapAt && (nowMs >= this.snapAt || still)) {
      this.targetDepth = nearestLayer(this.targetDepth)
      this.snapAt = 0
    }
    if (still || Math.abs(this.targetDepth - this.depth) < 0.003) this.depth = this.targetDepth
    else this.depth += (this.targetDepth - this.depth) * (1 - Math.exp(-dt / 0.17))
    const focus = nearestLayer(this.targetDepth)
    if (focus !== this.layerIndex) {
      this.layerIndex = focus
      this.o.onLayer?.(focus)
    }
    const zoom = zoomForDepth(this.depth) * this.view.zoom
    const innerScale = this.compact ? 1 : INNER_SCALE
    const dist = BASE_DIST * (aspect < 1 ? 1 / aspect : 1) * (this.full ? 1.12 : 1)
    this.object.scale.setScalar(zoom)
    this.frame.scale.setScalar(zoom)
    this.inner.scale.setScalar(innerScale)
    this.camera.position.z = dist
    // world units per CSS pixel at the centre of the core: line widths are given in pixels
    const perPx = (2 * dist * TAN_HALF) / this.height
    const thick = this.compact ? 1.15 : 1

    // rings: B is the inner one in the listening and speaking poses, so it leads; A follows, then C
    const lv = [this.level1, this.level, this.level2]
    this.rings.forEach((ring, i) => {
      const r = pose.rings[i]
      if (still) ring.angle = 0
      else if (r.motion !== 'still') ring.angle += r.rate * dt
      this.ringTarget(r, ring.angle, this.tmpQ)
      if (snap) ring.q.copy(this.tmpQ)
      else ring.q.slerp(this.tmpQ, k)
      ring.radius += (r.radius - ring.radius) * k
      ring.opacity += (r.opacity - ring.opacity) * k
      ring.mesh.quaternion.copy(ring.q)
      ring.mesh.scale.setScalar(ring.radius * (1 + r.react * lv[i]))
      const u = ring.mesh.material.uniforms
      u.uOpacity.value = ring.opacity * passFade(ring.radius * innerScale, zoom)
      u.uHalf.value = r.width * thick * 0.5 * perPx
      u.uDash.value = r.dashed ? (this.compact ? 0.3 : 0.11) : 0
      ring.mesh.visible = u.uOpacity.value > 0.004
    })

    this.arcOpacity += (pose.arc - this.arcOpacity) * k
    if (still) this.arc.rotation.z = 0
    else if (pose.arc > 0) this.arc.rotation.z -= ((Math.PI * 2) / ARC_PERIOD) * dt
    this.arc.material.uniforms.uOpacity.value = this.arcOpacity
    this.arc.material.uniforms.uHalf.value = 1.5 * thick * perPx
    this.arc.visible = this.arcOpacity > 0.004

    this.octagonOpacity += (pose.octagon - this.octagonOpacity) * k
    this.octagon.scale.setScalar(OCTAGON_RADIUS * (1 + 0.045 * pulse))
    this.octagon.material.uniforms.uOpacity.value = this.octagonOpacity
    this.octagon.material.uniforms.uHalf.value = 1.25 * thick * perPx
    this.octagon.visible = this.octagonOpacity > 0.004

    const shellFade = passFade(LAYERS[0].radius, zoom)
    for (const t of [this.ticks, this.ticksCompact]) {
      t.material.uniforms.uOpacity.value = (this.state === 'off' ? 0.6 : 0.95) * shellFade
      t.material.uniforms.uHalf.value = 0.5 * perPx
    }
    this.shellMesh.visible = !this.compact && shellFade > 0.004
    this.shellMesh.material.uniforms.uOpacity.value = shellFade
    const vitalsFade = passFade(LAYERS[1].radius, zoom)
    this.vitalsMesh.visible = !this.compact && vitalsFade > 0.004
    this.vitalsMesh.material.uniforms.uOpacity.value = vitalsFade
    // the shell being crossed: an accent ring that grows past you
    const flash = still ? 0 : passFlash(this.depth)
    this.gate.visible = flash > 0.02
    if (this.gate.visible) {
      this.gate.scale.setScalar(LAYERS[Math.min(MAX_DEPTH, Math.floor(this.depth))].radius * 1.04)
      this.gate.material.uniforms.uOpacity.value = flash * 0.9
      this.gate.material.uniforms.uHalf.value = 1 * perPx
    }

    // voice level history: sampled 24 times a second while a level is fed, then it runs out to a flat line
    this.histClock += dt
    if (this.histClock >= 1 / 24) {
      this.histClock = 0
      const h = this.hist
      const v = this.live ? this.level : 0
      this.histLive = v > 0.004
      if (!this.histLive) for (let i = 0; i < h.length; i++) if (h[i] > 0.004) this.histLive = true
      if (this.histLive) {
        h.copyWithin(1, 0, h.length - 1)
        h[0] = v
        const pos = this.bars.geometry.getAttribute('position') as BufferAttribute
        const arr = pos.array as Float32Array
        // each bar is 2 steps = 3 pairs of (inner, outer) vertices; only the outer ones move
        for (let k2 = 0; k2 < h.length; k2++) {
          const r1 = GEO.bars.r + GEO.bars.rest + GEO.bars.max * h[k2]
          for (let s = 0; s < 3; s++) {
            const vi = (k2 * 6 + s * 2 + 1) * 3
            const a = ((k2 * 5 + 1.2 + 1.3 * s) * Math.PI) / 180
            arr[vi] = Math.sin(a) * r1
            arr[vi + 1] = Math.cos(a) * r1
          }
        }
        pos.needsUpdate = true
      }
    }
    this.bars.visible = !this.compact
    this.bars.material.uniforms.uOpacity.value = this.state === 'off' ? 0.5 : 0.9

    // lattice
    const sh = pose.shell
    this.shellRadius += (sh.radius - this.shellRadius) * k
    this.shellJit += ((still ? 0 : sh.jitter) - this.shellJit) * k
    this.edgeOpacity += ((this.compact ? 0 : sh.edges) - this.edgeOpacity) * k
    this.pointOpacity += ((this.compact ? 0 : sh.points) - this.pointOpacity) * k
    this.pointSize += (sh.size - this.pointSize) * k
    this.shell.scale.setScalar(this.shellRadius)
    if (still) this.shell.rotation.set(0.35, 0.5, 0)
    else this.shell.rotation.y += sh.drift * dt
    const amp = sh.react * this.level
    for (const m of [this.edges.material, this.points.material]) {
      m.uniforms.uAmp.value = amp
      m.uniforms.uJit.value = this.shellJit
      m.uniforms.uTime.value = this.time
    }
    this.edges.material.uniforms.uOpacity.value = this.edgeOpacity
    this.edges.material.uniforms.uHalf.value = 0.5 * perPx
    this.points.material.uniforms.uOpacity.value = this.pointOpacity
    this.points.material.uniforms.uSize.value = this.pointSize * (1 + (sh.react > 0.1 ? 0.6 * this.level : 0)) * this.pixelRatio
    const latticeFade = passFade(this.shellRadius * innerScale, zoom)
    this.edges.material.uniforms.uOpacity.value *= latticeFade
    this.points.material.uniforms.uOpacity.value *= latticeFade
    const nm = this.nodes.material.uniforms
    nm.uAmp.value = amp
    nm.uJit.value = this.shellJit
    nm.uTime.value = this.time
    nm.uOpacity.value = this.compact ? 0 : latticeFade
    // nodes are about 9 px at the shell and grow as you come closer
    nm.uSize.value = Math.min(26, 9 * Math.sqrt(zoom) * (this.height > 420 ? 1.25 : 1)) * this.pixelRatio
    this.nodes.visible = !this.compact && latticeFade > 0.004
    this.shell.visible = this.pointOpacity > 0.004 || this.edgeOpacity > 0.004 || this.nodes.visible

    // nucleus
    const nu = pose.nucleus
    this.nucleusRadius += (nu.radius - this.nucleusRadius) * k
    this.dotRadius += (nu.dot - this.dotRadius) * k
    this.fill += (nu.fill - this.fill) * k
    const breathe = still ? 0 : nu.breathe * Math.sin((this.time * Math.PI * 2) / 6)
    // on the compact strip the nucleus is drawn larger, or it would be a speck
    const big = this.compact ? 1.35 : 1
    const outer = this.nucleusRadius * big * (1 + breathe + nu.react * this.level + 0.05 * pulse)
    this.nucleus.scale.setScalar(outer)
    this.dot.scale.setScalar(Math.max(0.0001, this.dotRadius * big * (1 + breathe + nu.react * 1.2 * this.level + 0.08 * pulse)))
    this.dot.visible = this.dotRadius > 0.004
    this.nucleus.material.uniforms.uFill.value = this.fill
    // rim line of about 1.5 px (a little more on the compact strip): where the sphere's edge starts, as 1 - cos
    const edge = 1 - Math.min(0.9, (1.5 * thick) / Math.max(4, (outer * innerScale * zoom) / perPx))
    this.nucleus.material.uniforms.uRim.value = 1 - Math.sqrt(1 - edge * edge)

    // what leaves the view fades at its edge instead of being cut by the canvas (full screen: only the far corners)
    const clip = (this.full ? 6 : this.compact ? 10 : 1.75) / (dist * TAN_HALF)
    for (const m of [...this.lineMats, this.points.material, this.nodes.material]) {
      m.uniforms.uCam.value = dist
      m.uniforms.uScale.value = zoom * innerScale
      m.uniforms.uAspect.value = aspect
      m.uniforms.uClip.value = clip
    }
    for (const m of [this.shellMesh.material, this.vitalsMesh.material, this.bars.material]) {
      m.uniforms.uAspect.value = aspect
      m.uniforms.uClip.value = clip
    }

    this.moving = !still && (Math.abs(this.targetDepth - this.depth) >= 0.003 || this.snapAt > 0 || this.histLive && !this.live || this.sinceChange < 0.7 || !viewSettled(this.view, this.target) || (this.state === 'urgent' && this.sinceUrgent < URGENT_PULSES + 0.1) || performance.now() < this.interactUntil || this.level > 0.02 && !this.live)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cancelStart()
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.o.canvas.removeEventListener('webglcontextlost', this.onLost)
    for (const d of this.disposables) d.dispose()
    this.shellMesh?.geometry.dispose()
    this.vitalsMesh?.geometry.dispose()
    this.renderer.dispose()
    // give the context back at once instead of waiting for garbage collection (browsers cap live contexts)
    this.renderer.forceContextLoss()
  }
}
