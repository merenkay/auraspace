// Camera + MediaPipe Hand Landmarker. Loaded only when hand control is switched on (this module and the
// MediaPipe library are separate lazy chunks; the WebAssembly runtime and the model are self-hosted under
// /mediapipe/ and cached by the service worker on first use). Everything runs in this browser: no frame,
// landmark or image leaves the device.
import type { RawFrame } from '../../lib/gesture/machine'

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
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
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

export type Detector = {
  delegate: 'GPU' | 'CPU'
  detect: (video: HTMLVideoElement, t: number) => RawFrame
  /** the GPU path failed at run time: continue on the CPU */
  degrade: () => Promise<void>
  close: () => void
}

export async function createDetector(): Promise<Detector> {
  try {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
    const [fileset, model] = await Promise.all([
      FilesetResolver.forVisionTasks(WASM_BASE),
      fetch(MODEL_URL).then((r) => {
        if (!r.ok) throw new Error(`model ${r.status}`)
        return r.arrayBuffer()
      }),
    ])
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      })
    let delegate: 'GPU' | 'CPU' = 'GPU'
    let closed = false
    let lm: Awaited<ReturnType<typeof make>>
    try {
      lm = await make('GPU')
    } catch {
      delegate = 'CPU'
      lm = await make('CPU')
    }
    const det: Detector = {
      delegate,
      detect(video, t) {
        const r = lm.detectForVideo(video, t)
        const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3
        return {
          t,
          aspect,
          hands: r.landmarks.map((points, i) => ({
            landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            handedness: r.handedness[i]?.[0]?.categoryName ?? null,
          })),
        }
      },
      async degrade() {
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
        det.delegate = delegate = 'CPU'
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
    return det
  } catch (e) {
    throw e instanceof HandError ? e : new HandError('model', e)
  }
}

/**
 * Runs detection on new camera frames at most 30 times a second, as ordinary tasks between rendered frames
 * (never inside requestAnimationFrame, so the 3D viewer's render loop is not held up). When detection is slow
 * the rate drops so it takes at most about 40 % of the main thread (down to 1 frame a second on a very slow
 * device); while the page is hidden it pauses.
 */
export function runDetection(video: HTMLVideoElement, det: Detector, onFrame: (f: RawFrame, ms: number) => void, onError: (e: unknown) => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastVideoTime = -1
  let avg = 15
  let lastT = 0
  let count = 0
  let triedCpu = false
  const fail = (e: unknown) => {
    if (!stopped) onError(e)
  }
  const later = (ms: number) => {
    if (!stopped) timer = setTimeout(tick, ms)
  }
  const tick = async () => {
    if (stopped) return
    if (document.hidden) return later(400)
    if (video.readyState < 2 || !video.videoWidth) return later(60)
    if (video.currentTime === lastVideoTime) return later(8)
    lastVideoTime = video.currentTime
    const t0 = Math.max(performance.now(), lastT + 1)
    lastT = t0
    let frame: RawFrame
    try {
      frame = det.detect(video, t0)
    } catch (e) {
      if (det.delegate === 'GPU') {
        try {
          await det.degrade()
          return later(0)
        } catch (e2) {
          return fail(e2)
        }
      }
      return fail(e)
    }
    const ms = performance.now() - t0
    avg = avg * 0.85 + ms * 0.15
    onFrame(frame, ms)
    // a GPU path that turns out slow (weak or software GPU, busy with the 3D viewer): try the CPU path once
    if (det.delegate === 'GPU' && !triedCpu && ++count >= 20 && avg > 80) {
      triedCpu = true
      try {
        await det.degrade()
        avg = 15
      } catch (e) {
        return fail(e)
      }
    }
    const interval = Math.min(1000, Math.max(33, avg * 2.5))
    later(Math.max(0, interval - (performance.now() - t0)))
  }
  later(0)
  return () => {
    stopped = true
    clearTimeout(timer)
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
