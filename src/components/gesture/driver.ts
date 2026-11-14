// Applies gesture intents to the real page: hovers and clicks interface elements (pinch or dwell), scrolls,
// switches tabs on a slap, and drives the 3D body viewer through its control API. The gesture logic itself lives
// in src/lib/gesture (pure, unit-tested); this file is the DOM side.
import { SYSTEM_BY_ID } from '../../data/systems'
import { GesturePipeline, type GestureEvent, type GestureOptions, type GestureState, type RawFrame, type XY } from '../../lib/gesture/machine'
import { Dwell, magnetRadius, pickTarget, snapPoint, type Cand } from '../../lib/gesture/target'
import { DEV_HOOKS } from '../../lib/devHooks'
import { sfx } from '../../lib/sfx'
import { viewerAtElement, type ViewerHandle } from './viewerBridge'

const INTERACTIVE =
  'a[href], button, summary, label, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="option"], [data-hand-target]'
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]'
/** Labels that mean "this cannot be undone": an air-tap or a dwell is not enough, the pinch must be held. */
const DESTRUCTIVE = /\b(delete|remove|erase|reset|clear|discard|wipe|revoke|forget|sign out|log out)\b/i
const SAFE_IN_DIALOG = /^(cancel|close|back|no|not now|keep|done|ok)\b/i

/** ms the cursor must rest on a control before an air-tap clicks it (a sweep across the page clicks nothing) */
export const ARM_MS = 160
/** rotation per hand-drag pixel, and the largest rotation step per detection (px) */
const ROT_GAIN = 0.8
const ROT_MAX_STEP = 70
/** after letting go of a rotation, it coasts and slows down with this time constant (ms) */
const INERTIA_MS = 260
const SCROLL_GAIN = 1.5
/** zoom per detection is limited to this factor (either way), and tiny changes are ignored */
const ZOOM_MAX_STEP = 1.08
const ZOOM_DEADBAND = 0.004

export type ClickMode = 'pinch' | 'dwell' | 'both'
export type Speed = 'slow' | 'normal' | 'fast'
export type HandSettings = { click: ClickMode; speed: Speed; hand: 'right' | 'left'; mirror: boolean }
export const DEFAULT_SETTINGS: HandSettings = { click: 'both', speed: 'normal', hand: 'right', mirror: true }

/** Sensitivity: how much of the camera picture maps onto the screen (smaller = less hand travel) and the dwell time. */
export const SPEEDS: Record<Speed, { region: GestureOptions['region']; dwellMs: number }> = {
  slow: { region: { x0: 0.14, x1: 0.86, y0: 0.1, y1: 0.74 }, dwellMs: 1100 },
  normal: { region: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.68 }, dwellMs: 800 },
  fast: { region: { x0: 0.26, x1: 0.74, y0: 0.2, y1: 0.62 }, dwellMs: 550 },
}

export type TargetKind = 'none' | 'ui' | 'viewer'

export type DriverView = {
  state: GestureState
  /** where to draw the cursor (viewport px, after the magnet snap), null when no hand */
  px: XY | null
  target: TargetKind
  /** 0..1 dwell before an air-tap is accepted */
  armed: number
  /** 0..1 dwell-to-click progress */
  dwell: number
  /** the control under the cursor needs a held pinch */
  confirm: boolean
  /** name of the 3D system a pick would select */
  organ: string | null
}

export type DriverHooks = {
  notify: (text: string) => void
  /** a slap was recognised; `moved` = a tab was switched */
  slap: (dir: 'left' | 'right', moved: boolean) => void
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

/** The page's tab strip for a slap: the record's section tabs when viewing one, else the main navigation. */
export function tabStrip(): HTMLAnchorElement[] | null {
  const navs = [...document.querySelectorAll('nav')]
  const sections = navs.find((n) => (n.getAttribute('aria-label') ?? '').startsWith('Sections for') && visible(n) && n.querySelector('[aria-current="page"]'))
  if (sections) return [...sections.querySelectorAll<HTMLAnchorElement>('a[href]')]
  // "Main" exists twice: the desktop bar (all destinations, hidden on phones) and the phone bottom bar (four
  // destinations + "More"). The one with the most links has every destination in order, including the ones
  // behind "More"; it does not need to be visible for its links to navigate.
  const mains = navs.filter((n) => n.getAttribute('aria-label') === 'Main')
  const best = mains.map((n) => [...n.querySelectorAll<HTMLAnchorElement>('a[href]')]).sort((a, b) => b.length - a.length)[0]
  return best?.length ? best : null
}

type Inertia = { viewer: ViewerHandle; vx: number; vy: number; last: number; raf: number }

export class HandDriver {
  readonly pipeline = new GesturePipeline()
  private hooks: DriverHooks
  private settings: HandSettings = DEFAULT_SETTINGS
  private hovered: HTMLElement | null = null
  private hoverSince = 0
  private snap: XY | null = null
  private hoverViewer: ViewerHandle | null = null
  private lastMove: XY | null = null
  private press: (Hit & { armed: boolean; confirm: boolean }) | null = null
  private drag: { kind: 'viewer' | 'scroll'; viewer: ViewerHandle | null; scroller: Element | null; vx: number; vy: number; t: number } | null = null
  private inertia: Inertia | null = null
  private zoomViewer: ViewerHandle | null = null
  private zoomY = 0
  private lastViewer: ViewerHandle | null = null
  private dwell = new Dwell<HTMLElement | string>({ ms: SPEEDS.normal.dwellMs })

  constructor(hooks: DriverHooks, settings?: HandSettings) {
    this.hooks = hooks
    if (settings) this.configure(settings)
  }

  configure(s: HandSettings) {
    this.settings = s
    this.pipeline.configure({ mirror: s.mirror, primaryHand: s.hand, region: SPEEDS[s.speed].region })
    this.dwell.o.ms = SPEEDS[s.speed].dwellMs
  }

  private px(p: XY): XY {
    return { x: p.x * window.innerWidth, y: p.y * window.innerHeight }
  }

  /**
   * What is under a viewport point: a 3D viewer canvas, an interactive element (magnet: the nearest one within a
   * radius that scales with the viewport, sticking to the current one), or nothing.
   */
  resolve(at: XY): Hit {
    const raw = document.elementFromPoint(at.x, at.y)
    const viewer = viewerAtElement(raw)
    if (viewer) return { raw, el: null, viewer, snap: null }
    const radius = magnetRadius(window.innerWidth, window.innerHeight)
    const found = new Set<HTMLElement>()
    const add = (el: HTMLElement | null) => {
      if (el && !found.has(el)) found.add(el)
    }
    add(interactive(raw))
    for (const r of [radius * 0.5, radius]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + (r === radius ? Math.PI / 8 : 0)
        add(interactive(document.elementFromPoint(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r)))
      }
    }
    if (this.hovered?.isConnected && !found.has(this.hovered)) {
      // the current target, if it is still reachable at this point (not covered by something else)
      const r = this.hovered.getBoundingClientRect()
      const probe = document.elementFromPoint(Math.min(Math.max(at.x, r.left + 2), r.right - 2), Math.min(Math.max(at.y, r.top + 2), r.bottom - 2))
      if (probe && this.hovered.contains(probe)) found.add(this.hovered)
    }
    const cands: Cand<HTMLElement>[] = []
    for (const el of found) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) cands.push({ key: el, rect: r })
    }
    const el = pickTarget(cands, at.x, at.y, this.hovered, { radius })
    const snap = el ? snapPoint(el.getBoundingClientRect(), at.x, at.y) : null
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
    this.snap = hit?.snap ?? null
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

  /** Slap towards the right of the screen = next tab, towards the left = previous tab. */
  private switchTab(dir: 'left' | 'right') {
    if (dialogOpen()) {
      this.hooks.slap(dir, false)
      return
    }
    const links = tabStrip()
    const cur = links ? links.findIndex((a) => a.getAttribute('aria-current') === 'page') : -1
    if (!links || cur < 0) {
      this.hooks.slap(dir, false)
      this.hooks.notify('No tabs to switch on this page')
      return
    }
    const next = links[cur + (dir === 'right' ? 1 : -1)]
    if (!next) {
      this.hooks.slap(dir, false)
      this.hooks.notify(dir === 'right' ? 'Already on the last tab' : 'Already on the first tab')
      return
    }
    next.click()
    this.hooks.slap(dir, true)
    this.hooks.notify(textOf(next))
  }

  private stopInertia() {
    if (this.inertia) cancelAnimationFrame(this.inertia.raf)
    this.inertia = null
  }

  /** a released rotation keeps turning and slows down, like a spun globe */
  private coast(viewer: ViewerHandle, vx: number, vy: number) {
    this.stopInertia()
    if (Math.hypot(vx, vy) < 0.05) return
    const it: Inertia = { viewer, vx, vy, last: performance.now(), raf: 0 }
    const step = (now: number) => {
      const dt = Math.min(50, now - it.last)
      it.last = now
      viewer.controls()?.rotateBy(it.vx * dt, it.vy * dt)
      const k = Math.exp(-dt / INERTIA_MS)
      it.vx *= k
      it.vy *= k
      if (Math.hypot(it.vx, it.vy) < 0.02) this.inertia = null
      else it.raf = requestAnimationFrame(step)
    }
    it.raf = requestAnimationFrame(step)
    this.inertia = it
  }

  private onEvent(e: GestureEvent) {
    switch (e.type) {
      case 'press': {
        this.stopInertia()
        const at = this.px(e)
        // the target locked while the fingers closed (the cursor was frozen on it), else what is under the point
        const hit: Hit = this.hovered?.isConnected ? { raw: this.hovered, el: this.hovered, viewer: null, snap: this.snap } : this.hoverViewer ? { raw: document.elementFromPoint(at.x, at.y), el: null, viewer: this.hoverViewer, snap: null } : this.resolve(at)
        const armed = !!hit.el && hit.el === this.hovered && performance.now() - this.hoverSince >= ARM_MS
        this.press = { ...hit, armed, confirm: !!hit.el && needsHold(hit.el) }
        this.dwell.consume()
        return
      }
      case 'tap': {
        const p = this.press
        if (!p) return
        const at = this.px(e)
        if (this.settings.click === 'dwell' && !p.viewer) return // pinch-click is off; held pinch still confirms
        if (p.viewer) {
          const id = p.viewer.controls()?.pickAt(at.x, at.y)
          if (id) sfx('select')
          return
        }
        if (!p.el) return
        if (p.confirm) {
          sfx('warn')
          this.hooks.notify('Hold the pinch to confirm')
        } else if (p.armed) {
          this.click(p.el, p.snap ?? at)
          sfx('tick')
        } else this.hooks.notify('Rest on a control, then pinch')
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
        this.drag = p?.viewer
          ? { kind: 'viewer', viewer: p.viewer, scroller: null, vx: 0, vy: 0, t: performance.now() }
          : { kind: 'scroll', viewer: null, scroller: scrollableFor(p?.raw ?? null), vx: 0, vy: 0, t: performance.now() }
        if (this.drag.kind === 'viewer') this.drag.viewer?.controls()?.hoverAt(null)
        return
      }
      case 'drag': {
        const d = this.drag
        if (!d) return
        const dx = e.dx * window.innerWidth
        const dy = e.dy * window.innerHeight
        if (d.kind === 'viewer') {
          const lim = (v: number) => Math.max(-ROT_MAX_STEP, Math.min(ROT_MAX_STEP, v * ROT_GAIN))
          const rx = lim(dx)
          const ry = lim(dy) * 0.7 // tilting is more disorienting than turning
          d.viewer?.controls()?.rotateBy(rx, ry)
          const now = performance.now()
          const dt = Math.max(16, now - d.t)
          d.t = now
          d.vx = d.vx * 0.5 + (rx / dt) * 0.5
          d.vy = d.vy * 0.5 + (ry / dt) * 0.5
        } else d.scroller?.scrollBy({ top: -dy * SCROLL_GAIN, behavior: 'instant' })
        return
      }
      case 'depth': {
        // single-hand push/pull over the viewer: hand closer to the camera = zoom in
        const v = this.press?.viewer
        if (!v || Math.abs(Math.log(e.factor)) < ZOOM_DEADBAND) return
        const f = Math.max(1 / ZOOM_MAX_STEP, Math.min(ZOOM_MAX_STEP, Math.pow(e.factor, -1.6)))
        v.controls()?.zoomBy(f, this.px(e).y)
        return
      }
      case 'dragend': {
        const d = this.drag
        this.drag = null
        // coast only if the hand was still moving when it let go
        if (d?.kind === 'viewer' && d.viewer && !e.cancelled && performance.now() - d.t < 120) this.coast(d.viewer, d.vx, d.vy)
        return
      }
      case 'release':
        this.press = null
        this.drag = null
        return
      case 'zoomstart': {
        this.stopInertia()
        const at = this.px(e)
        this.zoomViewer = this.resolve(at).viewer ?? this.hoverViewer
        this.zoomY = at.y
        if (this.zoomViewer) sfx('tick')
        return
      }
      case 'zoom': {
        if (Math.abs(Math.log(e.factor)) < ZOOM_DEADBAND) return
        const f = Math.max(1 / ZOOM_MAX_STEP, Math.min(ZOOM_MAX_STEP, 1 / e.factor))
        this.zoomViewer?.controls()?.zoomBy(f, this.zoomY)
        return
      }
      case 'zoomend':
        this.zoomViewer = null
        return
      case 'slap':
        this.switchTab(e.dir)
        return
      case 'fist': {
        if (dialogOpen()) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          sfx('close')
          this.hooks.notify('Closed')
          return
        }
        const v = this.resolve(this.px(e)).viewer ?? this.hoverViewer
        if (v) {
          this.stopInertia()
          v.controls()?.reset()
          sfx('close')
          this.hooks.notify('View reset')
        }
        return
      }
      case 'idle':
        this.setHover(null, null, performance.now())
        this.dwell.reset()
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
      if (DEV_HOOKS) {
        this.log.push({ t: Math.round(frame.t), type: e.type, info: e.type === 'slap' ? e.dir : e.type === 'tap' || e.type === 'press' ? `${Math.round(e.x * window.innerWidth)},${Math.round(e.y * window.innerHeight)}` : undefined })
        if (this.log.length > 60) this.log.shift()
      }
    }
    const now = performance.now()
    const at = state.cursor ? this.px(state.cursor) : null
    let view: DriverView = { state, px: at, target: 'none', armed: 0, dwell: 0, confirm: false, organ: null }
    if (!at || !state.present) {
      this.setHover(null, null, now)
      this.dwell.update(null, now, 0, 0, false)
      return view
    }
    if (state.mode === 'hover') {
      // while the cursor is frozen for a pinch, keep the target it was locked on
      const hit: Hit = state.frozen && (this.hovered || this.hoverViewer) ? { raw: this.hovered, el: this.hovered, viewer: this.hoverViewer, snap: this.snap } : this.resolve(at)
      this.setHover(hit, at, now)
      const confirm = !!hit.el && needsHold(hit.el)
      const organId = hit.viewer?.controls()?.hovered() ?? null
      const key = hit.el ?? (organId ? `viewer:${organId}` : null)
      const dwellOn = this.settings.click !== 'pinch' && !confirm && !state.frozen && state.pinch < 0.3
      if (this.dwell.update(key, now, at.x, at.y, dwellOn)) {
        if (hit.el) {
          this.click(hit.el, hit.snap ?? at)
          sfx('tick')
        } else if (hit.viewer && hit.viewer.controls()?.pickAt(at.x, at.y)) sfx('select')
      }
      view = {
        ...view,
        px: hit.snap ?? at,
        target: hit.viewer ? 'viewer' : hit.el ? 'ui' : 'none',
        armed: hit.el ? Math.min(1, (now - this.hoverSince) / ARM_MS) : 0,
        dwell: this.dwell.progress,
        confirm,
        organ: organId ? (SYSTEM_BY_ID[organId]?.name ?? null) : null,
      }
    } else {
      this.dwell.update(null, now, at.x, at.y, false)
      const p = this.press
      const target: TargetKind = this.drag?.kind === 'viewer' || state.mode === 'zoom' || p?.viewer ? 'viewer' : p?.el ? 'ui' : 'none'
      view = { ...view, px: state.mode === 'press' ? (p?.snap ?? at) : at, target, armed: p?.armed ? 1 : 0, confirm: !!p?.confirm }
    }
    return view
  }

  /** Drop every hover mark and viewer highlight (hand control switched off). */
  dispose() {
    this.stopInertia()
    this.setHover(null, null, performance.now())
    this.lastViewer?.controls()?.hoverAt(null)
    this.press = null
    this.drag = null
    this.dwell.reset()
    this.pipeline.reset()
  }
}
