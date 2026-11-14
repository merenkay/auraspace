// Hand detection off the main thread (module worker). Receives downscaled camera frames as ImageBitmaps
// (transferred, never copied), runs MediaPipe Hand Landmarker, and posts back only the 21 landmarks per hand.
// Nothing here touches the network except the self-hosted runtime and model under /mediapipe/; no frame or
// landmark leaves the device.
//
// The WebAssembly runtime is the "module" build (vision_wasm_module_internal.*): a module worker has no
// importScripts, so the classic loader that the main-thread path uses cannot run here.
//
// Delegate choice: the GPU path is not always faster (software or weak GPUs, a GPU busy with the 3D viewer), so
// the worker measures a few frames on the GPU, then a few on the CPU, and keeps the faster one.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

export type WorkerIn =
  | { type: 'init'; wasmBase: string; modelUrl: string; numHands: number }
  | { type: 'frame'; id: number; t: number; bitmap: ImageBitmap }
  /** how many hands to look for (1 is much cheaper: the palm detector stops once that hand is tracked) */
  | { type: 'hands'; n: number }
  | { type: 'close' }

export type WorkerHand = { landmarks: { x: number; y: number; z: number }[]; handedness: string | null }
export type WorkerOut =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'result'; id: number; t: number; ms: number; hands: WorkerHand[]; delegate: Delegate }
  /** the frame was not processed (switching delegates): the next one can be sent */
  | { type: 'skip'; id: number }
  | { type: 'delegate'; delegate: Delegate; gpuMs: number | null; cpuMs: number | null }
  | { type: 'error'; phase: 'init' | 'run'; message: string }

type Delegate = 'GPU' | 'CPU'

const scope = self as unknown as { postMessage: (m: WorkerOut) => void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null; close: () => void }

// MediaPipe loads its runtime through `self.import(url)` when that exists, then expects `self.ModuleFactory` and
// clears it after building a landmarker. A second landmarker (the CPU one for the benchmark or a fallback) would
// re-import a module that is already cached and never sets it again, so set it from the module's export each time.
;(self as unknown as { import: (url: string) => Promise<void> }).import = async (url: string) => {
  const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown }
  if (mod.default) (self as unknown as { ModuleFactory: unknown }).ModuleFactory = mod.default
}

const WARMUP = 3
const MEASURE = 8

let make: ((d: Delegate) => Promise<HandLandmarker>) | null = null
let lm: HandLandmarker | null = null
let delegate: Delegate = 'GPU'
let lastT = 0
let numHands = 1
let closed = false
// benchmark: 'gpu' (measuring the GPU), 'cpu' (measuring the CPU), 'done'
const bench = { phase: 'done' as 'gpu' | 'cpu' | 'done', n: 0, times: [] as number[], gpuMs: null as number | null, cpu: null as HandLandmarker | null, creating: false }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function shut(x: HandLandmarker | null) {
  try {
    x?.close()
  } catch {
    /* already closed */
  }
}

async function init(m: Extract<WorkerIn, { type: 'init' }>) {
  numHands = m.numHands
  try {
    const [fileset, model] = await Promise.all([
      FilesetResolver.forVisionTasks(m.wasmBase, true),
      fetch(m.modelUrl).then((r) => {
        if (!r.ok) throw new Error(`model ${r.status}`)
        return r.arrayBuffer()
      }),
    ])
    const bytes = new Uint8Array(model)
    make = (d) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: bytes, delegate: d },
        runningMode: 'VIDEO',
        numHands,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      })
    try {
      lm = await make('GPU')
      delegate = 'GPU'
      bench.phase = 'gpu'
    } catch {
      lm = await make('CPU')
      delegate = 'CPU'
      bench.phase = 'done'
      scope.postMessage({ type: 'delegate', delegate, gpuMs: null, cpuMs: null })
    }
    if (closed) return shut(lm)
    scope.postMessage({ type: 'ready', delegate })
  } catch (e) {
    scope.postMessage({ type: 'error', phase: 'init', message: String((e as Error)?.message ?? e) })
  }
}

function measure(ms: number) {
  if (bench.phase === 'done') return
  bench.n++
  if (bench.n > WARMUP) bench.times.push(ms)
  if (bench.times.length < MEASURE) return
  const m = median(bench.times)
  bench.times = []
  bench.n = 0
  if (bench.phase === 'gpu') {
    bench.gpuMs = m
    // build the CPU landmarker in the background, keep detecting on the GPU meanwhile
    bench.phase = 'cpu'
    bench.creating = true
    make!('CPU')
      .then((cpu) => {
        bench.creating = false
        if (closed) return shut(cpu)
        bench.cpu = cpu
      })
      .catch(() => {
        bench.creating = false
        bench.phase = 'done'
        scope.postMessage({ type: 'delegate', delegate, gpuMs: bench.gpuMs, cpuMs: null })
      })
    return
  }
  // phase 'cpu' finished: keep the faster one (the GPU only when it is clearly faster: it also loads the GPU
  // that renders the page)
  const cpuMs = m
  const gpuMs = bench.gpuMs ?? Infinity
  if (gpuMs < cpuMs * 0.85) {
    shut(bench.cpu)
  } else {
    shut(lm)
    lm = bench.cpu
    delegate = 'CPU'
  }
  bench.cpu = null
  bench.phase = 'done'
  scope.postMessage({ type: 'delegate', delegate, gpuMs: bench.gpuMs, cpuMs })
}

function detect(m: Extract<WorkerIn, { type: 'frame' }>) {
  const bitmap = m.bitmap
  try {
    // during the CPU measurement the CPU landmarker runs the frames
    const useCpu = bench.phase === 'cpu' && bench.cpu
    const runner = useCpu ? bench.cpu! : lm
    if (!runner) return scope.postMessage({ type: 'skip', id: m.id })
    const t = Math.max(m.t, lastT + 1)
    lastT = t
    const t0 = performance.now()
    let r
    try {
      r = runner.detectForVideo(bitmap, t)
    } catch (e) {
      if (!useCpu && delegate === 'GPU' && make) {
        // the GPU path failed at run time: continue on the CPU
        shut(lm)
        lm = null
        bench.phase = 'done'
        void make('CPU').then((cpu) => {
          if (closed) return shut(cpu)
          lm = cpu
          delegate = 'CPU'
          scope.postMessage({ type: 'delegate', delegate, gpuMs: null, cpuMs: null })
        }, (e2) => scope.postMessage({ type: 'error', phase: 'run', message: String(e2) }))
        return scope.postMessage({ type: 'skip', id: m.id })
      }
      throw e
    }
    const ms = performance.now() - t0
    if (bench.phase !== 'done' && (bench.phase === 'gpu' || useCpu)) measure(ms)
    scope.postMessage({
      type: 'result',
      id: m.id,
      t: m.t,
      ms,
      delegate: useCpu ? 'CPU' : delegate,
      hands: r.landmarks.map((points, i) => ({
        landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        handedness: r.handedness[i]?.[0]?.categoryName ?? null,
      })),
    })
  } catch (e) {
    scope.postMessage({ type: 'error', phase: 'run', message: String((e as Error)?.message ?? e) })
  } finally {
    bitmap.close()
  }
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') void init(m)
  else if (m.type === 'frame') {
    if (closed) m.bitmap.close()
    else detect(m)
  } else if (m.type === 'hands') {
    if (m.n === numHands) return
    numHands = m.n
    for (const x of [lm, bench.cpu]) void x?.setOptions({ numHands }).catch(() => undefined)
  } else if (m.type === 'close') {
    closed = true
    shut(lm)
    shut(bench.cpu)
    lm = null
    scope.close()
  }
}
