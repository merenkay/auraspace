// Applies gesture intents to the real page: hovers and clicks interface elements, scrolls, switches tabs,
// and drives the 3D body viewer through its control API. The gesture logic itself lives in src/lib/gesture.
import { GesturePipeline, type GestureEvent, type GestureState, type RawFrame, type XY } from '../../lib/gesture/machine'
import { sfx } from '../../lib/sfx'
import { viewerAtElement, type ViewerHandle } from './viewerBridge'

const INTERACTIVE =
  'a[href], button, summary, label, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="option"], [data-hand-target]'
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]'
/** Labels that mean "this cannot be undone": an air-tap is not enough, the pinch must be held. */
const DESTRUCTIVE = /\b(delete|remove|erase|reset|clear|discard|wipe|revoke|forget|sign out|log out)\b/i
const SAFE_IN_DIALOG = /^(cancel|close|back|no|not now|keep|done|ok)\b/i

/** ms the cursor must rest on a control before an air-tap clicks it (a sweep across the page clicks nothing) */
export const ARM_MS = 160
const MAGNET_PX = 26
const ROT_GAIN = 0.85
const SCROLL_GAIN = 1.5
const RING: [number, number][] = Array.from({ length: 8 }, (_, i): [number, number] => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])

export type TargetKind = 'none' | 'ui' | 'viewer'

export type DriverView = {
  state: GestureState
  /** where to draw the cursor (viewport px, after the magnet pull), null when no hand */
  px: XY | null
  target: TargetKind
  /** 0..1 dwell before an air-tap is accepted */
  armed: number
  /** the control under the cursor needs a held pinch */
  confirm: boolean
}

type Hit = { raw: Element | null; el: HTMLElement | null; viewer: ViewerHandle | null; snap: XY | null }

function interactive(el: Element | null): HTMLElement | null {
  const t = el?.closest<HTMLElement>(INTERACTIVE) ?? null
  if (!t) return null
  if ((t as HTMLButtonElement).disabled || t.getAttribute('aria-disabled') === 'true') return null
  return t
}

function textOf(el: HTMLElement) {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
}

/** Destructive or dialog-confirming controls need a deliberate held pinch. */
export function needsHold(el: HTMLElement): boolean {
  if (el.closest('[data-hand-confirm]')) return true
  const text = textOf(el)
  if (DESTRUCTIVE.test(text)) return true
  if (el.classList.contains('text-crit')) return true // the danger button variant
  if (el.closest('[data-overlay-part="footer"]') && !SAFE_IN_DIALOG.test(text)) return true
  return false
}

function dialogOpen() {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]')
}

function visible(el: Element) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function scrollableFor(el: Element | null): Element | null {
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e)
    if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e
  }
  if (dialogOpen()) return null // the page behind a dialog is locked
  return document.scrollingElement
}

function fire(el: Element, type: string, at: XY, extra: Record<string, unknown> = {}) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, view: window, ...extra }
  const ev = type.startsWith('pointer') ? new PointerEvent(type, { pointerId: 7331, pointerType: 'mouse', isPrimary: false, ...init }) : new MouseEvent(type, init)
  el.dispatchEvent(ev)
}

export class HandDriver {
  readonly pipeline = new GesturePipeline()
  private notify: (text: string) => void
  private hovered: HTMLElement | null = null
  private hoverSince = 0
  private hoverViewer: ViewerHandle | null = null
  private lastMove: XY | null = null
  private press: (Hit & { armed: boolean; confirm: boolean }) | null = null
  private drag: { kind: 'viewer' | 'scroll'; viewer: ViewerHandle | null; scroller: Element | null } | null = null
  private zoomViewer: ViewerHandle | null = null
  private zoomY = 0
  private lastViewer: ViewerHandle | null = null

  constructor(notify: (text: string) => void) {
    this.notify = notify
  }

  private px(p: XY): XY {
    return { x: p.x * window.innerWidth, y: p.y * window.innerHeight }
  }

  /** What is under a viewport point: a 3D viewer canvas, an interactive element (with a small magnet), or nothing. */
  resolve(at: XY): Hit {
    const raw = document.elementFromPoint(at.x, at.y)
    const viewer = viewerAtElement(raw)
    if (viewer) return { raw, el: null, viewer, snap: null }
    let el = interactive(raw)
    if (!el) {
      let best = Infinity
      for (const [dx, dy] of RING) {
        const cand = interactive(document.elementFromPoint(at.x + dx * MAGNET_PX, at.y + dy * MAGNET_PX))
        if (!cand) continue
        const r = cand.getBoundingClientRect()
        const d = Math.hypot(Math.max(r.left - at.x, 0, at.x - r.right), Math.max(r.top - at.y, 0, at.y - r.bottom))
        if (d < best) {
          best = d
          el = cand
        }
      }
    }
    let snap: XY | null = null
    if (el) {
      const r = el.getBoundingClientRect()
      const cx = Math.min(Math.max(at.x, r.left + 4), r.right - 4)
      const cy = Math.min(Math.max(at.y, r.top + 4), r.bottom - 4)
      // pull the drawn cursor a little towards the control, at most 12 px
      const dx = cx - at.x
      const dy = cy - at.y
      const d = Math.hypot(dx, dy)
      const k = d > 0 ? Math.min(12, d * 0.45) / d : 0
      snap = { x: at.x + dx * k, y: at.y + dy * k }
    }
    return { raw, el, viewer: null, snap }
  }

  private setHover(hit: Hit | null, at: XY | null, now: number) {
    const el = hit?.el ?? null
    if (el !== this.hovered) {
      const prev = this.hovered
      if (prev) {
        prev.removeAttribute('data-hand-hover')
        if (at) {
          fire(prev, 'pointerout', at, { relatedTarget: el })
          fire(prev, 'mouseout', at, { relatedTarget: el })
        }
      }
      this.hovered = el
      this.hoverSince = now
      if (el && at) {
        el.setAttribute('data-hand-hover', '')
        fire(el, 'pointerover', at, { relatedTarget: prev })
        fire(el, 'mouseover', at, { relatedTarget: prev })
      }
    }
    if (el && at && (!this.lastMove || Math.hypot(at.x - this.lastMove.x, at.y - this.lastMove.y) >= 1)) {
      fire(el, 'pointermove', at)
      fire(el, 'mousemove', at)
    }
    if (el) {
      const state = now - this.hoverSince >= ARM_MS ? (needsHold(el) ? 'confirm' : 'armed') : ''
      if (el.getAttribute('data-hand-hover') !== state) el.setAttribute('data-hand-hover', state)
    }
    const viewer = hit?.viewer ?? null
    if (viewer !== this.hoverViewer) {
      this.hoverViewer?.controls()?.hoverAt(null)
      this.hoverViewer = viewer
    }
    if (viewer && at) {
      viewer.controls()?.hoverAt(at.x, at.y)
      this.lastViewer = viewer
    }
    this.lastMove = at
  }

  private click(el: HTMLElement, at: XY) {
    fire(el, 'pointerdown', at, { button: 0, buttons: 1 })
    fire(el, 'mousedown', at, { button: 0, buttons: 1 })
    if (el.matches(FOCUSABLE)) el.focus({ preventScroll: true })
    fire(el, 'pointerup', at, { button: 0, buttons: 0 })
    fire(el, 'mouseup', at, { button: 0, buttons: 0 })
    el.click()
  }

  private switchTab(dir: 'left' | 'right') {
    if (dialogOpen()) return
    const navs = [...document.querySelectorAll('nav')].filter((n) => {
      const label = n.getAttribute('aria-label') ?? ''
      return (label === 'Main' || label.startsWith('Sections for')) && visible(n) && n.querySelector('[aria-current="page"]')
    })
    // the section tabs of the record being viewed come before the main navigation
    const nav = navs.find((n) => (n.getAttribute('aria-label') ?? '').startsWith('Sections for')) ?? navs[0]
    if (!nav) return
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(visible)
    const cur = links.findIndex((a) => a.getAttribute('aria-current') === 'page')
    const next = links[cur + (dir === 'left' ? 1 : -1)]
    if (cur < 0 || !next) {
      this.notify(dir === 'left' ? 'Already on the last tab' : 'Already on the first tab')
      return
    }
    next.click()
    sfx('tick')
    this.notify(textOf(next))
  }

  private onEvent(e: GestureEvent) {
    switch (e.type) {
      case 'press': {
        const at = this.px(e)
        const hit = this.resolve(at)
        const armed = !!hit.el && hit.el === this.hovered && performance.now() - this.hoverSince >= ARM_MS
        this.press = { ...hit, armed, confirm: !!hit.el && needsHold(hit.el) }
        return
      }
      case 'tap': {
        const p = this.press
        if (!p) return
        const at = this.px(e)
        if (p.viewer) {
          const id = p.viewer.controls()?.pickAt(at.x, at.y)
          if (id) sfx('select')
          return
        }
        if (!p.el) return
        if (p.confirm) {
          sfx('warn')
          this.notify('Hold the pinch to confirm')
        } else if (p.armed) {
          this.click(p.el, p.snap ?? at)
          sfx('tick')
        } else this.notify('Rest on a control, then pinch')
        return
      }
      case 'hold': {
        const p = this.press
        if (p?.el) {
          this.click(p.el, p.snap ?? this.px(e))
          sfx('confirm')
        }
        return
      }
      case 'dragstart': {
        const p = this.press
        this.drag = p?.viewer ? { kind: 'viewer', viewer: p.viewer, scroller: null } : { kind: 'scroll', viewer: null, scroller: scrollableFor(p?.raw ?? null) }
        if (this.drag.kind === 'viewer') this.drag.viewer?.controls()?.hoverAt(null)
        return
      }
      case 'drag': {
        const d = this.drag
        if (!d) return
        const dx = e.dx * window.innerWidth
        const dy = e.dy * window.innerHeight
        if (d.kind === 'viewer') d.viewer?.controls()?.rotateBy(dx * ROT_GAIN, dy * ROT_GAIN)
        else d.scroller?.scrollBy({ top: -dy * SCROLL_GAIN, behavior: 'instant' })
        return
      }
      case 'depth': {
        // single-hand push/pull over the viewer: hand closer to the camera = zoom in
        const v = this.press?.viewer
        if (v) v.controls()?.zoomBy(Math.pow(e.factor, -1.6), this.px(e).y)
        return
      }
      case 'dragend':
      case 'release':
        if (e.type === 'release') this.press = null
        this.drag = null
        return
      case 'zoomstart': {
        const at = this.px(e)
        this.zoomViewer = this.resolve(at).viewer
        this.zoomY = at.y
        if (this.zoomViewer) sfx('tick')
        return
      }
      case 'zoom':
        this.zoomViewer?.controls()?.zoomBy(1 / e.factor, this.zoomY)
        return
      case 'zoomend':
        this.zoomViewer = null
        return
      case 'swipe':
        this.switchTab(e.dir)
        return
      case 'fist': {
        if (dialogOpen()) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          sfx('close')
          this.notify('Closed')
          return
        }
        const v = this.resolve(this.px(e)).viewer ?? this.hoverViewer
        if (v) {
          v.controls()?.reset()
          sfx('close')
          this.notify('View reset')
        }
        return
      }
      case 'idle':
        this.setHover(null, null, performance.now())
        return
      case 'found':
        return
    }
  }

  /** recent intents (for the dev-only inspector) */
  readonly log: { t: number; type: string; info?: string }[] = []

  step(frame: RawFrame): DriverView {
    const { state, events } = this.pipeline.push(frame)
    for (const e of events) {
      this.onEvent(e)
      if (import.meta.env.DEV) {
        this.log.push({ t: Math.round(frame.t), type: e.type, info: e.type === 'swipe' ? e.dir : e.type === 'tap' || e.type === 'press' ? `${Math.round(e.x * window.innerWidth)},${Math.round(e.y * window.innerHeight)}` : undefined })
        if (this.log.length > 60) this.log.shift()
      }
    }
    const now = performance.now()
    const at = state.cursor ? this.px(state.cursor) : null
    let view: DriverView = { state, px: at, target: 'none', armed: 0, confirm: false }
    if (!at || !state.present) {
      this.setHover(null, null, now)
      return view
    }
    if (state.mode === 'hover') {
      const hit = this.resolve(at)
      this.setHover(hit, at, now)
      view = { ...view, px: hit.snap ?? at, target: hit.viewer ? 'viewer' : hit.el ? 'ui' : 'none', armed: hit.el ? Math.min(1, (now - this.hoverSince) / ARM_MS) : 0, confirm: !!hit.el && needsHold(hit.el) }
    } else {
      const p = this.press
      const target: TargetKind = this.drag?.kind === 'viewer' || state.mode === 'zoom' || p?.viewer ? 'viewer' : p?.el ? 'ui' : 'none'
      view = { ...view, px: state.mode === 'press' ? (p?.snap ?? at) : at, target, armed: p?.armed ? 1 : 0, confirm: !!p?.confirm }
    }
    return view
  }

  /** Drop every hover mark and viewer highlight (hand control switched off). */
  dispose() {
    this.setHover(null, null, performance.now())
    this.lastViewer?.controls()?.hoverAt(null)
    this.press = null
    this.drag = null
    this.pipeline.reset()
  }
}
