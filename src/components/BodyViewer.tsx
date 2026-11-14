import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'
import BodyMap from './BodyMap'
import type { HoverMeta, LayerId, ViewerControls } from './three/Body3D'
import { Spinner } from './ui'

const Body3D = lazy(() => import('./three/Body3D'))

type Manifest = { files: string[] }
type RawManifest = { files: (string | { file: string })[] }
let manifestPromise: Promise<Manifest | null> | null = null
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/models/body-manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: RawManifest | null) =>
        m && Array.isArray(m.files) && m.files.length
          ? { files: m.files.map((f) => `/models/${(typeof f === 'string' ? f : f.file).replace(/^.*\//, '')}`) }
          : null,
      )
      .catch(() => null)
    // a failed attempt (offline blip) is retried the next time a viewer mounts
    void manifestPromise.then((m) => {
      if (!m) manifestPromise = null
    })
  }
  return manifestPromise
}

// Checked once per page load. The probe context is released straight away: browsers only allow a handful of
// live WebGL contexts, and the viewer is mounted again on every visit to Overview and Diagnostics.
let webglSupport: boolean | null = null
function webglOK() {
  if (webglSupport === null) {
    try {
      const c = document.createElement('canvas')
      const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
      webglSupport = !!gl
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webglSupport = false
    }
  }
  return webglSupport
}

// Once the 3D view has failed (model missing, context lost) the rest of the session uses the SVG map.
let viewerBroken = false

class ViewerBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const LAYERS: { id: LayerId; label: string; color: string }[] = [
  { id: 'skeleton', label: 'Skeleton', color: '#e9dfc9' },
  { id: 'organs', label: 'Organs', color: '#e9a3a0' },
  { id: 'arteries', label: 'Arteries', color: '#e0362f' },
  { id: 'veins', label: 'Veins', color: '#3f6ae0' },
  { id: 'nerves', label: 'Nerves', color: '#f5d547' },
  { id: 'muscles', label: 'Muscles', color: '#b9574d' },
  { id: 'skin', label: 'Skin', color: '#7fd4f0' },
]

const DEFAULT_LAYERS: Record<LayerId, boolean> = { skin: false, muscles: true, skeleton: true, organs: true, arteries: true, veins: false, nerves: false }
const LOAD_TIMEOUT_MS = 45000
const TIP_W = 240

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

type Props = {
  statuses: Record<SystemId, Status>
  summaries: Record<SystemId, string>
  selected: SystemId | null
  onSelect: (id: SystemId) => void
  heartRate: number
  compact?: boolean
  showRadiation?: boolean
}

type Hover = { id: SystemId; cycling: boolean; count: number }
// 'auto' = idle showcase spin (only while nothing is selected); 'on' / 'off' = the user's explicit choice
type Spin = 'auto' | 'on' | 'off'

const BTN = 'min-h-9 rounded-full border border-line bg-space/70 px-3 text-xs font-semibold text-soft transition hover:border-cyan'
const BTN_ON = 'min-h-9 rounded-full border border-cyan/50 bg-cyan/10 px-3 text-xs font-semibold text-ink transition hover:border-cyan'

export default function BodyViewer({ statuses, summaries, selected, onSelect, heartRate, compact = false, showRadiation = true }: Props) {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined)
  const [failed, setFailed] = useState(viewerBroken)
  const [ready, setReady] = useState(false)
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(DEFAULT_LAYERS)
  const [hover, setHover] = useState<Hover | null>(null)
  const [spin, setSpin] = useState<Spin>('auto')
  const [xray, setXray] = useState(true)
  const [insets, setInsets] = useState({ top: 48, bottom: compact ? 8 : 64 })
  const [zoomHint, setZoomHint] = useState(false)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')

  const wrapRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipPos = useRef({ x: 0, y: 0 })
  const controls = useRef<ViewerControls | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hintCount = useRef(0)

  const fail = useCallback(() => {
    viewerBroken = true
    setFailed(true)
  }, [])

  useEffect(() => {
    let alive = true
    loadManifest().then((m) => alive && setManifest(m && webglOK() ? m : null))
    return () => {
      alive = false
      clearTimeout(hintTimer.current)
    }
  }, [])

  const use3D = !!manifest && !failed

  // a model that never arrives (stalled connection) must not leave an empty box
  useEffect(() => {
    if (!use3D || ready) return
    const t = setTimeout(fail, LOAD_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [use3D, ready, fail])

  // the 3D body is framed between the overlay bars, whatever their height (the layer chips wrap on phones)
  useLayoutEffect(() => {
    if (!use3D) return
    const measure = () => {
      const top = Math.round((topRef.current?.offsetHeight ?? 0) + 8)
      const bottom = Math.round((bottomRef.current?.offsetHeight ?? 0) + 8)
      setInsets((cur) => (cur.top === top && cur.bottom === bottom ? cur : { top, bottom }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    if (topRef.current) ro.observe(topRef.current)
    if (bottomRef.current) ro.observe(bottomRef.current)
    return () => ro.disconnect()
  }, [use3D, compact, showRadiation])

  // keep the tooltip inside the viewer: flip to the other side of the pointer near the right and bottom edges
  const placeTip = useCallback(() => {
    const el = tipRef.current
    const box = wrapRef.current
    if (!el || !box) return
    const { x, y } = tipPos.current
    const w = Math.min(TIP_W, box.clientWidth - 16)
    const h = el.offsetHeight
    let left = x + 16
    if (left + w > box.clientWidth - 8) left = x - 16 - w
    left = Math.max(8, Math.min(left, box.clientWidth - 8 - w))
    let top = y + 16
    if (top + h > box.clientHeight - 8) top = y - 12 - h
    top = Math.max(8, top)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [])
  useLayoutEffect(placeTip, [hover, placeTip])

  const onHover = useCallback(
    (id: SystemId | null, x?: number, y?: number, meta?: HoverMeta) => {
      if (id && x != null && y != null) {
        tipPos.current = { x, y }
        placeTip()
      }
      const cycling = meta?.cycling ?? false
      const count = meta?.count ?? 1
      setHover((cur) => {
        if (!id) return cur ? null : cur
        return cur && cur.id === id && cur.cycling === cycling && cur.count === count ? cur : { id, cycling, count }
      })
    },
    [placeTip],
  )

  const onInteract = useCallback(() => setSpin((s) => (s === 'auto' ? 'off' : s)), [])
  const onReady = useCallback(() => setReady(true), [])
  const onZoomHint = useCallback(() => {
    if (hintCount.current >= 3) return
    setZoomHint((shown) => {
      if (!shown) hintCount.current++
      return true
    })
    clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setZoomHint(false), 1800)
  }, [])

  if (manifest === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading body model" />
      </div>
    )
  }

  if (!use3D) {
    return (
      <div className="h-full">
        <BodyMap statuses={statuses} summaries={summaries} selected={selected} onSelect={onSelect} heartRate={heartRate} showRadiation={showRadiation} />
      </div>
    )
  }

  const spinning = spin === 'on' || (spin === 'auto' && !selected && !reducedMotion)
  const tip = hover ? SYSTEM_BY_ID[hover.id] : null
  const sel = selected ? SYSTEM_BY_ID[selected] : null
  const noLayers = !Object.values(layers).some(Boolean) && !selected

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" data-viewer="3d">
      <ViewerBoundary onError={fail}>
        <Suspense fallback={null}>
          <Body3D
            files={manifest.files}
            layers={layers}
            statuses={statuses}
            selected={selected}
            onSelect={onSelect}
            onHover={onHover}
            autoRotate={spinning}
            onInteract={onInteract}
            xray={xray}
            showRadiation={showRadiation}
            insets={insets}
            reducedMotion={reducedMotion}
            onReady={onReady}
            onLost={fail}
            onZoomHint={onZoomHint}
            controlsRef={controls}
          />
        </Suspense>
      </ViewerBoundary>

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner label="Loading 3D anatomy" />
        </div>
      )}

      {ready && noLayers && (
        <p className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-dim">All layers are hidden. Turn one on below.</p>
      )}

      {/* top bar: what is selected (or how to use the viewer) and the view switches */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 px-1 pt-1" aria-live="polite">
          {sel ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-ink" data-viewer-selected={sel.id}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[statuses[sel.id]] }} />
              <span className="truncate">{sel.name}</span>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: STATUS_COLOR[statuses[sel.id]] }}>
                {STATUS_LABEL[statuses[sel.id]]}
              </span>
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-dim">
              {coarse ? 'Tap a body part · drag to rotate · pinch to zoom' : 'Click a body part · drag to rotate · Ctrl + scroll to zoom'}
            </p>
          )}
        </div>
        <div className="pointer-events-auto ml-auto flex flex-wrap justify-end gap-1.5">
          {showRadiation && (
            <button type="button" onClick={() => onSelect('radiation')} aria-pressed={selected === 'radiation'} className={selected === 'radiation' ? BTN_ON : BTN}>
              Whole body
            </button>
          )}
          <button
            type="button"
            onClick={() => setXray((v) => !v)}
            aria-pressed={xray}
            title="Fade the other layers so the selected system stays visible"
            className={xray ? BTN_ON : BTN}
          >
            X-ray
          </button>
          <button type="button" onClick={() => setSpin(spinning ? 'off' : 'on')} aria-pressed={spinning} className={spinning ? BTN_ON : BTN}>
            {spinning ? 'Pause' : 'Rotate'}
          </button>
        </div>
      </div>

      {/* zoom: buttons work everywhere (the mouse wheel is left to page scrolling) */}
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => controls.current?.zoom(1)} className={`${BTN} w-9 px-0 text-base`}>
          +
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => controls.current?.zoom(-1)} className={`${BTN} w-9 px-0 text-base`}>
          −
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" onClick={() => controls.current?.reset()} className={`${BTN} w-9 px-0 text-base`}>
          ⟲
        </button>
      </div>

      {zoomHint && (
        <p role="status" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-space/90 px-4 py-2 text-xs font-semibold text-soft">
          Hold Ctrl and scroll to zoom
        </p>
      )}

      {tip && hover && (
        <div
          ref={tipRef}
          data-viewer-tip={tip.id}
          className="pointer-events-none absolute z-20 rounded-2xl border bg-space/95 p-3 shadow-2xl backdrop-blur"
          style={{ width: TIP_W, maxWidth: 'calc(100% - 16px)', borderColor: STATUS_COLOR[statuses[tip.id]] }}
        >
          {hover.cycling && <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan">Click again to select</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{tip.name}</span>
            <span className="text-[10px] font-bold tracking-widest" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
              {STATUS_LABEL[statuses[tip.id]]}
            </span>
          </div>
          <div className="mt-1 text-base font-bold" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
            {summaries[tip.id]}
          </div>
          <p className="mt-1 text-xs leading-snug text-soft">{tip.hint}</p>
          {!hover.cycling && hover.count > 1 && (
            <p className="mt-1.5 text-[10px] leading-snug text-dim">
              {hover.count - 1} more {hover.count === 2 ? 'system' : 'systems'} behind this spot. Click again to reach {hover.count === 2 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-2 bottom-1 flex flex-col items-center gap-1">
        {!compact && (
          <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5" role="group" aria-label="Visible layers">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={layers[l.id]}
                onClick={() => setLayers((s) => ({ ...s, [l.id]: !s[l.id] }))}
                className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                  layers[l.id] ? 'border-cyan/50 bg-cyan/10 text-ink' : 'border-line bg-space/70 text-dim'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: layers[l.id] ? l.color : '#33506b' }} />
                {l.label}
              </button>
            ))}
          </div>
        )}
        <a
          href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html"
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto text-[10px] text-dim/70 hover:text-dim"
        >
          3D: BodyParts3D © DBCLS · CC BY-SA 2.1 JP
        </a>
      </div>
    </div>
  )
}
