// The AURA core in WebGL: a fixed tick ring, three rings, a geodesic lattice of points and a nucleus.
// Loaded lazily (this file is the only one in the folder that imports three.js). Everything is procedural:
// no model, no texture. Flat hairlines of a constant pixel width, no glow, no blur, no post-processing.
//
// Cost control: one small context, three shader programs compiled before the first picture, a draw loop that
// runs at 30 frames a second while the core idles, at the display rate only while a voice level or a drag is
// actually moving it, and not at all when the pose is still (urgent after its pulses, voice off, reduced
// motion), when the canvas is off screen or when the tab is hidden.
import { BufferAttribute, BufferGeometry, Color, Euler, Group, Mesh, PerspectiveCamera, Points, Quaternion, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer } from 'three'
import { geodesic, polygon } from './geometry'
import { ARC_PERIOD, follow, frameRate, HOME_VIEW, homeFor, OCTAGON_RADIUS, POSES, POSE_TAU, rotateView, TICK_RADIUS, URGENT_PULSES, urgentPulse, viewSettled, zoomView, type CoreState, type RingPose, type Tone, type View } from './model'

export type CorePalette = Record<Tone | 'bg', string>

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
  onReady: () => void
  /** the WebGL context was lost: the caller switches to the flat fallback */
  onLost: () => void
}

export type CoreStats = { ready: boolean; running: boolean; paused: boolean; frames: number; rate: number; state: CoreState; level: number; view: View; pixelRatio: number }

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
  private shell = new Group()
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
  private palette: Record<Tone | 'bg', Color>
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
    this.palette = { accent: new Color(), edge: new Color(), dim: new Color(), soft: new Color(), ink: new Color(), crit: new Color(), bg: new Color() }
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
    this.scene.add(this.ticks, this.ticksCompact)

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
      this.object.add(mesh)
    }
    // the work arc rides on ring C (the outer one): a quarter of the circle, from the top to the right
    this.arc = line(sweep([arcPath(Math.PI / 2, 0, 40, false)], 5), 1, 4)
    this.rings[2].mesh.add(this.arc)
    this.octagon = line(sweep([polygonPath(8)], 5), 1, 4)
    this.object.add(this.octagon)

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
    this.shell.add(this.edges, this.points)
    this.object.add(this.shell)

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
    this.object.add(this.nucleus, this.dot)
    this.scene.add(this.object)

    this.built = true
    this.setPalette(o.palette)
    this.resize(this.width, this.height)
    this.update(0) // pose everything before the compile, so the first picture is the right one

    // shaders are compiled in the background where the browser can (KHR_parallel_shader_compile); the first
    // picture is drawn only once they are ready
    const begin = () => {
      if (this.disposed) return
      this.renderer.render(this.scene, this.camera)
      this.frames++
      this.ready = true
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
    for (const k of Object.keys(this.palette) as (Tone | 'bg')[]) {
      try {
        this.palette[k].set(p[k])
      } catch {
        /* keep the previous colour */
      }
    }
    this.applyColors()
    this.wake()
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
    this.pixelRatio = Math.min(dpr, this.lowPower ? 1.25 : 2)
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

  zoomBy(factor: number, smooth = false) {
    this.target = zoomView(this.target, factor)
    if (!smooth) this.view = { ...this.view, zoom: this.target.zoom }
    this.touch()
  }

  reset() {
    this.target = homeFor(this.view)
    this.touch()
  }

  private touch() {
    this.interactUntil = performance.now() + 160
    this.wake()
  }

  stats(): CoreStats {
    return { ready: this.ready, running: this.raf !== 0, paused: this.paused, frames: this.frames, rate: this.rate(), state: this.state, level: this.level, view: { ...this.view }, pixelRatio: this.pixelRatio }
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
    // zoom scales the core inside the fixed tick ring (the camera never moves)
    const dist = BASE_DIST * (aspect < 1 ? 1 / aspect : 1)
    this.object.scale.setScalar(this.view.zoom)
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
      u.uOpacity.value = ring.opacity
      u.uHalf.value = r.width * thick * 0.5 * perPx
      u.uDash.value = r.dashed ? (this.compact ? 0.3 : 0.11) : 0
      ring.mesh.visible = ring.opacity > 0.004
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

    for (const t of [this.ticks, this.ticksCompact]) {
      t.material.uniforms.uOpacity.value = this.state === 'off' ? 0.6 : 0.95
      t.material.uniforms.uHalf.value = 0.5 * perPx
    }

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
    this.shell.visible = this.pointOpacity > 0.004 || this.edgeOpacity > 0.004

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
    const edge = 1 - Math.min(0.9, (1.5 * thick) / Math.max(4, outer / perPx))
    this.nucleus.material.uniforms.uRim.value = 1 - Math.sqrt(1 - edge * edge)

    const clip = (TICK_RADIUS - 0.03) / (dist * TAN_HALF)
    for (const m of [...this.lineMats, this.points.material]) {
      m.uniforms.uCam.value = dist
      m.uniforms.uScale.value = this.view.zoom
      m.uniforms.uAspect.value = aspect
      m.uniforms.uClip.value = clip
    }
    this.ticks.material.uniforms.uClip.value = 10
    this.ticksCompact.material.uniforms.uClip.value = 10

    this.moving = !still && (this.sinceChange < 0.7 || !viewSettled(this.view, this.target) || (this.state === 'urgent' && this.sinceUrgent < URGENT_PULSES + 0.1) || performance.now() < this.interactUntil || this.level > 0.02 && !this.live)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cancelStart()
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.o.canvas.removeEventListener('webglcontextlost', this.onLost)
    for (const d of this.disposables) d.dispose()
    this.renderer.dispose()
    // give the context back at once instead of waiting for garbage collection (browsers cap live contexts)
    this.renderer.forceContextLoss()
  }
}
