// Hand-over between a voice command and a page that is about to mount (e.g. "show the heart" while on History).
import type { SystemId } from '../../data/systems'

let pendingSystem: SystemId | null | undefined

export function setPendingSystem(s: SystemId | null) {
  pendingSystem = s
}

/** Returns the system the person asked for before this page existed, once. `undefined` = nothing pending. */
export function takePendingSystem(): SystemId | null | undefined {
  const s = pendingSystem
  pendingSystem = undefined
  return s
}

/** Pages listen for this window event and reload their data after a value was logged by voice. */
export const DATA_CHANGED = 'aura:data-changed'
export const announceDataChanged = () => window.dispatchEvent(new Event(DATA_CHANGED))
