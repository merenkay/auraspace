// Storm drill: a clearly labelled SIMULATED radiation storm (S3) so a demo can show the alert without a real event.
// It changes only what the space-weather panel displays — never the dose model, stored data or anything sent anywhere.
//
// Demo tour / console:
//   window.dispatchEvent(new CustomEvent('aura:spaceweather-drill', { detail: { on: true } }))
//   window.dispatchEvent(new CustomEvent('aura:spaceweather-drill', { detail: { on: false } }))
//   (no detail = toggle)
export const DRILL_EVENT = 'aura:spaceweather-drill'

let on = false
const listeners = new Set<(on: boolean) => void>()

export function isDrill(): boolean {
  return on
}

export function setDrill(next: boolean): void {
  if (next === on) return
  on = next
  for (const l of listeners) l(on)
}

export function subscribeDrill(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reads `{ detail: { on } }`; anything else toggles. */
export function handleDrillEvent(e: Event): void {
  const d = (e as CustomEvent<unknown>).detail
  const v = d && typeof d === 'object' && 'on' in d ? (d as { on: unknown }).on : undefined
  setDrill(typeof v === 'boolean' ? v : !on)
}

let installed = false
/** Listens for the window event once per page (called by the hook; safe to call repeatedly). */
export function installDrillListener(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener(DRILL_EVENT, handleDrillEvent)
}

// Listen as soon as this module is loaded (the Environment page imports it), so an early demo-tour event is not lost.
installDrillListener()
