// Targeting overlay for the selected body system in the 3D viewer.
//  - full (a hands-free mode is on): concentric rings and corner brackets lock onto the organ with a short scan,
//    and a thin leader line runs to a callout with the system's key reading.
//  - light (normal mouse/touch use): corner brackets only.
// Positions are written straight to the DOM from the viewer's per-frame `onView` callback (no React renders).
import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type MutableRefObject, type RefObject } from 'react'
import type { SystemId } from '../../data/systems'
import { STATUS_COLOR, type Status } from '../../data/vitals'
import type { ViewerControls } from '../three/Body3D'
import { StatusIcon, statusLabel } from '../ui'
import './gesture.css'

type Props = {
  controls: RefObject<ViewerControls | null>
  /** the viewer element the overlay sits in */
  box: RefObject<HTMLDivElement | null>
  selected: SystemId | null
  name: string
  status: Status | null
  reading?: string
  insets: { top: number; bottom: number }
  full: boolean
  /** BodyViewer calls the function stored here whenever the camera moved */
  updateRef: MutableRefObject<(() => void) | null>
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
// keep clear of the zoom buttons on the right edge of the viewer
const RIGHT_RESERVE = 56

export default function HudLock({ controls, box, selected, name, status, reading, insets, full, updateRef }: Props) {
  const reticle = useRef<HTMLDivElement>(null)
  const callout = useRef<HTMLDivElement>(null)
  const line = useRef<SVGPolylineElement>(null)
  const insetsRef = useRef(insets)
  insetsRef.current = insets

  const update = useCallback(() => {
    const ret = reticle.current
    const wrap = box.current
    if (!ret || !wrap || !selected) return
    const a = controls.current?.anchor(selected) ?? null
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    const ins = insetsRef.current
    const shown = !!a && a.x > -40 && a.x < w + 40 && a.y > ins.top - 40 && a.y < h - ins.bottom + 40
    ret.style.visibility = shown ? 'visible' : 'hidden'
    const c = callout.current
    const l = line.current
    if (!shown || !a) {
      if (c) c.style.visibility = 'hidden'
      l?.setAttribute('points', '')
      return
    }
    const s = clamp(a.r * 1.6, 44, 124)
    ret.style.width = `${s}px`
    ret.style.height = `${s}px`
    ret.style.transform = `translate(${a.x - s / 2}px, ${a.y - s / 2}px)`
    if (!c || !l) return
    const cw = c.offsetWidth
    const ch = c.offsetHeight
    const gap = 44
    const rightX = a.x + s / 2 + gap
    const leftX = a.x - s / 2 - gap - cw
    const fitsRight = rightX + cw <= w - RIGHT_RESERVE
    const fitsLeft = leftX >= 8
    if (w < 420 || (!fitsRight && !fitsLeft)) {
      c.style.visibility = 'hidden'
      l.setAttribute('points', '')
      return
    }
    const right = fitsRight
    const cx = right ? rightX : leftX
    const cy = clamp(a.y - s * 0.55 - ch / 2, ins.top + 4, h - ins.bottom - ch - 4)
    c.style.visibility = 'visible'
    c.style.transform = `translate(${cx}px, ${cy}px)`
    const edgeX = right ? cx : cx + cw
    const midY = cy + Math.min(ch / 2, 22)
    const ang = Math.atan2(midY - a.y, edgeX - a.x)
    const sx = a.x + Math.cos(ang) * (s / 2) * 0.94
    const sy = a.y + Math.sin(ang) * (s / 2) * 0.94
    const elbow = edgeX + (right ? -16 : 16)
    l.setAttribute('points', `${sx.toFixed(1)},${sy.toFixed(1)} ${elbow.toFixed(1)},${midY.toFixed(1)} ${edgeX.toFixed(1)},${midY.toFixed(1)}`)
  }, [box, controls, selected])

  useEffect(() => {
    updateRef.current = update
    return () => {
      if (updateRef.current === update) updateRef.current = null
    }
  }, [update, updateRef])

  // place it before the first paint, and again when the callout's size changes
  useLayoutEffect(update, [update, full, reading, name, status])
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    if (callout.current) ro.observe(callout.current)
    return () => ro.disconnect()
  }, [box, update, full])

  if (!selected) return null
  const tone = status && status !== 'ok' ? STATUS_COLOR[status] : undefined

  return (
    <div className="hud-lock" data-full={full || undefined} aria-hidden="true">
      {full && (
        <svg className="hud-lead" width="100%" height="100%">
          <polyline ref={line} points="" />
        </svg>
      )}
      <div ref={reticle} key={selected} className="hud-reticle" style={tone ? ({ '--hud-status': tone } as CSSProperties) : undefined}>
        <svg viewBox="-50 -50 100 100" width="100%" height="100%">
          <g className="hud-brackets">
            <path d="M-50 -34 V-50 H-34 M34 -50 H50 V-34 M50 34 V50 H34 M-34 50 H-50 V34" />
          </g>
          {full && (
            <>
              <circle className="hud-ring-outer" r="44" pathLength="100" />
              <circle className="hud-ring-inner" r="31" />
              <path className="hud-ticks" d="M0 -40 V-48 M40 0 H48 M0 40 V48 M-40 0 H-48" />
              <line className="hud-scan" x1="-44" x2="44" y1="0" y2="0" />
            </>
          )}
        </svg>
      </div>
      {full && (
        <div ref={callout} className="hud-callout">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} size={14} />
            <span className="truncate text-sm font-semibold text-ink">{name}</span>
          </div>
          {reading && (
            <div className="mt-1 text-base font-semibold leading-snug text-ink" style={tone ? { color: tone } : undefined}>
              {reading}
            </div>
          )}
          <div className="mt-0.5 text-xs text-dim">{status ? statusLabel(status) : 'Not measured yet'}</div>
        </div>
      )}
    </div>
  )
}
