// The hand-control experience while it is switched on: first-use explainer, camera + model start-up, the
// camera dock (mirrored preview with the tracked skeleton), the full-screen hand cursor, the gesture legend,
// and the wiring from gestures to the page (driver.ts). Lazy chunk: loaded only when hand control is turned on.
import { ChevronDown, ChevronUp, CircleHelp, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HAND_BONES } from '../../lib/gesture/classify'
import type { GestureState, RawFrame, RawHand } from '../../lib/gesture/machine'
import type { SynthPose } from '../../lib/gesture/synth'
import { sfx } from '../../lib/sfx'
import { emitUi } from '../../lib/uiBus'
import { Button, Dialog, IconButton, LiveDot, Notice, Spinner } from '../ui'
import { HandDriver, type DriverView } from './driver'
import { brightness, createDetector, HandError, openCamera, runDetection, stopStream, supported, type Detector } from './engine'
import type { HandStatus } from './HandControl'
import './gesture.css'

const PREFS_KEY = 'aura.hand.v1'
type Prefs = { intro?: boolean; legendHidden?: boolean; collapsed?: boolean }
function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Prefs
  } catch {
    return {}
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }))
  } catch {
    /* remembered for this visit only */
  }
}

/** The gesture set, shown in the explainer and the legend. */
export const GESTURES: [string, string][] = [
  ['Point with your index finger', 'Moves the cursor'],
  ['Quick pinch (thumb + index)', 'Clicks what the cursor rests on'],
  ['Pinch and hold still for 1 s', 'Confirms: needed for delete, sign out and dialog actions'],
  ['Pinch and move', 'Scrolls the page; rotates the 3D body'],
  ['Pinch with both hands, move apart or together', 'Zooms the 3D body'],
  ['Pinch and push toward or pull away from the camera', 'Zooms the 3D body with one hand'],
  ['Swipe an open hand left or right', 'Next or previous tab'],
  ['Make a fist and hold', 'Resets the 3D view; closes a dialog'],
]

const HIDDEN_OFF_MS = 60_000
const NO_HAND_OFF_MS = 5 * 60_000
const NOTE_MS = 1600

function hintFor(s: GestureState, dark: boolean): string {
  if (dark) return 'Too dark: add some light in front of you'
  switch (s.quality) {
    case 'no-hand':
      return 'Move your hand into view'
    case 'low-confidence':
      return 'Hand unclear: check the lighting'
    case 'edge':
      return 'Move your hand towards the middle'
    case 'far':
      return 'Move your hand closer to the camera'
    case 'near':
      return 'Move your hand a little further away'
  }
  if (s.mode === 'zoom') return 'Zooming with both hands'
  if (s.mode === 'drag') return 'Dragging'
  if (s.mode === 'depth') return 'Zooming: push or pull'
  if (s.mode === 'fist') return 'Fist: hold to reset or close'
  if (s.hands.length > 1) return 'Tracking both hands'
  const side = s.hands[0]?.side
  return side ? `Tracking your ${side} hand` : 'Tracking your hand'
}

function cursorLabel(v: DriverView): string {
  const m = v.state.mode
  if (m === 'press' && v.confirm) return 'Hold to confirm'
  if (m === 'drag') return v.target === 'viewer' ? 'Rotate' : 'Scroll'
  if (m === 'depth' || m === 'zoom') return v.target === 'viewer' ? 'Zoom' : ''
  if (m === 'fist') return v.state.fist < 1 ? 'Hold fist' : ''
  if (m === 'hover' && v.confirm && v.armed >= 1) return 'Pinch and hold'
  return ''
}

type DevStep = { ms: number; pose: SynthPose; x: number; y: number; pinch?: number; size?: number; pose2?: SynthPose; x2?: number; y2?: number }

export default function HandSession({ synthetic, onStatus }: { synthetic: boolean; onStatus: (s: HandStatus) => void }) {
  const prefs = useRef(loadPrefs())
  const [phase, setPhase] = useState<'intro' | 'starting' | 'running'>(() => (prefs.current.intro || synthetic ? 'starting' : 'intro'))
  const [loading, setLoading] = useState('Starting the camera')
  const [collapsed, setCollapsed] = useState(!!prefs.current.collapsed)
  const [legend, setLegend] = useState(!prefs.current.legendHidden)
  const [hint, setHint] = useState('Move your hand into view')
  const [note, setNote] = useState<string | null>(null)

  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const res = useRef<{ stream: MediaStream | null; det: Detector | null } | null>(null)
  const driver = useRef<HandDriver | null>(null)
  const videoBox = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const pinchRing = useRef<SVGCircleElement>(null)
  const progress = useRef<SVGCircleElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const zoomSvg = useRef<SVGSVGElement>(null)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const hintRef = useRef(hint)
  const dark = useRef(false)
  const noteUntil = useRef(0)
  const noteText = useRef('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const noHandSince = useRef<number | null>(null)
  const lastView = useRef<DriverView | null>(null)

  const showNote = useCallback((text: string) => {
    noteText.current = text
    noteUntil.current = performance.now() + NOTE_MS
    setNote(text)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS)
  }, [])

  // ---- start: camera + model in parallel ---------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'starting') return
    let cancelled = false
    statusRef.current({ state: 'starting' })
    if (synthetic) {
      res.current = { stream: null, det: null }
      setPhase('running')
      return
    }
    let stream: MediaStream | null = null
    const why = supported()
    if (why) {
      statusRef.current({ state: 'error', kind: why })
      return
    }
    setLoading('Waiting for camera permission')
    const detP = createDetector()
    detP.catch(() => undefined)
    ;(async () => {
      try {
        stream = await openCamera()
        if (cancelled) throw new Error('cancelled')
        setLoading('Loading the hand-tracking model')
        const det = await detP
        if (cancelled) {
          det.close()
          throw new Error('cancelled')
        }
        res.current = { stream, det }
        setPhase('running')
      } catch (e) {
        stopStream(stream)
        void detP.then((d) => d.close()).catch(() => undefined)
        if (!cancelled) statusRef.current({ state: 'error', kind: e instanceof HandError ? e.kind : 'model' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, synthetic])

  // ---- per-frame: gestures -> page, then draw ----------------------------------------------------------
  const paint = useCallback((v: DriverView) => {
    const c = cursor.current
    if (!c) return
    const s = v.state
    if (!v.px || !s.present) {
      c.dataset.present = 'false'
      c.dataset.mode = 'idle'
    } else {
      c.dataset.present = 'true'
      c.dataset.mode = s.mode
      c.dataset.target = v.target
      c.style.transform = `translate(${v.px.x.toFixed(1)}px, ${v.px.y.toFixed(1)}px)`
      pinchRing.current?.setAttribute('r', (20 - 13 * s.pinch).toFixed(2))
      const prog = s.mode === 'press' ? s.hold : s.mode === 'fist' ? s.fist : v.target === 'ui' && s.mode === 'hover' ? v.armed : 0
      const pr = progress.current
      if (pr) {
        pr.style.strokeDashoffset = String(100 * (1 - prog))
        pr.style.opacity = prog > 0 ? '1' : '0'
      }
      const text = performance.now() < noteUntil.current ? noteText.current : cursorLabel(v)
      if (label.current && label.current.textContent !== text) label.current.textContent = text
    }
    const z = zoomSvg.current
    if (z) {
      const pts = s.zoomPts
      z.style.display = pts ? 'block' : 'none'
      if (pts) {
        const [a, b] = pts.map((p) => ({ x: p.x * window.innerWidth, y: p.y * window.innerHeight }))
        const [line, ca, cb] = Array.from(z.children) as SVGElement[]
        line.setAttribute('x1', String(a.x))
        line.setAttribute('y1', String(a.y))
        line.setAttribute('x2', String(b.x))
        line.setAttribute('y2', String(b.y))
        ca.setAttribute('cx', String(a.x))
        ca.setAttribute('cy', String(a.y))
        cb.setAttribute('cx', String(b.x))
        cb.setAttribute('cy', String(b.y))
      }
    }
  }, [])

  const drawSkeleton = useCallback((s: GestureState, aspect: number) => {
    const cv = canvas.current
    if (!cv || collapsedRef.current) return
    const w = cv.clientWidth
    const h = cv.clientHeight
    if (!w || !h) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr)
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // the preview is mirrored and cropped like `object-fit: cover`
    const boxAspect = w / h
    const sw = aspect > boxAspect ? h * aspect : w
    const sh = aspect > boxAspect ? h : w / aspect
    const ox = (w - sw) / 2
    const oy = (h - sh) / 2
    const css = getComputedStyle(cv)
    const accent = css.getPropertyValue('--color-accent').trim() || '#92c1fd'
    const soft = css.getPropertyValue('--color-soft').trim() || '#c7c4bd'
    for (const hand of s.hands) {
      const P = hand.landmarks.map((p) => ({ x: ox + (1 - p.x) * sw, y: oy + p.y * sh }))
      ctx.strokeStyle = hand.primary ? accent : soft
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(P[a].x, P[a].y)
        ctx.lineTo(P[b].x, P[b].y)
      }
      ctx.stroke()
      for (const p of P) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      if (hand.primary) {
        // the fingertip that steers the cursor, with the pinch closing around it
        const tip = P[8]
        ctx.globalAlpha = 1
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.arc(tip.x, tip.y, 9 - 5 * hand.pinch, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }, [])

  const handle = useCallback(
    (frame: RawFrame) => {
      const d = driver.current
      if (!d) return
      const v = d.step(frame)
      lastView.current = v
      paint(v)
      drawSkeleton(v.state, frame.aspect ?? 4 / 3)
      const h = hintFor(v.state, dark.current)
      if (h !== hintRef.current) {
        hintRef.current = h
        setHint(h)
      }
      if (v.state.present) noHandSince.current = null
      else if (noHandSince.current === null) noHandSince.current = frame.t
      else if (frame.t - noHandSince.current > NO_HAND_OFF_MS) statusRef.current({ state: 'off', note: 'It switched itself off after five minutes without a hand in view, to free the camera.' })
    },
    [paint, drawSkeleton],
  )

  // ---- running: camera preview, detection loop, HUD on, lifetime rules -----------------------------------
  useEffect(() => {
    if (phase !== 'running') return
    const r = res.current
    const drv = new HandDriver(showNote)
    driver.current = drv
    let video: HTMLVideoElement | null = null
    let stop = () => {}
    if (r?.stream && r.det) {
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      video.srcObject = r.stream
      videoBox.current?.appendChild(video)
      void video.play().catch(() => undefined)
      stop = runDetection(video, r.det, handle, () => statusRef.current({ state: 'error', kind: 'model' }))
    }
    emitUi('hud', { on: true, source: 'hand' })
    sfx('open')
    statusRef.current({ state: 'active' })

    const sample = document.createElement('canvas')
    const light = setInterval(() => {
      const b = video ? brightness(video, sample) : null
      dark.current = b !== null && b < 40
    }, 1000)
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined
    const onVisibility = () => {
      clearTimeout(hiddenTimer)
      if (document.hidden) hiddenTimer = setTimeout(() => statusRef.current({ state: 'off', note: 'It switched itself off while the page was in the background, to free the camera.' }), HIDDEN_OFF_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)

    // dev-only frame injector: window.__auraHand.feed(frame) / .play(steps) / .view()
    const w = window as unknown as { __auraHand?: Record<string, unknown> }
    if (import.meta.env.DEV) {
      const hook = (w.__auraHand ??= {})
      hook.feed = (frame: RawFrame) => handle(frame)
      hook.events = () => drv.log.splice(0)
      hook.view = () => {
        const v = lastView.current
        return v && { mode: v.state.mode, pose: v.state.pose, px: v.px, target: v.target, armed: v.armed, confirm: v.confirm, quality: v.state.quality, hands: v.state.hands.length }
      }
      hook.play = async (steps: DevStep[]) => {
        const { synthHand } = await import('../../lib/gesture/synth')
        const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
        // palm position that puts an open hand's index tip (at the standard size) on the client point; a size
        // change then scales the hand around its palm, like moving it towards or away from the camera
        const aim = (cx: number, cy: number) => {
          const tip = drv.pipeline.fromScreen({ x: cx / window.innerWidth, y: cy / window.innerHeight })
          const ref = synthHand({ pose: 'open', x: 0.5, y: 0.5, size: 0.18 })
          return { x: tip.x - (ref[8].x - 0.5), y: tip.y - (ref[8].y - 0.5) }
        }
        let prev: DevStep | null = null
        for (const s of steps) {
          const n = Math.max(1, Math.round(s.ms / 33))
          for (let k = 1; k <= n; k++) {
            const f = prev ? k / n : 1
            const lerp = (a: number | undefined, b: number) => (a === undefined ? b : a + (b - a) * f)
            const size = lerp(prev?.size ?? 0.18, s.size ?? 0.18)
            const hands: RawHand[] = []
            const p1 = aim(lerp(prev?.x, s.x), lerp(prev?.y, s.y))
            hands.push({ landmarks: synthHand({ pose: s.pose, pinch: s.pinch, x: p1.x, y: p1.y, size }), handedness: 'Left' })
            if (s.pose2 && s.x2 !== undefined && s.y2 !== undefined) {
              const p2 = aim(lerp(prev?.x2, s.x2), lerp(prev?.y2, s.y2))
              hands.push({ landmarks: synthHand({ pose: s.pose2, x: p2.x, y: p2.y, size, side: 'left' }), handedness: 'Right' })
            }
            handle({ t: performance.now(), aspect: 4 / 3, hands })
            await sleep(33)
          }
          prev = s
        }
        return (hook.view as () => unknown)()
      }
    }

    return () => {
      stop()
      clearInterval(light)
      clearTimeout(hiddenTimer)
      clearTimeout(noteTimer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      drv.dispose()
      driver.current = null
      if (video) {
        video.pause()
        video.srcObject = null
        video.remove()
      }
      stopStream(r?.stream ?? null)
      r?.det?.close()
      res.current = null
      if (import.meta.env.DEV && w.__auraHand) {
        delete w.__auraHand.feed
        delete w.__auraHand.events
        delete w.__auraHand.play
        delete w.__auraHand.view
      }
      emitUi('hud', { on: false, source: 'hand' })
      sfx('close')
    }
  }, [phase, handle, showNote])

  const begin = () => {
    savePrefs({ intro: true })
    setPhase('starting')
  }
  const toggleLegend = (open: boolean) => {
    setLegend(open)
    savePrefs({ legendHidden: !open })
  }

  if (phase === 'intro') {
    return (
      <Dialog
        open
        onClose={() => statusRef.current({ state: 'off' })}
        title="Control AURA with your hand"
        description="Uses your camera. Mouse, touch and keyboard keep working."
        footer={
          <>
            <Button variant="quiet" onClick={() => statusRef.current({ state: 'off' })}>
              Not now
            </Button>
            <Button variant="primary" onClick={begin} data-autofocus>
              Turn on camera
            </Button>
          </>
        }
      >
        <GestureList />
        <Notice className="mt-4" title="What happens to the camera picture">
          Hand tracking runs an on-device machine-learning model (MediaPipe Hand Landmarker). Camera frames are processed in this browser and are never sent or stored. It is an input method only and takes no part in any health assessment.
        </Notice>
        <p className="mt-3 text-xs text-dim">The first start downloads the model once (about 22 MB). After that it also works offline. Hand control turns itself off when the page stays in the background.</p>
      </Dialog>
    )
  }

  return createPortal(
    <>
      <div className="hand-layer" aria-hidden="true">
        <svg ref={zoomSvg} className="hand-zoom" width="100%" height="100%" style={{ display: 'none' }}>
          <line />
          <circle r="10" />
          <circle r="10" />
        </svg>
        <div ref={cursor} className="hand-cursor" data-present="false" data-mode="idle">
          <svg viewBox="-36 -36 72 72" width="72" height="72">
            <circle className="hc-halo" r="22" />
            <circle className="hc-outer" r="22" pathLength="100" />
            <circle ref={progress} className="hc-progress" r="27" pathLength="100" style={{ opacity: 0 }} />
            <circle ref={pinchRing} className="hc-pinch" r="20" />
            <path className="hc-ticks" d="M0 -31 V-26 M31 0 H26 M0 31 V26 M-31 0 H-26" />
            <circle className="hc-dot" r="2.5" />
          </svg>
          <span ref={label} className="hand-cursor-label" />
        </div>
      </div>

      <section className="hand-dock rounded-2xl border border-line bg-panel p-2 shadow-overlay" aria-label="Hand control">
        <div className="hand-preview" data-collapsed={collapsed || undefined}>
          <div ref={videoBox} className="absolute inset-0" />
          <canvas ref={canvas} />
          {phase === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner label={loading} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
          {phase === 'running' ? <LiveDot label={synthetic ? 'Simulated' : 'Live'} /> : <span className="text-xs text-dim">Starting</span>}
          <div className="-mr-1 flex">
            <IconButton size="sm" icon={collapsed ? ChevronUp : ChevronDown} label={collapsed ? 'Show camera preview' : 'Hide camera preview'} onClick={() => (setCollapsed(!collapsed), savePrefs({ collapsed: !collapsed }))} />
            <IconButton size="sm" icon={CircleHelp} label="Hand gestures" aria-pressed={legend} onClick={() => toggleLegend(!legend)} />
            <IconButton size="sm" icon={X} label="Turn off hand control" onClick={() => statusRef.current({ state: 'off' })} />
          </div>
        </div>
        <p className="min-h-[18px] px-1 pb-0.5 text-xs leading-snug text-soft" aria-live="polite">
          {note ?? (phase === 'running' ? hint : loading)}
        </p>
      </section>

      {legend && phase === 'running' && (
        <aside className="hand-legend rounded-2xl border border-line bg-panel p-4 shadow-overlay" aria-label="Hand gestures">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Hand gestures</h2>
            <IconButton size="sm" icon={X} label="Hide hand gestures" className="-mr-2 -mt-1" onClick={() => toggleLegend(false)} />
          </div>
          <GestureList compact />
          <p className="mt-2 text-xs text-dim">On-device model; camera frames never leave this browser.</p>
        </aside>
      )}
    </>,
    document.body,
  )
}

function GestureList({ compact = false }: { compact?: boolean }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {GESTURES.map(([g, does]) => (
        <div key={g} className={compact ? 'py-1.5' : 'grid gap-x-4 py-2 sm:grid-cols-2'}>
          <dt className="text-sm font-medium text-ink">{g}</dt>
          <dd className={compact ? 'text-xs text-dim' : 'text-sm text-soft'}>{does}</dd>
        </div>
      ))}
    </dl>
  )
}
