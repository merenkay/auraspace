// The AURA condition knowledge base: scoring definitions (catalog.ts) joined with sourced evidence
// (evidence.json: plain-language text + verbatim quote + source for every statement).
import evidence from './evidence.json'
import { CONDITION_DEFS } from './catalog'
import type { Condition, ConditionEvidence, SourceInfo } from './types'

export * from './types'

const EV = evidence as unknown as { sources: Record<string, SourceInfo>; conditions: Record<string, ConditionEvidence> }

export const SOURCES: Record<string, SourceInfo> = EV.sources

export const CONDITIONS: Condition[] = CONDITION_DEFS.map((d) => ({ ...d, ev: EV.conditions[d.id] ?? {} }))

export const CONDITION_BY_ID: Record<string, Condition> = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]))

export function sourceOf(id: string): SourceInfo {
  return SOURCES[id] ?? { org: 'Source', title: id, url: '' }
}
