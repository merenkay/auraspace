import { Minus, Pause, Play, Plus, RotateCcw, Scan } from 'lucide-react'
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, type Status } from '../data/vitals'
import BodyMap from './BodyMap'
import HudLock from './gesture/HudLock'
import { registerViewer, useHandMode, useHud } from './gesture/viewerBridge'
import type { HoverMeta, LayerId, ViewerControls } from './three/Body3D'
import { Button, cx, IconButton, Spinner, StatusIcon, statusLabel, StatusText, useMedia } from './ui'

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

type Props = {
  statuses: Record<SystemId, Status>
  /** Systems with at least one reading. Unmeasured systems read "Not measured yet" instead of "Normal". */
  measured?: Record<SystemId, boolean>
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


export default function BodyViewer({ statuses, measured, summaries, selected, onSelect, heartRate, compact = false, showRadiation = true }: Props) {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined)
  const [failed, setFailed] = useState(viewerBroken)
  const [ready, setReady] = useState(false)
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(DEFAULT_LAYERS)
  const [hover, setHover] = useState<Hover | null>(null)
  const [spin, setSpin] = useState<Spin>('auto')
  const [xray, setXray] = useState(true)
  const [insets, setInsets] = useState({ top: 48, bottom: compact ? 8 : 64 })
  const [zoomHint, setZoomHint] = useState(false)
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const coarse = useMedia('(pointer: coarse)')

  const wrapRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipPos = useRef({ x: 0, y: 0 })
  const controls = useRef<ViewerControls | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hintCount = useRef(0)
  const hudUpdate = useRef<(() => void) | null>(null)
  const hud = useHud()
  // camera hand control is on: no idle auto-spin, and a lighter renderer (detection shares the device)
  const handMode = useHandMode()

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

  // hand control finds this viewer (and drives it through `controls`) when its cursor is over the canvas
  useEffect(() => {
    const el = wrapRef.current
    if (!use3D || !el) return
    return registerViewer({ el, controls: () => controls.current })
  }, [use3D])

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
  const onView = useCallback(() => hudUpdate.current?.(), [])
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
        <BodyMap statuses={statuses} measured={measured} summaries={summaries} selected={selected} onSelect={onSelect} heartRate={heartRate} showRadiation={showRadiation} />
      </div>
    )
  }

  const shown = (id: SystemId): Status | null => (measured && measured[id] === false ? null : statuses[id])
  const spinning = spin === 'on' || (spin === 'auto' && !selected && !reducedMotion)
  const tip = hover ? SYSTEM_BY_ID[hover.id] : null
  const sel = selected ? SYSTEM_BY_ID[selected] : null
  const noLayers = !Object.values(layers).some(Boolean) && !selected
  // a pressed toggle is a bordered plate, an unpressed one is quiet text (same footprint, so nothing shifts)
  const toggle = (on: boolean) => ({ variant: on ? ('secondary' as const) : ('quiet' as const), className: on ? 'bg-panel2' : 'border border-transparent bg-space/70' })

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
            autoRotate={spinning && !handMode}
            lowPower={handMode}
            onInteract={onInteract}
            xray={xray}
            showRadiation={showRadiation}
            insets={insets}
            reducedMotion={reducedMotion}
            onReady={onReady}
            onLost={fail}
            onZoomHint={onZoomHint}
            controlsRef={controls}
            onView={onView}
          />
        </Suspense>
      </ViewerBoundary>

      {ready && sel && (
        <HudLock controls={controls} box={wrapRef} selected={sel.id} name={sel.name} status={shown(sel.id)} reading={summaries[sel.id]} insets={insets} full={hud} updateRef={hudUpdate} />
      )}

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner label="Loading 3D anatomy" />
        </div>
      )}

      {ready && noLayers && <p className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-dim">All layers are hidden. Turn one on below.</p>}

      {/* top bar: what is selected (or how to use the viewer) and the view switches */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 px-1 pt-1.5" aria-live="polite">
          {sel ? (
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink" data-viewer-selected={sel.id}>
              <StatusIcon status={shown(sel.id)} size={15} />
              <span className="truncate">{sel.name}</span>
              <span className="font-normal text-dim">· {shown(sel.id) ? statusLabel(shown(sel.id)!) : "Not measured yet"}</span>
            </p>
          ) : (
            <p className="text-xs leading-snug text-dim">{coarse ? 'Tap a body part. Drag to rotate, pinch to zoom.' : 'Click a body part. Drag to rotate, Ctrl + scroll to zoom.'}</p>
          )}
        </div>
        <div className="pointer-events-auto ml-auto flex flex-wrap justify-end gap-2">
          {showRadiation && (
            <Button size="sm" onClick={() => onSelect('radiation')} aria-pressed={selected === 'radiation'} {...toggle(selected === 'radiation')}>
              Whole body
            </Button>
          )}
          <Button size="sm" icon={Scan} onClick={() => setXray((v) => !v)} aria-pressed={xray} title="Fade the other layers so the selected system stays visible" {...toggle(xray)}>
            X-ray
          </Button>
          <Button size="sm" icon={spinning ? Pause : Play} onClick={() => setSpin(spinning ? 'off' : 'on')} aria-pressed={spinning} {...toggle(spinning)}>
            {spinning ? 'Pause' : 'Rotate'}
          </Button>
        </div>
      </div>

      {/* zoom buttons work everywhere (the mouse wheel is left to page scrolling) */}
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        <IconButton icon={Plus} label="Zoom in" variant="secondary" size="sm" className="border-line bg-space/80" onClick={() => controls.current?.zoom(1)} />
        <IconButton icon={Minus} label="Zoom out" variant="secondary" size="sm" className="border-line bg-space/80" onClick={() => controls.current?.zoom(-1)} />
        <IconButton icon={RotateCcw} label="Reset view" variant="secondary" size="sm" className="border-line bg-space/80" onClick={() => controls.current?.reset()} />
      </div>

      {zoomHint && (
        <p role="status" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel2 px-4 py-2 text-sm text-soft shadow-overlay">
          Hold Ctrl and scroll to zoom
        </p>
      )}

      {tip && hover && (
        <div
          ref={tipRef}
          data-viewer-tip={tip.id}
          className="pointer-events-none absolute z-20 rounded-2xl border border-line bg-panel2 p-3 shadow-overlay"
          style={{ width: TIP_W, maxWidth: 'calc(100% - 16px)' }}
        >
          {hover.cycling && <p className="mb-1 text-xs font-medium text-accent">Click again to select</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{tip.name}</span>
            <StatusText status={shown(tip.id)} className="text-xs" />
          </div>
          <div className="mt-1 text-base font-semibold" style={{ color: statuses[tip.id] === 'ok' ? undefined : STATUS_COLOR[statuses[tip.id]] }}>
            {summaries[tip.id]}
          </div>
          <p className="mt-1 text-xs leading-snug text-soft">{tip.hint}</p>
          {!hover.cycling && hover.count > 1 && (
            <p className="mt-1.5 text-xs leading-snug text-dim">
              {hover.count - 1} more {hover.count === 2 ? 'system' : 'systems'} behind this spot. Click again to reach {hover.count === 2 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-2 bottom-1 flex flex-col items-center gap-1">
        {!compact && (
          <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto sm:flex-wrap sm:justify-center sm:overflow-visible" role="group" aria-label="Visible layers">
            {LAYERS.map((l) => (
              <Button key={l.id} size="sm" aria-pressed={layers[l.id]} onClick={() => setLayers((cur) => ({ ...cur, [l.id]: !cur[l.id] }))} {...toggle(layers[l.id])}>
                <span className={cx('h-2 w-2 rounded-full', !layers[l.id] && 'opacity-30')} style={{ background: l.color }} />
                {l.label}
              </Button>
            ))}
          </div>
        )}
        <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noreferrer" className="pointer-events-auto text-xs text-dim hover:text-soft">
          3D model: BodyParts3D © DBCLS, CC BY-SA 2.1 JP
        </a>
      </div>
    </div>
  )
}
