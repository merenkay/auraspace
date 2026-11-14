// Small shared registry between the 3D body viewers on the page and hand control, plus the "HUD on" state.
// Kept free of heavy imports: BodyViewer and the header toggle both load it; MediaPipe never comes through here.
import { useSyncExternalStore } from 'react'
import { onUi } from '../../lib/uiBus'
import type { ViewerControls } from '../three/Body3D'

export type ViewerHandle = {
  /** the viewer's outer element (the canvas is inside it) */
  el: HTMLElement
  controls: () => ViewerControls | null
}

const viewers = new Set<ViewerHandle>()

export function registerViewer(v: ViewerHandle): () => void {
  viewers.add(v)
  return () => {
    viewers.delete(v)
  }
}

/** The viewer whose 3D canvas is the element at this point (an overlay button over the canvas is not the viewer). */
export function viewerAtElement(el: Element | null): ViewerHandle | null {
  if (!el || el.tagName !== 'CANVAS') return null
  for (const v of viewers) if (v.el.contains(el) && v.controls()) return v
  return null
}

// ---- HUD state: which hands-free modes are on (hand, voice). Listening starts as soon as this module loads.
const hudSources = new Set<string>()
const listeners = new Set<() => void>()
let hudSnapshot = false
let handSnapshot = false

onUi('hud', ({ on, source }) => {
  if (on) hudSources.add(source)
  else hudSources.delete(source)
  const next = hudSources.size > 0
  const hand = hudSources.has('hand')
  if (next === hudSnapshot && hand === handSnapshot) return
  hudSnapshot = next
  handSnapshot = hand
  for (const l of listeners) l()
})

export function hudActive(): boolean {
  return hudSnapshot
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** True while any hands-free mode (hand or voice) is on: overlays may switch to their HUD look. */
export function useHud(): boolean {
  return useSyncExternalStore(subscribe, hudActive, () => false)
}

/** True while camera hand control is on: the 3D viewer lowers its load (pixel ratio, frame rate, no auto-spin). */
export function useHandMode(): boolean {
  return useSyncExternalStore(subscribe, () => handSnapshot, () => false)
}
