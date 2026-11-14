// The spotlight: everything except the current target is dimmed, the lit area glides from one target to the
// next, and a short note is attached to it with a leader line. The page underneath stays fully usable.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { boxOf, resolveTarget } from '../../lib/demo/dom'
import type { Callout, Highlight } from '../../lib/demo/types'
import { DUR, EASE } from '../ui'

/** The lit box, with the note that belongs to it (kept together so they always change in the same frame). */
type Rect = { key: string; x: number; y: number; w: number; h: number; callout: Callout | null }
type Side = 'right' | 'left' | 'bottom' | 'top' | 'inside'
type Place = { side: Side; left: number; top: number; width: number; line: { left: number; top: number; width: number; height: number } | null; dot: { left: number; top: number } | null }

const EDGE = 8
const GAP = 28
const MORPH_S = 0.55

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Follows the target on screen (scrolling, layout changes) and reports its visible box. */
function useTargetRect(highlight: Highlight | null, bottomInset: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  const key = highlight?.key ?? null
  const ref = useRef(highlight)
  ref.current = highlight
  useEffect(() => {
    if (!key) {
      setRect(null)
      return
    }
    let el: HTMLElement | null = null
    let raf = 0
    let last = ''
    const tick = () => {
      const h = ref.current
      if (h) {
        if (!el || !el.isConnected) el = resolveTarget(h.target)
        let next: Rect | null = null
        if (el) {
          const b = boxOf(el)
          const pad = h.pad ?? 8
          const x = Math.max(EDGE, b.x - pad)
          const y = Math.max(EDGE, b.y - pad)
          const r = Math.min(window.innerWidth - EDGE, b.x + b.w + pad)
          const btm = Math.min(window.innerHeight - bottomInset - EDGE, b.y + b.h + pad)
          if (r - x > 12 && btm - y > 12) next = { key: h.key, x: Math.round(x), y: Math.round(y), w: Math.round(r - x), h: Math.round(btm - y), callout: h.callout ?? null }
        }
        const sig = next ? `${next.key}:${next.x},${next.y},${next.w},${next.h}` : 'none'
        if (sig !== last) {
          last = sig
          setRect(next)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [key, bottomInset])
  return key ? rect : null
}

function place(r: Rect, noteH: number, bottomInset: number): Place {
  const vw = window.innerWidth
  const vh = window.innerHeight - bottomInset
  const phone = vw < 640
  const width = Math.min(320, vw - 32)
  const fitsRight = r.x + r.w + GAP + width <= vw - 16
  const fitsLeft = r.x - GAP - width >= 16
  const fitsBottom = r.y + r.h + GAP + noteH <= vh - 8
  const fitsTop = r.y - GAP - noteH >= 8
  const side: Side = !phone && fitsRight ? 'right' : !phone && fitsLeft ? 'left' : fitsBottom ? 'bottom' : fitsTop ? 'top' : fitsRight ? 'right' : fitsLeft ? 'left' : 'inside'
  if (side === 'right' || side === 'left') {
    const top = clamp(r.y + 12, 8, vh - noteH - 8)
    const y = clamp(top + 26, r.y + 10, r.y + r.h - 10)
    const left = side === 'right' ? r.x + r.w + GAP : r.x - GAP - width
    const lineLeft = side === 'right' ? r.x + r.w : r.x - GAP
    return { side, left, top, width, line: { left: lineLeft, top: y, width: GAP, height: 1 }, dot: { left: side === 'right' ? r.x + r.w : r.x, top: y } }
  }
  if (side === 'bottom' || side === 'top') {
    const left = clamp(r.x + r.w / 2 - width / 2, 16, vw - width - 16)
    const x = clamp(r.x + r.w / 2, left + 20, left + width - 20)
    const top = side === 'bottom' ? r.y + r.h + GAP : r.y - GAP - noteH
    const lineTop = side === 'bottom' ? r.y + r.h : r.y - GAP
    return { side, left, top, width, line: { left: x, top: lineTop, width: 1, height: GAP }, dot: { left: x, top: side === 'bottom' ? r.y + r.h : r.y } }
  }
  // The target fills the screen: the note sits inside the lit area, at its lower edge.
  return { side, left: clamp(r.x + 12, 16, vw - width - 16), top: clamp(r.y + r.h - noteH - 12, 8, vh - noteH - 8), width, line: null, dot: null }
}

export default function Spotlight({ highlight, bottomInset, reduced }: { highlight: Highlight | null; bottomInset: number; reduced: boolean }) {
  const rect = useTargetRect(highlight, bottomInset)
  const noteRef = useRef<HTMLDivElement>(null)
  const [noteH, setNoteH] = useState(96)
  const callout = rect?.callout ?? null

  useLayoutEffect(() => {
    const h = noteRef.current?.offsetHeight
    if (h && Math.abs(h - noteH) > 1) setNoteH(h)
  })

  // A new target: glide there. The same target moving (scroll, layout): follow it at once.
  const morphUntil = useRef(0)
  const shownKey = useRef<string | null>(null)
  if (rect && rect.key !== shownKey.current) {
    shownKey.current = rect.key
    morphUntil.current = performance.now() + MORPH_S * 1000
  }
  if (!rect) shownKey.current = null
  const gliding = !reduced && performance.now() < morphUntil.current
  const move = gliding ? { duration: MORPH_S, ease: EASE.inOut } : { duration: 0 }
  const fade = { duration: reduced ? 0 : DUR.base, ease: EASE.out }
  const p = rect && callout ? place(rect, noteH, bottomInset) : null

  return (
    <AnimatePresence>
      {rect && (
        <motion.div
          key="hole"
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl outline outline-1 outline-ink/35"
          style={{ boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.62)' }}
          initial={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: 0 }}
          animate={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ default: move, opacity: fade }}
        />
      )}
      {rect && p?.line && (
        <motion.div
          key="line"
          aria-hidden="true"
          className="pointer-events-none fixed bg-ink/70"
          initial={{ ...p.line, opacity: 0 }}
          animate={{ ...p.line, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ default: move, opacity: fade }}
        />
      )}
      {rect && p?.dot && (
        <motion.div
          key="dot"
          aria-hidden="true"
          className="pointer-events-none fixed -ml-[3px] -mt-[3px] h-[7px] w-[7px] rounded-full bg-ink"
          initial={{ ...p.dot, opacity: 0 }}
          animate={{ ...p.dot, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ default: move, opacity: fade }}
        />
      )}
      {rect && p && callout && (
        <motion.div
          key="note"
          ref={noteRef}
          className="pointer-events-none fixed rounded-xl border border-line bg-panel2 px-4 py-3 shadow-overlay"
          style={{ width: p.width }}
          initial={{ left: p.left, top: p.top, opacity: 0 }}
          animate={{ left: p.left, top: p.top, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ default: move, opacity: fade }}
        >
          <motion.div key={rect.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : DUR.base, delay: gliding ? MORPH_S * 0.5 : 0 }}>
            {callout.title && <p className="text-[15px] font-semibold leading-snug text-ink">{callout.title}</p>}
            <p className={callout.title ? 'mt-1 text-sm leading-relaxed text-soft' : 'text-sm leading-relaxed text-soft'}>{callout.text}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
