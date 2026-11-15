// The hand-control experience while it is switched on: first-use explainer, camera + model start-up, the
// camera dock (mirrored preview with the tracked skeleton, measured speed, settings), the full-screen hand
// cursor, the gesture legend, and the wiring from gestures to the page (driver.ts). Lazy chunk: loaded only when
// hand control is turned on.
//
// Rendering is decoupled from detection: detections arrive 12–30 times a second (worker), while the cursor is
// drawn every display frame from the latest target plus a short prediction, with CSS transforms only. Nothing
// here causes a React render per frame; everything per-frame is a direct DOM write.
import { ChevronDown, ChevronUp, CircleHelp, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HAND_BONES } from '../../lib/gesture/classify'
import { HandsProbe } from '../../lib/gesture/spread'
import type { GestureState, RawFrame, RawHand } from '../../lib/gesture/machine'
import type { SlapDirection } from '../../lib/gesture/slap'
import type { SynthPose } from '../../lib/gesture/synth'
import { DEV_HOOKS } from '../../lib/devHooks'
import { sfx } from '../../lib/sfx'
import { emitUi } from '../../lib/uiBus'
import { Button, cx, Dialog, IconButton, LiveDot, Notice, Spinner } from '../ui'
import { DEFAULT_SETTINGS, HandDriver, type DriverView, type HandSettings } from './driver'
import { brightness, createTracker, HandError, openCamera, stopStream, supported, type Tracker } from './engine'
import type { HandStatus } from './HandControl'
import './gesture.css'

const PREFS_KEY = 'aura.hand.v1'
type Prefs = { intro?: boolean; legendHidden?: boolean; collapsed?: boolean; settings?: Partial<HandSettings> }
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

type Picto = 'point' | 'pinch' | 'dwell' | 'drag' | 'slap' | 'fist' | 'spread'
/** The gesture set, shown in the explainer and the legend. */
export const GESTURES: { picto: Picto; does: string; how: string; dwellOnly?: boolean; twoHand?: boolean }[] = [
  { picto: 'point', does: 'Move the cursor', how: 'Point with your index finger' },
  { picto: 'pinch', does: 'Click', how: 'Tap thumb and index finger together' },
  { picto: 'dwell', does: 'Click without pinching', how: 'Rest the cursor on a button until the ring fills', dwellOnly: true },
  { picto: 'drag', does: 'Scroll, or turn the 3D body', how: 'Pinch, then move your hand' },
  { picto: 'slap', does: 'Next or previous tab', how: slapHow('natural') },
  { picto: 'fist', does: 'Close a dialog, reset the 3D view', how: 'Make a fist for a moment' },
  { picto: 'spread', does: 'Talk to AURA (voice)', how: 'Put both open hands together, then pull them apart. Together again closes it', twoHand: true },
]

/** The slap line of the legend, in the direction the setting gives ("right" = the way the cursor moves right). */
export function slapHow(dir: SlapDirection | undefined): string {
  const [next, prev] = dir === 'reversed' ? ['left', 'right'] : ['right', 'left']
  return `Swipe your open hand quickly: to the ${next} = next tab, to the ${prev} = previous tab`
}

const HIDDEN_OFF_MS = 60_000
const NO_HAND_OFF_MS = 5 * 60_000
const NOTE_MS = 1600
const SKELETON_MS = 66 // the preview skeleton is drawn at most ~15 times a second

function hintFor(s: GestureState, dark: boolean, slow: boolean): string {
  if (slow && s.quality === 'ok') return 'This device is slow for hand tracking: expect a delay'
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
  if (m === 'hover' && v.organ) return v.organ
  return ''
}

type DevStep = { ms: number; pose: SynthPose; x: number; y: number; pinch?: number; size?: number; pose2?: SynthPose; x2?: number; y2?: number }

export default function HandSession({ synthetic, onStatus }: { synthetic: boolean; onStatus: (s: HandStatus) => void }) {
  const prefs = useRef(loadPrefs())
  const [phase, setPhase] = useState<'intro' | 'starting' | 'running'>(() => (prefs.current.intro || synthetic ? 'starting' : 'intro'))
  const [loading, setLoading] = useState('Starting the camera')
  const [collapsed, setCollapsed] = useState(!!prefs.current.collapsed)
  // the legend opens by itself on wide screens until it is dismissed; on phones it waits for the help button
  const [legend, setLegend] = useState(() => !prefs.current.legendHidden && window.matchMedia?.('(min-width: 768px)').matches !== false)
  const [panel, setPanel] = useState(false)
  const [settings, setSettings] = useState<HandSettings>(() => ({ ...DEFAULT_SETTINGS, ...prefs.current.settings }))
  const [hint, setHint] = useState('Move your hand into view')
  const [note, setNote] = useState<string | null>(null)

  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const res = useRef<{ stream: MediaStream | null; tracker: Tracker | null } | null>(null)
  const driver = useRef<HandDriver | null>(null)
  const videoBox = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const pinchRing = useRef<SVGCircleElement>(null)
  const progress = useRef<SVGCircleElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const zoomSvg = useRef<SVGSVGElement>(null)
  const slapBand = useRef<HTMLDivElement>(null)
  const slapEdge = useRef<HTMLDivElement>(null)
  const perf = useRef<HTMLSpanElement>(null)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const hintRef = useRef(hint)
  const dark = useRef(false)
  const slow = useRef(false)
  const noteUntil = useRef(0)
  const noteText = useRef('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const noHandSince = useRef<number | null>(null)
  const lastView = useRef<DriverView | null>(null)
  const aspectRef = useRef(4 / 3)
  // the model looks for a second hand only near the 3D body (two-hand zoom); one hand is much cheaper
  const twoHands = useRef({ n: 1 as 1 | 2, probe: new HandsProbe() })
  const expandEl = useRef<HTMLDivElement>(null)
  const burstEl = useRef<HTMLDivElement>(null)
  const palette = useRef({ accent: '', soft: '', n: 0 })
  // cursor motion between detections: target, its velocity (px/ms) and the displayed position
  const motion = useRef({ tx: 0, ty: 0, vx: 0, vy: 0, t: 0, x: 0, y: 0, has: false, shown: false, dirty: false, skelAt: 0 })

  const showNote = useCallback((text: string) => {
    noteText.current = text
    noteUntil.current = performance.now() + NOTE_MS
    setNote(text)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS)
  }, [])

  const playSlap = useCallback((dir: 'left' | 'right', moved: boolean) => {
    sfx(moved ? 'select' : 'warn')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const edge = slapEdge.current
    if (edge?.animate) {
      edge.dataset.dir = dir
      edge.dataset.blocked = moved ? 'false' : 'true'
      edge.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' })
    }
    const band = slapBand.current
    if (band?.animate && moved && !reduce) {
      const from = dir === 'right' ? '-40vw' : '100vw'
      const to = dir === 'right' ? '100vw' : '-40vw'
      band.animate(
        [
          { transform: `translate3d(${from},0,0)`, opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: `translate3d(${to},0,0)`, opacity: 0 },
        ],
        { duration: 420, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
      )
    }
  }, [])

  /** the two-hand gesture fired: a frame expands from between the hands to the voice panel (or shrinks back) */
  const playExpand = useCallback((kind: 'open' | 'close', at: { x: number; y: number }) => {
    const el = expandEl.current
    const burst = burstEl.current
    if (!el?.animate) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // where the voice panel is (or will be): see .vx-hud in voice.css
    const hud = document.querySelector('.vx-hud')?.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const phone = vw < 768
    const w = hud?.width || (phone ? vw - 16 : Math.min(480, vw - 32))
    const h = hud?.height || 260
    const left = hud ? hud.left : phone ? 8 : vw - 16 - w
    const top = hud ? hud.top : vh - (phone ? 76 : 16) - h
    // the element is panel-sized and placed on the panel; only transform and opacity animate (compositor only)
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    const dx = at.x - (left + w / 2)
    const dy = at.y - (top + h / 2)
    const small = `translate3d(${dx.toFixed(0)}px, ${dy.toFixed(0)}px, 0) scale(0.06, 0.1)`
    const full = 'translate3d(0, 0, 0) scale(1)'
    const frames =
      kind === 'open'
        ? [{ transform: small, opacity: 0.95 }, { transform: full, opacity: 0.9, offset: 0.75 }, { transform: full, opacity: 0 }]
        : [{ transform: full, opacity: 0.8 }, { transform: small, opacity: 0.9, offset: 0.8 }, { transform: small, opacity: 0 }]
    el.animate(reduce ? [{ opacity: 0.6 }, { opacity: 0 }] : frames, { duration: reduce ? 300 : 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    if (burst?.animate && !reduce) {
      burst.style.left = `${at.x}px`
      burst.style.top = `${at.y}px`
      burst.animate([{ transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.9 }, { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 }], { duration: 480, easing: 'ease-out' })
    }
  }, [])

  // ---- settings -> driver, remembered ----------------------------------------------------------------------
  useEffect(() => {
    driver.current?.configure(settings)
    savePrefs({ settings })
  }, [settings])
  const change = (patch: Partial<HandSettings>) => setSettings((s) => ({ ...s, ...patch }))

  // ---- start: camera + model in parallel ---------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'starting') return
    let cancelled = false
    statusRef.current({ state: 'starting' })
    if (synthetic) {
      res.current = { stream: null, tracker: null }
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
    // dev-only: window.__auraHandEngine = 'main' forces the main-thread fallback (for before/after measurements)
    const trackerP = createTracker(import.meta.env.DEV && (window as { __auraHandEngine?: string }).__auraHandEngine === 'main' ? 'main' : 'auto')
    trackerP.catch(() => undefined)
    ;(async () => {
      try {
        stream = await openCamera()
        if (cancelled) throw new Error('cancelled')
        setLoading('Loading the hand-tracking model')
        const tracker = await trackerP
        if (cancelled) {
          tracker.close()
          throw new Error('cancelled')
        }
        res.current = { stream, tracker }
        setPhase('running')
      } catch (e) {
        stopStream(stream)
        void trackerP.then((d) => d.close()).catch(() => undefined)
        if (!cancelled) statusRef.current({ state: 'error', kind: e instanceof HandError ? e.kind : 'model' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, synthetic])

  // ---- drawing --------------------------------------------------------------------------------------------
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
    // the preview is (normally) mirrored and cropped like `object-fit: cover`
    const mirror = settingsRef.current.mirror
    const boxAspect = w / h
    const sw = aspect > boxAspect ? h * aspect : w
    const sh = aspect > boxAspect ? h : w / aspect
    const ox = (w - sw) / 2
    const oy = (h - sh) / 2
    // theme colours, re-read now and then (the accent follows the profile)
    const pal = palette.current
    if (!pal.accent || ++pal.n % 30 === 0) {
      const css = getComputedStyle(cv)
      pal.accent = css.getPropertyValue('--color-accent').trim() || '#92c1fd'
      pal.soft = css.getPropertyValue('--color-soft').trim() || '#c7c4bd'
    }
    const { accent, soft } = pal
    for (const hand of s.hands) {
      const P = hand.landmarks.map((p) => ({ x: ox + (mirror ? 1 - p.x : p.x) * sw, y: oy + p.y * sh }))
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

  /** per display frame: cursor position (interpolated + short prediction), rings, label, zoom line, skeleton */
  const render = useCallback(
    (now: number, dt: number) => {
      const c = cursor.current
      const v = lastView.current
      const m = motion.current
      if (!c) return
      if (!v || !v.px || !v.state.present) {
        if (m.shown) {
          c.dataset.present = 'false'
          c.dataset.mode = 'idle'
          m.shown = false
        }
      } else {
        const s = v.state
        if (!m.shown) {
          c.dataset.present = 'true'
          m.shown = true
        }
        if (c.dataset.mode !== s.mode) c.dataset.mode = s.mode
        if (c.dataset.target !== v.target) c.dataset.target = v.target
        // predict a little ahead (at most 70 ms) from the last two detections, then ease towards that point
        const lead = Math.min(70, now - m.t)
        const px = m.tx + m.vx * lead
        const py = m.ty + m.vy * lead
        if (!m.has || Math.hypot(px - m.x, py - m.y) > 420) {
          m.x = px
          m.y = py
          m.has = true
        } else {
          const k = 1 - Math.exp(-dt / 32)
          m.x += (px - m.x) * k
          m.y += (py - m.y) * k
        }
        c.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`
        pinchRing.current?.setAttribute('r', (20 - 13 * s.pinch).toFixed(1))
        const prog = s.mode === 'press' ? s.hold : s.mode === 'fist' ? s.fist : s.mode === 'hover' ? (v.dwell > 0 ? v.dwell : v.target === 'ui' && settingsRef.current.click === 'pinch' ? v.armed : 0) : 0
        const pr = progress.current
        if (pr) {
          pr.style.strokeDashoffset = (100 * (1 - prog)).toFixed(1)
          pr.style.opacity = prog > 0 ? '1' : '0'
        }
        const text = now < noteUntil.current ? noteText.current : cursorLabel(v)
        if (label.current && label.current.textContent !== text) label.current.textContent = text
      }
      if (m.dirty && v && now - m.skelAt >= SKELETON_MS) {
        m.dirty = false
        m.skelAt = now
        drawSkeleton(v.state, aspectRef.current)
        const z = zoomSvg.current
        if (z) {
          const pts = v.state.zoomPts
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
      }
    },
    [drawSkeleton],
  )

  /** one detection: gestures -> page, new cursor target. No React state unless the hint text changes. */
  const handle = useCallback((frame: RawFrame) => {
    const d = driver.current
    if (!d) return
    const v = d.step(frame)
    lastView.current = v
    aspectRef.current = frame.aspect ?? 4 / 3
    const m = motion.current
    const now = performance.now()
    if (v.px) {
      // velocity only while the cursor moves freely (not snapped to a control, frozen for a pinch or dragging)
      const free = v.state.mode === 'hover' && v.target === 'none' && !v.state.frozen
      const dt = now - m.t
      if (free && m.t && dt > 0 && dt < 200) {
        const k = 0.5
        m.vx = m.vx * (1 - k) + Math.max(-3, Math.min(3, (v.px.x - m.tx) / dt)) * k
        m.vy = m.vy * (1 - k) + Math.max(-3, Math.min(3, (v.px.y - m.ty) / dt)) * k
      } else {
        m.vx = 0
        m.vy = 0
      }
      m.tx = v.px.x
      m.ty = v.px.y
      m.t = now
    } else m.has = false
    m.dirty = true
    // one hand is much cheaper to track than two: look for a second hand over the 3D body, while two are in
    // view, and otherwise in short periodic probes while an open hand is up (for the two-hand voice gesture)
    const two = twoHands.current
    const tracker = res.current?.tracker
    if (tracker) {
      const s = v.state
      const want = two.probe.update(now, {
        hands: s.hands.length,
        openHand: s.hands.some((x) => x.pose === 'open'),
        forced: v.target === 'viewer' || s.mode === 'zoom',
        enabled: settingsRef.current.twoHand !== false,
      })
      if (want !== two.n) {
        two.n = want
        tracker.setHands(want)
      }
    }
    const h = d.pipeline.twoHandPhase === 'together' && v.state.present ? 'Hands together: now pull them apart to talk to AURA' : hintFor(v.state, dark.current, slow.current)
    if (h !== hintRef.current) {
      hintRef.current = h
      setHint(h)
    }
    if (v.state.present) noHandSince.current = null
    else if (noHandSince.current === null) noHandSince.current = frame.t
    else if (frame.t - noHandSince.current > NO_HAND_OFF_MS) statusRef.current({ state: 'off', note: 'It switched itself off after five minutes without a hand in view, to free the camera.' })
  }, [])

  // ---- running: camera preview, detection, render loop, HUD on, lifetime rules ------------------------------
  useEffect(() => {
    if (phase !== 'running') return
    const r = res.current
    const drv = new HandDriver({ notify: showNote, slap: playSlap, expand: playExpand }, settingsRef.current)
    twoHands.current = { n: 1, probe: new HandsProbe() }
    driver.current = drv
    let video: HTMLVideoElement | null = null
    let stop = () => {}
    const tracker = r?.tracker ?? null
    if (r?.stream && tracker) {
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      video.srcObject = r.stream
      videoBox.current?.appendChild(video)
      void video.play().catch(() => undefined)
      stop = tracker.start(video, handle, () => statusRef.current({ state: 'error', kind: 'model' }))
    }
    emitUi('hud', { on: true, source: 'hand' })
    sfx('open')
    statusRef.current({ state: 'active' })

    // display-rate loop: only CSS transforms and SVG attributes
    let raf = 0
    let lastFrame = performance.now()
    const loop = (now: number) => {
      render(now, Math.min(100, now - lastFrame))
      lastFrame = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // measured speed in the dock, twice a second
    const perfTimer = setInterval(() => {
      const el = perf.current
      if (!el) return
      if (!tracker) {
        el.textContent = 'simulated input'
        return
      }
      const s = tracker.stats
      slow.current = s.frames > 10 && (s.latencyMs > 220 || s.fps < 6)
      el.textContent = s.frames ? `${s.fps} fps · ${Math.round(s.latencyMs)} ms · ${s.mode === 'worker' ? 'worker' : 'main'} ${s.delegate}` : `${s.mode === 'worker' ? 'worker' : 'main'} ${s.delegate}`
      el.title = `Detections per second; delay from camera frame to cursor; where detection runs (model ${Math.round(s.detectMs)} ms per frame, input ${s.input}, ${s.dropped} stale frames skipped)`
    }, 500)

    // room at the end of the page, so content at the very bottom can be scrolled out from under the camera dock
    const body = document.body
    const padBefore = body.style.paddingBottom
    const dock = document.querySelector<HTMLElement>('.hand-dock')
    const pad = () => {
      if (dock) body.style.paddingBottom = `${dock.offsetHeight + 24}px`
    }
    pad()
    const ro = typeof ResizeObserver !== 'undefined' && dock ? new ResizeObserver(pad) : null
    if (ro && dock) ro.observe(dock)

    const sample = document.createElement('canvas')
    const light = setInterval(() => {
      // the worker measures it from the frames it already has; only the main-thread fallback reads the video here
      const b = tracker?.stats.mode === 'worker' ? tracker.stats.light : video ? brightness(video, sample) : null
      dark.current = b !== null && b < 40
    }, 1000)
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined
    const onVisibility = () => {
      clearTimeout(hiddenTimer)
      if (document.hidden) hiddenTimer = setTimeout(() => statusRef.current({ state: 'off', note: 'It switched itself off while the page was in the background, to free the camera.' }), HIDDEN_OFF_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)

    // dev-only frame injector: window.__auraHand.feed(frame) / .play(steps, fps) / .view() / .stats()
    const w = window as unknown as { __auraHand?: Record<string, unknown> }
    let playT = 0
    if (DEV_HOOKS) {
      const hook = (w.__auraHand ??= {})
      hook.feed = (frame: RawFrame) => handle(frame)
      hook.events = () => drv.log.splice(0)
      hook.stats = () => ({ ...(tracker?.stats ?? { mode: 'synthetic' }), video: video ? `${video.videoWidth}x${video.videoHeight}` : null, hands: twoHands.current.n, probes: twoHands.current.probe.probes })
      hook.setHands = (n: 1 | 2) => tracker?.setHands(n)
      hook.expand = playExpand
      hook.settings = (patch?: Partial<HandSettings>) => {
        if (patch) setSettings((s) => ({ ...s, ...patch }))
        return settingsRef.current
      }
      hook.view = () => {
        const v = lastView.current
        return v && { mode: v.state.mode, pose: v.state.pose, px: v.px, target: v.target, armed: v.armed, dwell: v.dwell, confirm: v.confirm, frozen: v.state.frozen, organ: v.organ, quality: v.state.quality, hands: v.state.hands.length }
      }
      hook.play = async (steps: DevStep[], fps = 30) => {
        const { synthHand } = await import('../../lib/gesture/synth')
        const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
        const dt = 1000 / fps
        // palm position that puts an open hand's index tip (at the standard size) on the client point; a size
        // change then scales the hand around its palm, like moving it towards or away from the camera
        const aim = (cx: number, cy: number) => {
          const tip = drv.pipeline.fromScreen({ x: cx / window.innerWidth, y: cy / window.innerHeight })
          const ref = synthHand({ pose: 'open', x: 0.5, y: 0.5, size: 0.18 })
          return { x: tip.x - (ref[8].x - 0.5), y: tip.y - (ref[8].y - 0.5) }
        }
        let prev: DevStep | null = null
        // frames carry virtual timestamps, so a busy (headless) browser cannot stretch a gesture
        let vt = Math.max(performance.now(), playT + dt)
        for (const s of steps) {
          const n = Math.max(1, Math.round(s.ms / dt))
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
            handle({ t: vt, aspect: 4 / 3, hands })
            playT = vt
            vt += dt
            await sleep(dt)
          }
          prev = s
        }
        return (hook.view as () => unknown)()
      }
    }

    return () => {
      stop()
      cancelAnimationFrame(raf)
      clearInterval(perfTimer)
      ro?.disconnect()
      body.style.paddingBottom = padBefore
      clearInterval(light)
      clearTimeout(hiddenTimer)
      clearTimeout(noteTimer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      drv.dispose()
      driver.current = null
      lastView.current = null
      if (video) {
        video.pause()
        video.srcObject = null
        video.remove()
      }
      stopStream(r?.stream ?? null)
      tracker?.close()
      res.current = null
      if (DEV_HOOKS && w.__auraHand) {
        for (const k of ['feed', 'events', 'stats', 'play', 'view', 'settings', 'setHands', 'expand']) delete w.__auraHand[k]
      }
      emitUi('hud', { on: false, source: 'hand' })
      sfx('close')
    }
  }, [phase, handle, render, showNote, playSlap, playExpand])

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
        <p className="mb-3 text-sm text-soft">Hold one hand up in front of the camera, about an arm's length away.</p>
        <GestureList dwell={settings.click !== 'pinch'} slapDir={settings.slapDir} />
        <Notice className="mt-4" title="What happens to the camera picture">
          Hand tracking runs an on-device machine-learning model (MediaPipe Hand Landmarker). Camera frames are processed in this browser and are never sent or stored. It is an input method only and takes no part in any health assessment.
        </Notice>
        <p className="mt-3 text-xs text-dim">The first start downloads the model once (about 22 MB). After that it also works offline.</p>
      </Dialog>
    )
  }

  return createPortal(
    <>
      <div className="hand-layer" aria-hidden="true">
        <div ref={slapBand} className="hand-slap-band" />
        <div ref={slapEdge} className="hand-slap-edge" data-dir="right" />
        <div ref={expandEl} className="hand-expand" />
        <div ref={burstEl} className="hand-expand-burst" />
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
        <div className="hand-preview" data-collapsed={collapsed || undefined} data-mirror={settings.mirror || undefined}>
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
            <IconButton
              size="sm"
              icon={collapsed ? ChevronUp : ChevronDown}
              label={collapsed ? 'Show camera preview' : 'Hide camera preview'}
              onClick={() => {
                setCollapsed(!collapsed)
                savePrefs({ collapsed: !collapsed })
              }}
            />
            <IconButton size="sm" icon={Settings2} label="Hand control settings" aria-pressed={panel} aria-expanded={panel} onClick={() => setPanel(!panel)} />
            <IconButton size="sm" icon={CircleHelp} label="Hand gestures" aria-pressed={legend} onClick={() => toggleLegend(!legend)} />
            <IconButton size="sm" icon={X} label="Turn off hand control" onClick={() => statusRef.current({ state: 'off' })} />
          </div>
        </div>
        {panel && (
          <div className="hand-settings border-t border-line px-1 pb-1 pt-2" role="group" aria-label="Hand control settings">
            <Segmented label="Click by" value={settings.click} onChange={(click) => change({ click })} options={[['pinch', 'Pinch'], ['dwell', 'Resting'], ['both', 'Both']]} />
            <Segmented label="Speed" value={settings.speed} onChange={(speed) => change({ speed })} options={[['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]} />
            <Segmented label="Hand" value={settings.hand} onChange={(hand) => change({ hand })} options={[['right', 'Right'], ['left', 'Left']]} />
            <Segmented label="Mirror" value={settings.mirror ? 'on' : 'off'} onChange={(m) => change({ mirror: m === 'on' })} options={[['on', 'On'], ['off', 'Off']]} />
            <Segmented label="Slap direction" value={settings.slapDir === 'reversed' ? 'reversed' : 'natural'} onChange={(slapDir) => change({ slapDir })} options={[['natural', 'Natural'], ['reversed', 'Reversed']]} />
            <Segmented label="Two-hand voice" value={settings.twoHand !== false ? 'on' : 'off'} onChange={(m) => change({ twoHand: m === 'on' })} options={[['on', 'On'], ['off', 'Off']]} />
          </div>
        )}
        <p className="min-h-[18px] px-1 text-xs leading-snug text-soft" aria-live="polite">
          {note ?? (phase === 'running' ? hint : loading)}
        </p>
        {phase === 'running' && <span ref={perf} className="block px-1 pb-0.5 font-mono text-[10px] leading-4 text-dim" />}
      </section>

      {legend && phase === 'running' && (
        <aside className="hand-legend rounded-2xl border border-line bg-panel p-4 shadow-overlay" aria-label="Hand gestures">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Hand gestures</h2>
            <IconButton size="sm" icon={X} label="Hide hand gestures" className="-mr-2 -mt-1" onClick={() => toggleLegend(false)} />
          </div>
          <GestureList compact dwell={settings.click !== 'pinch'} twoHand={settings.twoHand !== false} slapDir={settings.slapDir} />
          <p className="mt-2 text-xs text-dim">On-device model; camera frames never leave this browser.</p>
        </aside>
      )}
    </>,
    document.body,
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-dim">{label}</span>
      <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cx('min-h-7 rounded-md px-2 text-xs font-medium transition-colors', value === v ? 'bg-panel2 text-ink' : 'text-dim hover:text-ink')}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function GestureList({ compact = false, dwell, twoHand = true, slapDir }: { compact?: boolean; dwell: boolean; twoHand?: boolean; slapDir?: SlapDirection }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {GESTURES.filter((g) => (dwell || !g.dwellOnly) && (twoHand || !g.twoHand)).map((g) => (
        <li key={g.picto} className={cx('flex items-center gap-3', compact ? 'py-1.5' : 'py-2')}>
          <Pictogram kind={g.picto} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{g.does}</div>
            <div className={compact ? 'text-xs text-dim' : 'text-sm text-soft'}>{g.picto === 'slap' ? slapHow(slapDir) : g.how}</div>
          </div>
        </li>
      ))}
      <li className={cx('text-xs text-dim', compact ? 'py-1.5' : 'py-2')}>Delete, sign out and dialog buttons need the pinch held for a second. Zoom the 3D body by pinching with both hands and moving them apart.</li>
    </ul>
  )
}

/** Small looping pictograms (thin lines in the accent colour; still under prefers-reduced-motion). */
function Pictogram({ kind }: { kind: Picto }) {
  let body: ReactNode
  switch (kind) {
    case 'point':
      body = (
        <g className="pg-move-x">
          <path d="M17 30 V14 a2 2 0 0 1 4 0 V24 M21 22 h3 a2 2 0 0 1 2 2 v2 M24 23 h2 a2 2 0 0 1 2 2 v5 c0 4-3 6-6 6 h-2 c-3 0-5-2-6-5 l-2-5" />
          <circle cx="19" cy="8" r="1.6" className="pg-fill" />
        </g>
      )
      break
    case 'pinch':
      body = (
        <>
          <circle cx="20" cy="20" r="11" className="pg-dim" />
          <circle cx="13" cy="20" r="3" className="pg-fill pg-pinch-a" />
          <circle cx="27" cy="20" r="3" className="pg-fill pg-pinch-b" />
        </>
      )
      break
    case 'dwell':
      body = (
        <>
          <circle cx="20" cy="20" r="11" className="pg-dim" />
          <circle cx="20" cy="20" r="11" pathLength="100" className="pg-ring" transform="rotate(-90 20 20)" />
          <circle cx="20" cy="20" r="2" className="pg-fill" />
        </>
      )
      break
    case 'drag':
      body = (
        <g className="pg-move-y">
          <circle cx="18" cy="20" r="3" className="pg-fill" />
          <circle cx="22" cy="20" r="3" className="pg-fill" />
          <path d="M20 9 l-3 3 M20 9 l3 3 M20 31 l-3 -3 M20 31 l3 -3" />
        </g>
      )
      break
    case 'slap':
      body = (
        <>
          <g className="pg-slap">
            <rect x="15" y="11" width="10" height="18" rx="4" />
            <path d="M17 11 V7 M20 11 V6 M23 11 V7" />
          </g>
          <path d="M6 33 H34 M30 30 l4 3 -4 3" className="pg-dim" />
        </>
      )
      break
    case 'spread':
      body = (
        <>
          <g className="pg-spread-a">
            <rect x="11" y="15" width="7" height="13" rx="3" />
            <path d="M12.5 15 V11 M15 15 V10 M17 15 V11.5" />
          </g>
          <g className="pg-spread-b">
            <rect x="22" y="15" width="7" height="13" rx="3" />
            <path d="M23 15 V11.5 M25 15 V10 M27.5 15 V11" />
          </g>
          <path d="M5 33 H13 M35 33 H27 M8 30 l-3 3 3 3 M32 30 l3 3 -3 3" className="pg-dim" />
        </>
      )
      break
    case 'fist':
      body = (
        <g className="pg-squeeze">
          <rect x="12" y="13" width="16" height="15" rx="5" />
          <path d="M16 13 v4 M20 13 v4 M24 13 v4" />
        </g>
      )
      break
  }
  return (
    <svg className="hand-picto" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      {body}
    </svg>
  )
}
