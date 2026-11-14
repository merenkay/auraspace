// Jury demo mode: finding and operating elements of the live app (browser only).
// The tour drives the real pages the way a person would: it clicks buttons and types into fields.
import type { Target, TargetSpec } from './types'

/** Everything the tour itself draws lives under an element with this attribute, and is never a target. */
export const UI_ATTR = 'data-demo-ui'

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Laid out and not part of the tour's own interface. */
export function isUsable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false
  if (el.closest(`[${UI_ATTR}]`)) return false
  return el.getClientRects().length > 0
}

function resolveOne(spec: TargetSpec, root: ParentNode): HTMLElement | null {
  const s = typeof spec === 'string' ? { css: spec } : spec
  let list: Element[]
  try {
    list = Array.from(root.querySelectorAll(s.css))
  } catch {
    return null
  }
  let hits = list.filter(isUsable)
  if (s.text != null) {
    const want = norm(s.text)
    hits = hits.filter((el) => (s.exact ? norm(el.textContent) === want : norm(el.textContent).includes(want)))
    // Several nested elements can contain the text: the one with the least other text is the most specific.
    hits.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))
  }
  const el = hits[0]
  if (!el) return null
  if (!s.closest) return el
  const up = el.closest(s.closest)
  return up && isUsable(up) ? up : null
}

/** The element a target points at right now, or null. */
export function resolveTarget(target: Target, root: ParentNode = document): HTMLElement | null {
  for (const spec of Array.isArray(target) ? target : [target]) {
    const el = resolveOne(spec, root)
    if (el) return el
  }
  return null
}

/** Whether a toggle is on: aria-pressed, aria-expanded, aria-checked, a checkbox, or <details open>. */
export function toggleState(el: HTMLElement): boolean | null {
  for (const attr of ['aria-pressed', 'aria-expanded', 'aria-checked']) {
    const v = el.getAttribute(attr)
    if (v === 'true') return true
    if (v === 'false') return false
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked
  const details = el.closest('details')
  if (details) return details.open
  return null
}

/** Sets the value of a React-controlled input or textarea so that React sees the change. */
export function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export type Box = { x: number; y: number; w: number; h: number }

export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * Brings an element into the part of the window that the tour's caption bar does not cover.
 * `bottomInset` is the height of that bar. Tall elements are aligned to the top (below the sticky header).
 */
export function bringIntoView(el: HTMLElement, bottomInset: number, smooth: boolean) {
  const top = 72
  const room = window.innerHeight - bottomInset - top - 16
  const r = el.getBoundingClientRect()
  if (r.top >= top && r.bottom <= window.innerHeight - bottomInset - 16) return
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto'
  // Inside a sheet or dialog the window does not scroll: let the browser pick the right scroll container.
  if (el.closest('[data-overlay]')) {
    el.scrollIntoView({ block: r.height > room ? 'start' : 'center', behavior })
    return
  }
  const delta = r.height > room ? r.top - top : r.top + r.height / 2 - (top + room / 2)
  window.scrollBy({ top: delta, behavior })
}
