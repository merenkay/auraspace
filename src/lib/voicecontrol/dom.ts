// The real page for voice control: adapts DOM elements to the UiNode interface (scan.ts) and carries out the
// effects (scroll into view, occlusion check, highlight, click, React-safe typing, numbered badges). Clicks are
// dispatched like the hand-control driver does (pointer and mouse events, then click()).
import type { Effects } from './controller'
import type { ScrollDir } from './grammar'
import type { Box, Control, UiNode } from './scan'

const SKIP = new Set(['script', 'style', 'svg', 'canvas', 'template', 'noscript', 'iframe', 'video', 'audio'])

class DomNode implements UiNode {
  readonly ref: Element
  constructor(el: Element) {
    this.ref = el
  }
  get tag() {
    return this.ref.tagName.toLowerCase()
  }
  attr(name: string) {
    return this.ref.getAttribute(name)
  }
  children(): UiNode[] {
    if (SKIP.has(this.tag)) return []
    return Array.from(this.ref.children, (c) => new DomNode(c))
  }
  parent(): UiNode | null {
    return this.ref.parentElement ? new DomNode(this.ref.parentElement) : null
  }
  text() {
    // rendered text keeps the spaces between blocks ("Blood pressure / mmHg"), textContent runs them together
    const it = (this.ref as HTMLElement).innerText
    return typeof it === 'string' ? it : (this.ref.textContent ?? '')
  }
  rect(): Box {
    const r = this.ref.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  style() {
    const s = getComputedStyle(this.ref)
    return { display: s.display, visibility: s.visibility }
  }
  prop(name: 'disabled' | 'inert' | 'checked' | 'value' | 'type') {
    return (this.ref as unknown as Record<string, unknown>)[name]
  }
  byId(id: string): UiNode | null {
    const el = document.getElementById(id)
    return el ? new DomNode(el) : null
  }
  labels(): UiNode[] {
    const l = (this.ref as HTMLInputElement).labels
    return l ? Array.from(l, (x) => new DomNode(x)) : []
  }
}

const el = (c: Control) => c.node.ref as HTMLElement

/* ---------- the overlay layer: highlight ring and numbered badges ---------- */

let layer: HTMLDivElement | null = null
function getLayer(): HTMLDivElement {
  if (layer?.isConnected) return layer
  if (!document.getElementById('vc-style')) {
    const st = document.createElement('style')
    st.id = 'vc-style'
    st.textContent = `
[data-vc-layer]{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
.vc-ring{position:fixed;border:2px solid var(--color-accent,#7dd3fc);border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb,var(--color-accent,#7dd3fc) 30%,transparent),0 0 24px var(--color-accent,#7dd3fc);animation:vc-ring 1.4s ease-out forwards}
.vc-ring[data-warn]{border-color:var(--color-warn,#fbbf24);box-shadow:0 0 0 4px color-mix(in srgb,var(--color-warn,#fbbf24) 30%,transparent);animation:vc-hold 1.2s ease-in-out infinite alternate}
@keyframes vc-ring{0%{opacity:0;transform:scale(1.15)}15%{opacity:1;transform:scale(1)}70%{opacity:1}100%{opacity:0}}
@keyframes vc-hold{from{opacity:.55}to{opacity:1}}
.vc-badge{position:fixed;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--color-accent,#7dd3fc);color:var(--color-space,#05070b);font:600 12px/22px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;box-shadow:0 2px 8px rgb(0 0 0/.5),0 0 0 2px var(--color-space,#05070b)}
@media (prefers-reduced-motion: reduce){.vc-ring{animation:none}.vc-ring[data-warn]{animation:none}}`
    document.head.appendChild(st)
  }
  layer = document.createElement('div')
  layer.setAttribute('data-vc-layer', '')
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)
  return layer
}

let ringTimer: ReturnType<typeof setTimeout> | undefined
let ringRaf = 0
function ring(target: HTMLElement, warn = false) {
  const L = getLayer()
  L.querySelectorAll('.vc-ring').forEach((x) => x.remove())
  const d = document.createElement('div')
  d.className = 'vc-ring'
  if (warn) d.setAttribute('data-warn', '')
  const place = () => {
    const r = target.getBoundingClientRect()
    Object.assign(d.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`, display: target.isConnected && r.width ? '' : 'none' })
  }
  place()
  L.appendChild(d)
  // the ring stays on the element's current position (smooth scrolling, sheets sliding in, layout shifts)
  cancelAnimationFrame(ringRaf)
  const until = performance.now() + (warn ? 20000 : 1500)
  const follow = () => {
    if (!d.isConnected || performance.now() > until) return
    place()
    ringRaf = requestAnimationFrame(follow)
  }
  ringRaf = requestAnimationFrame(follow)
  clearTimeout(ringTimer)
  ringTimer = setTimeout(() => d.remove(), warn ? 20000 : 1500)
}

let badgeItems: { target: HTMLElement; node: HTMLDivElement }[] = []
let badgeRaf = 0
function placeBadges() {
  badgeRaf = 0
  for (const b of badgeItems) {
    const r = b.target.getBoundingClientRect()
    const off = !b.target.isConnected || r.width === 0
    b.node.style.display = off ? 'none' : ''
    b.node.style.left = `${Math.min(innerWidth - 26, Math.max(2, r.left - 8))}px`
    b.node.style.top = `${Math.min(innerHeight - 24, Math.max(2, r.top - 8))}px`
  }
}
/** Follow a dialog or sheet that is still animating in, for a moment. */
function followBadges(ms: number) {
  const until = performance.now() + ms
  const tick = () => {
    if (!badgeItems.length || performance.now() > until) return
    placeBadges()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
const schedule = () => {
  if (!badgeRaf) badgeRaf = requestAnimationFrame(placeBadges)
}

/* ---------- page helpers ---------- */

function inPanel(n: Element | null) {
  return !!n?.closest('.vx-hud, [data-voice-panel], [data-vc-layer]')
}

/** Top-most element at a point, looking through our own highlight layer only (the voice panel does cover things). */
function hitAt(x: number, y: number): Element | null {
  const all = document.elementsFromPoint(x, y)
  return all.find((e) => !e.closest('[data-vc-layer]')) ?? null
}

function covered(t: HTMLElement): boolean {
  const r = t.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return true
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
  const hit = hitAt(x, y)
  if (!hit) return false
  if (t.contains(hit) || hit.contains(t)) return false
  // our own voice panel may sit over it; the press goes to the element itself, so that is not "covered"
  if (inPanel(hit)) return false
  // a styled checkbox or radio: the visible box sits in the same <label>
  const lab = t.closest('label')
  if (lab && lab.contains(hit)) return false
  return true
}

function fire(t: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, ...extra }
  t.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { pointerId: 7332, pointerType: 'mouse', isPrimary: false, ...init }) : new MouseEvent(type, init))
}

function modalEl(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].filter((d) => d.getBoundingClientRect().height > 0)
  return all[all.length - 1] ?? null
}

function scrollerFor(): Element | null {
  const m = modalEl()
  const pool = m ? [m, ...m.querySelectorAll('*')] : [document.scrollingElement, document.querySelector('main'), ...document.querySelectorAll('main *')]
  let best: Element | null = null
  for (const e of pool) {
    if (!e) continue
    const s = getComputedStyle(e)
    const scrollable = e === document.scrollingElement || /(auto|scroll)/.test(s.overflowY)
    if (scrollable && e.scrollHeight > e.clientHeight + 4 && (!best || e.clientHeight > best.clientHeight)) best = e
  }
  return best
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Scroll without the page's smooth scrolling (index.css), so the position can be checked right after. */
const INSTANT = 'instant' as ScrollBehavior

/** Bring an element into view inside every scroll container (sheets, dialogs, main), clear of sticky bars. */
function reveal(t: HTMLElement) {
  t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: INSTANT })
  if (!covered(t)) return
  t.scrollIntoView({ block: 'center', inline: 'nearest', behavior: INSTANT })
  if (!covered(t)) return
  // a sticky header or the bottom tab bar still on top: nudge the element towards the upper middle
  const r = t.getBoundingClientRect()
  const s = scrollParent(t)
  if (s) s.scrollBy({ top: r.top - innerHeight * 0.38, behavior: INSTANT })
}

function scrollParent(t: Element): Element | null {
  for (let x = t.parentElement; x; x = x.parentElement) {
    const o = getComputedStyle(x).overflowY
    if (/(auto|scroll)/.test(o) && x.scrollHeight > x.clientHeight + 4) return x
  }
  return document.scrollingElement
}

/* ---------- effects ---------- */

export const domEffects: Effects = {
  root: () => new DomNode(document.body),
  viewport: () => ({ w: innerWidth, h: innerHeight }),
  press(c) {
    const t = el(c)
    if (!t.isConnected) return 'gone'
    reveal(t)
    if (covered(t)) return 'covered'
    ring(t)
    const r = t.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    fire(t, 'pointerdown', x, y, { button: 0, buttons: 1 })
    fire(t, 'mousedown', x, y, { button: 0, buttons: 1 })
    if (t.matches('a[href], button, input, select, textarea, summary, [tabindex]')) t.focus({ preventScroll: true })
    fire(t, 'pointerup', x, y, { button: 0, buttons: 0 })
    fire(t, 'mouseup', x, y, { button: 0, buttons: 0 })
    t.click()
    return 'ok'
  },
  focus(c) {
    const t = el(c)
    if (!t.isConnected) return false
    reveal(t)
    t.focus({ preventScroll: true })
    ring(t)
    return true
  },
  setValue(c, value) {
    const t = el(c)
    if (t instanceof HTMLSelectElement) {
      const want = value.toLowerCase().trim()
      const opt = [...t.options].find((o) => o.text.toLowerCase().trim() === want) ?? [...t.options].find((o) => o.text.toLowerCase().includes(want))
      if (!opt) return false
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      set ? set.call(t, opt.value) : (t.value = opt.value)
    } else if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
      const proto = t instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      set ? set.call(t, value) : (t.value = value)
    } else return false
    t.dispatchEvent(new Event('input', { bubbles: true }))
    t.dispatchEvent(new Event('change', { bubbles: true }))
    ring(t)
    return true
  },
  value(c) {
    const t = el(c) as HTMLInputElement
    return typeof t.value === 'string' ? t.value : ''
  },
  focusedNode() {
    const a = document.activeElement
    if (!a || inPanel(a) || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return null
    return new DomNode(a)
  },
  formOf(n) {
    const f = (n.ref as Element).closest('form')
    return f ? new DomNode(f) : null
  },
  scroll(dir, amount) {
    const s = scrollerFor()
    if (!s) return false
    const before = s.scrollTop
    const behavior: ScrollBehavior = reduced() ? INSTANT : 'smooth'
    const k = amount === 'little' ? 0.25 : amount === 'lot' ? 1.6 : amount === 'page' ? 0.9 : 0.7
    const page = Math.round(s.clientHeight * k)
    if (dir === 'top') s.scrollTo({ top: 0, behavior })
    else if (dir === 'bottom') s.scrollTo({ top: s.scrollHeight, behavior })
    else if (dir === 'middle') {
      if (s.scrollHeight <= s.clientHeight + 4) return false
      s.scrollTo({ top: (s.scrollHeight - s.clientHeight) / 2, behavior })
      return true
    } else s.scrollBy({ top: dir === 'down' ? page : -page, behavior })
    const atEnd = dir === 'down' || dir === 'bottom' ? before + s.clientHeight >= s.scrollHeight - 2 : before <= 0
    return !atEnd
  },
  forward() {
    history.forward()
  },
  settle(ms = 200) {
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms))))
  },
  options(c) {
    const t = el(c)
    return t instanceof HTMLSelectElement ? [...t.options].map((o) => o.text.trim()).filter(Boolean) : []
  },
  sectionText(n) {
    const h = n.ref as HTMLElement
    const own = (h.innerText ?? '').trim()
    // the smallest ancestor that holds more than the heading itself
    let box: HTMLElement | null = h.parentElement
    for (let i = 0; box && i < 3 && (box.innerText ?? '').trim().length <= own.length + 20; i++) box = box.parentElement
    if (!box) return ''
    return (box.innerText ?? '').replace(own, '').replace(/\s+/g, ' ').trim().slice(0, 600)
  },
  scrollTo(n) {
    const t = n.ref as HTMLElement
    t.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' })
    setTimeout(() => ring(t), reduced() ? 0 : 350)
  },
  back() {
    history.back()
  },
  closeOverlay() {
    const m = modalEl()
    if (m) {
      const btn = m.querySelector<HTMLElement>('[data-overlay-part="close"]') ?? [...m.querySelectorAll<HTMLElement>('button')].find((b) => /^(close|cancel)\b/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()))
      if (btn) btn.click()
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      return true
    }
    const menu = document.querySelector('[role="menu"], [role="listbox"]')
    if (menu && menu.getBoundingClientRect().height > 0) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      return true
    }
    return false
  },
  showBadges(items) {
    const L = getLayer()
    L.querySelectorAll('.vc-badge').forEach((x) => x.remove())
    badgeItems = items.map(({ c, n }) => {
      const node = document.createElement('div')
      node.className = 'vc-badge'
      node.textContent = String(n)
      L.appendChild(node)
      return { target: el(c), node }
    })
    placeBadges()
    followBadges(900)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
  },
  hideBadges() {
    layer?.querySelectorAll('.vc-badge').forEach((x) => x.remove())
    badgeItems = []
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
  },
  highlight(c) {
    ring(el(c), c.risk !== 'none')
  },
  visible(c) {
    return !covered(el(c))
  },
  unhighlight() {
    layer?.querySelectorAll('.vc-ring').forEach((x) => x.remove())
  },
}

/** Remove the confirmation ring (after yes / no). */
export function clearHighlight() {
  layer?.querySelectorAll('.vc-ring').forEach((x) => x.remove())
}
