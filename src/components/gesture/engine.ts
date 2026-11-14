// Camera + MediaPipe Hand Landmarker. Loaded only when hand control is switched on (this module, the worker and
// the MediaPipe library are separate lazy chunks; the WebAssembly runtime and the model are self-hosted under
// /mediapipe/ and cached by the service worker on first use). Everything runs in this browser: no frame,
// landmark or image leaves the device.
//
// Fast path: detection runs in a module Web Worker (hand.worker.ts). Each new camera frame (requestVideoFrameCallback)
// is downscaled by the browser while it is turned into an ImageBitmap, and transferred (not copied) to the worker.
// Only one frame is in flight: frames that arrive while the worker is busy are dropped, never queued, so the
// result is always about the newest picture. Fallback (no Worker / OffscreenCanvas / createImageBitmap, or the
// worker fails to start): the same detection on the main thread, on a downscaled canvas, between rendered frames.
import type { RawFrame } from '../../lib/gesture/machine'
import type { WorkerIn, WorkerOut } from './hand.worker'

export type HandErrorKind = 'insecure' | 'unsupported' | 'denied' | 'no-camera' | 'busy' | 'model'

export class HandError extends Error {
  kind: HandErrorKind
  constructor(kind: HandErrorKind, cause?: unknown) {
    super(kind)
    this.kind = kind
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

const WASM_BASE = '/mediapipe/wasm'
const MODEL_URL = '/mediapipe/hand_landmarker.task'
/** long side of the picture given to the model (the camera delivers 640 x 480; MediaPipe works at 192–224 px inside) */
export const DETECT_LONG = 384

export function supported(): HandErrorKind | null {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (!navigator.mediaDevices?.getUserMedia || typeof WebAssembly === 'undefined') return 'unsupported'
  return null
}

export async function openCamera(): Promise<MediaStream> {
  const why = supported()
  if (why) throw new HandError(why)
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      // a modest picture: the model does not need more, and a smaller one is cheaper to copy and to scale
      video: { facingMode: 'user', width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } },
    })
  } catch (e) {
    const name = (e as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new HandError('denied', e)
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') throw new HandError('no-camera', e)
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') throw new HandError('busy', e)
    throw new HandError('unsupported', e)
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Measured performance, for the camera dock. */
export type TrackerStats = {
  mode: 'worker' | 'main'
  delegate: 'GPU' | 'CPU'
  /** detections per second over the last second */
  fps: number
  /** model time per frame, ms (moving average) */
  detectMs: number
  /** camera frame -> landmarks available on the main thread, ms (moving average) */
  latencyMs: number
  frames: number
  dropped: number
  bench: { gpuMs: number | null; cpuMs: number | null } | null
  input: string
  /** mean brightness 0..255 of the camera picture, measured in the worker (null: not measured there) */
  light: number | null
  /** one <-> two hand switches, and how long the last one took in the worker (ms) */
  handSwitches: number
  handSwitchMs: number
}

export type Tracker = {
  stats: TrackerStats
  /** start feeding frames from the video; returns stop */
  start: (video: HTMLVideoElement, onFrame: (f: RawFrame) => void, onError: (e: unknown) => void) => () => void
  /** look for 1 hand (cheapest) or 2 (two-hand zoom over the 3D body) */
  setHands: (n: 1 | 2) => void
  close: () => void
}

function detectSize(video: HTMLVideoElement) {
  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 480
  const k = Math.min(1, DETECT_LONG / Math.max(vw, vh))
  return { w: Math.max(2, Math.round(vw * k)), h: Math.max(2, Math.round(vh * k)), aspect: vw / vh }
}

type VideoWithRvfc = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number; cancelVideoFrameCallback?: (h: number) => void }

/**
 * Calls `onNew(t)` once per new camera frame: with requestVideoFrameCallback at the camera's own cadence, else
 * by polling `currentTime` every 10 ms. Pauses while the page is hidden. Returns stop.
 */
function frames(video: HTMLVideoElement, onNew: (t: number) => void): () => void {
  const v = video as VideoWithRvfc
  let stopped = false
  let handle = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  if (typeof v.requestVideoFrameCallback === 'function') {
    const cb = () => {
      if (stopped) return
      if (!document.hidden) onNew(performance.now())
      handle = v.requestVideoFrameCallback!(cb)
    }
    handle = v.requestVideoFrameCallback(cb)
    return () => {
      stopped = true
      v.cancelVideoFrameCallback?.(handle)
    }
  }
  let last = -1
  const poll = () => {
    if (stopped) return
    if (!document.hidden && video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime
      onNew(performance.now())
    }
    timer = setTimeout(poll, document.hidden ? 400 : 10)
  }
  poll()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

function newStats(mode: 'worker' | 'main', delegate: 'GPU' | 'CPU'): TrackerStats {
  return { mode, delegate, fps: 0, detectMs: 0, latencyMs: 0, frames: 0, dropped: 0, bench: null, input: '', light: null, handSwitches: 0, handSwitchMs: 0 }
}

/** detection-rate meter: results in the last second */
function meter(stats: TrackerStats) {
  const times: number[] = []
  return (t: number, detectMs: number, latencyMs: number) => {
    times.push(t)
    while (times.length && t - times[0] > 1000) times.shift()
    stats.fps = times.length
    stats.frames++
    stats.detectMs = stats.detectMs ? stats.detectMs * 0.85 + detectMs * 0.15 : detectMs
    stats.latencyMs = stats.latencyMs ? stats.latencyMs * 0.85 + latencyMs * 0.15 : latencyMs
  }
}

function workerCapable() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
}

// ---------------------------------------------------------------------------------------------------------
// worker path
// ---------------------------------------------------------------------------------------------------------
async function createWorkerTracker(): Promise<Tracker> {
  const worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module', name: 'aura-hand' })
  const post = (m: WorkerIn, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
  let listener: ((m: WorkerOut) => void) | null = null
  const ready = new Promise<'GPU' | 'CPU'>((resolve, reject) => {
    listener = (m) => {
      if (m.type === 'ready') resolve(m.delegate)
      else if (m.type === 'error' && m.phase === 'init') reject(new Error(m.message))
    }
    worker.onerror = (e) => reject(new Error(e.message || 'worker failed to start'))
  })
  worker.onmessage = (e: MessageEvent<WorkerOut>) => listener?.(e.data)
  // absolute URLs: the runtime is loaded with a dynamic import(), which the dev server would otherwise rewrite
  post({ type: 'init', wasmBase: new URL(WASM_BASE, location.href).href, modelUrl: new URL(MODEL_URL, location.href).href, numHands: 1 })
  let delegate: 'GPU' | 'CPU'
  try {
    delegate = await ready
  } catch (e) {
    worker.terminate()
    throw e
  }
  const stats = newStats('worker', delegate)
  let closed = false
  const tracker: Tracker = {
    stats,
    start(video, onFrame, onError) {
      let inFlight: { id: number; t: number } | null = null
      let nextId = 1
      let size = detectSize(video)
      const record = meter(stats)
      worker.onerror = (e) => {
        if (!closed) onError(new Error(e.message))
      }
      listener = (m) => {
        if (m.type === 'result') {
          if (inFlight?.id === m.id) inFlight = null
          const now = performance.now()
          stats.delegate = m.delegate
          if (m.light !== undefined) stats.light = m.light
          record(now, m.ms, now - m.t)
          onFrame({ t: m.t, aspect: size.aspect, hands: m.hands })
        } else if (m.type === 'hands') {
          stats.handSwitches++
          stats.handSwitchMs = m.ms
        } else if (m.type === 'skip') {
          if (inFlight?.id === m.id) inFlight = null
        } else if (m.type === 'delegate') {
          stats.delegate = m.delegate
          stats.bench = { gpuMs: m.gpuMs, cpuMs: m.cpuMs }
        } else if (m.type === 'error') {
          inFlight = null
          if (!closed) onError(new Error(m.message))
        }
      }
      const stop = frames(video, (t) => {
        if (closed || video.readyState < 2 || !video.videoWidth) return
        if (inFlight) {
          // the worker is still busy with an older frame: drop this one (never queue)
          if (t - inFlight.t < 2000) {
            stats.dropped++
            return
          }
          inFlight = null // a lost reply: do not stall forever
        }
        size = detectSize(video)
        stats.input = `${size.w}x${size.h}`
        const job = { id: nextId++, t }
        inFlight = job
        createImageBitmap(video, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'low' }).then(
          (bitmap) => {
            if (closed) return bitmap.close()
            post({ type: 'frame', id: job.id, t: job.t, bitmap }, [bitmap])
          },
          () => {
            if (inFlight === job) inFlight = null
          },
        )
      })
      return () => {
        stop()
        listener = null
      }
    },
    setHands(n) {
      if (!closed) post({ type: 'hands', n })
    },
    close() {
      if (closed) return
      closed = true
      listener = null
      try {
        post({ type: 'close' })
      } catch {
        /* already gone */
      }
      // the worker closes itself; terminate shortly after in case it is stuck in a long detection
      setTimeout(() => worker.terminate(), 500)
    },
  }
  return tracker
}

// ---------------------------------------------------------------------------------------------------------
// main-thread fallback
// ---------------------------------------------------------------------------------------------------------
async function createMainTracker(): Promise<Tracker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
  const [fileset, model] = await Promise.all([
    FilesetResolver.forVisionTasks(WASM_BASE),
    fetch(MODEL_URL).then((r) => {
      if (!r.ok) throw new Error(`model ${r.status}`)
      return r.arrayBuffer()
    }),
  ])
  const bytes = new Uint8Array(model)
  const make = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: bytes, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    })
  let delegate: 'GPU' | 'CPU' = 'GPU'
  let lm: Awaited<ReturnType<typeof make>>
  try {
    lm = await make('GPU')
  } catch {
    delegate = 'CPU'
    lm = await make('CPU')
  }
  let closed = false
  const stats = newStats('main', delegate)
  let degrading = false
  let hands = 1
  const degrade = async () => {
    degrading = true
    try {
      lm.close()
    } catch {
      /* already gone */
    }
    const next = await make('CPU')
    if (closed) {
      next.close()
      throw new Error('closed')
    }
    lm = next
    if (hands !== 1) void lm.setOptions({ numHands: hands }).catch(() => undefined)
    stats.delegate = delegate = 'CPU'
    degrading = false
  }
  return {
    stats,
    start(video, onFrame, onError) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { alpha: false })
      const record = meter(stats)
      let busy = false
      let stopped = false
      let lastT = 0
      let nextAt = 0
      let count = 0
      let triedCpu = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const run = async (t: number) => {
        busy = false
        if (stopped || closed) return
        const size = detectSize(video)
        if (canvas.width !== size.w) canvas.width = size.w
        if (canvas.height !== size.h) canvas.height = size.h
        stats.input = `${size.w}x${size.h}`
        ctx?.drawImage(video, 0, 0, size.w, size.h)
        const ts = Math.max(t, lastT + 1)
        lastT = ts
        const t0 = performance.now()
        let r
        try {
          r = lm.detectForVideo(canvas, ts)
        } catch (e) {
          if (delegate === 'GPU') return void degrade().catch(onError)
          return onError(e)
        }
        const now = performance.now()
        const ms = now - t0
        record(now, ms, now - t)
        // leave the main thread at least 60 % of the time (the page and the 3D viewer render on it)
        nextAt = now + ms * 1.5
        onFrame({ t, aspect: size.aspect, hands: r.landmarks.map((points, i) => ({ landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), handedness: r.handedness[i]?.[0]?.categoryName ?? null })) })
        // a GPU path that turns out slow (weak or software GPU, busy with the 3D viewer): try the CPU once
        if (delegate === 'GPU' && !triedCpu && ++count >= 20 && stats.detectMs > 80) {
          triedCpu = true
          await degrade().catch(onError)
        }
      }
      const stop = frames(video, (t) => {
        if (busy || closed || degrading || video.readyState < 2 || !video.videoWidth) return
        if (t < nextAt) {
          stats.dropped++
          return
        }
        busy = true
        // as an ordinary task, never inside the frame callback (keeps the 3D viewer's frames on time)
        timer = setTimeout(() => void run(t), 0)
      })
      return () => {
        stopped = true
        clearTimeout(timer)
        stop()
      }
    },
    setHands(n) {
      if (n === hands || closed) return
      hands = n
      void lm.setOptions({ numHands: n }).catch(() => undefined)
    },
    close() {
      closed = true
      try {
        lm.close()
      } catch {
        /* already closed */
      }
    },
  }
}

/**
 * The fastest available tracker: the worker when the browser can run it, else the main-thread fallback.
 * `prefer: 'main'` forces the fallback (for measurements).
 */
export async function createTracker(prefer: 'auto' | 'main' = 'auto'): Promise<Tracker> {
  try {
    if (prefer !== 'main' && workerCapable()) {
      try {
        return await createWorkerTracker()
      } catch (e) {
        if (import.meta.env.DEV) console.warn('hand worker failed, using the main thread', e)
      }
    }
    return await createMainTracker()
  } catch (e) {
    throw e instanceof HandError ? e : new HandError('model', e)
  }
}

/** Mean brightness 0..255 of the camera picture (tiny sample), for the "too dark" hint. */
export function brightness(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  try {
    if (video.readyState < 2) return null
    canvas.width = 24
    canvas.height = 18
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, 24, 18)
    const d = ctx.getImageData(0, 0, 24, 18).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return sum / (d.length / 4)
  } catch {
    return null
  }
}
