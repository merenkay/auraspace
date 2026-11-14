// Tiny typed event bus for cross-feature UI commands (voice, hand control, pages).
// Features talk through these events instead of importing each other's components.
import type { SystemId } from '../data/systems'

export type UiEvents = {
  /** Ask the current page to select a body system (null = whole body). Overview and Diagnostics listen. */
  'select-system': { system: SystemId | null; source: 'voice' | 'hand' | 'page' }
  /** A hands-free mode switched on or off; pages may show HUD styling while any source is on. */
  'hud': { on: boolean; source: 'voice' | 'hand' }
  /** Ask AURA to say something aloud (ignored when voice output is off). */
  'say': { text: string; priority?: 'normal' | 'urgent' }
}

const target = new EventTarget()

export function emitUi<K extends keyof UiEvents>(type: K, detail: UiEvents[K]) {
  target.dispatchEvent(new CustomEvent(type, { detail }))
}

/** Subscribe; returns the unsubscribe function (use it as a useEffect cleanup). */
export function onUi<K extends keyof UiEvents>(type: K, handler: (detail: UiEvents[K]) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<UiEvents[K]>).detail)
  target.addEventListener(type, fn)
  return () => target.removeEventListener(type, fn)
}
