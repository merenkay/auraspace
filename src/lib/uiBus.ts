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
  /**
   * Open, close or toggle the AURA voice panel. `listen`: also start listening (when opening, or when it is
   * already open). A request from a hand gesture has no user activation, so the browser may refuse the
   * microphone: the panel then opens and asks for a tap or the wake word instead.
   */
  'voice': { action: 'open' | 'close' | 'toggle'; listen?: boolean; source: 'hand' | 'key' | 'page' }
  /** The voice panel opened or closed (state, for features that react to it, e.g. the hand "join" gesture). */
  'voice-state': { open: boolean }
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
