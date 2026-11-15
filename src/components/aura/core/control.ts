// A tiny imperative door to the AURA core for other features (voice commands such as "go deeper" / "go back",
// the page's own evaluation). Module scope only: nothing on `window`. Calls are no-ops while no core is on screen.
import type { Evaluation } from '../../../lib/health'
import { LAYERS, type LayerId } from './layers'

export type CoreControl = { dive: (delta: 1 | -1) => boolean; goTo: (layer: number) => void; layer: () => number }

let current: CoreControl | null = null

/** The mounted core registers itself (AuraCore only). Returns the unregister function. */
export function registerCore(c: CoreControl): () => void {
  current = c
  return () => {
    if (current === c) current = null
  }
}

/** One layer deeper (+1) or back out (-1). False when there is no core or it is already at the end. */
export function coreDive(delta: 1 | -1): boolean {
  return current?.dive(delta) ?? false
}

/** Go straight to a layer. False when there is no core on screen. */
export function coreGoTo(layer: LayerId): boolean {
  const i = LAYERS.findIndex((l) => l.id === layer)
  if (!current || i < 0) return false
  current.goTo(i)
  return true
}

/** The layer in focus, or null when no core is on screen. */
export function coreLayer(): LayerId | null {
  return current ? LAYERS[current.layer()].id : null
}

// ---- the evaluation the layers draw: published by the page that already loaded it (no second fetch) ----
type Published = { crewId: number; ev: Evaluation | null }
let published: Published | null = null
const listeners = new Set<() => void>()

export function publishCoreEvaluation(crewId: number, ev: Evaluation | null) {
  if (published && published.crewId === crewId && published.ev === ev) return
  published = { crewId, ev }
  for (const fn of [...listeners]) fn()
}

export function clearCoreEvaluation(crewId: number) {
  if (published?.crewId !== crewId) return
  published = null
  for (const fn of [...listeners]) fn()
}

export const subscribeCoreEvaluation = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getCoreEvaluation = () => published
