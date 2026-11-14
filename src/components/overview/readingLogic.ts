// Overview: the alert → action mapping and the "after a save" comparison. Pure and deterministic,
// built only from the rule evaluation (lib/health), never from advice text.
import { STATUS_RANK, VITAL_BY_KEY, type Status, type VitalKey } from '../../data/vitals'
import type { Alert, Evaluation } from '../../lib/health'

/** Readings that are a daily log rather than a measurement to repeat. */
const DAILY: Partial<Record<VitalKey, string>> = { sleep: 'Log sleep', mood: 'Log mood', exercise: 'Log exercise', water: 'Log water' }

/** The vital an alert is about, or null (e.g. radiation). */
export function alertVitalKey(a: Pick<Alert, 'key'>): VitalKey | null {
  if (a.key === 'sleep-trend') return 'sleep'
  return Object.prototype.hasOwnProperty.call(VITAL_BY_KEY, a.key) ? (a.key as VitalKey) : null
}

export type AlertAction = { key: VitalKey; label: string }

/** The one entry form an alert leads to, if the person can log that vital in this profile. */
export function alertAction(a: Pick<Alert, 'key'>, loggable: readonly VitalKey[]): AlertAction | null {
  const key = alertVitalKey(a)
  if (!key || !loggable.includes(key)) return null
  return { key, label: DAILY[key] ?? (key === 'vision' ? 'Repeat check' : 'Re-measure') }
}

type EvalLike = Pick<Evaluation, 'alerts' | 'vitalStatus' | 'defByKey' | 'values'>

/** Worst alert level currently raised for one vital (its own alert or a trend alert about it). */
export function alertLevelFor(ev: Pick<Evaluation, 'alerts'> | null, key: VitalKey): Status | null {
  let lvl: Status | null = null
  for (const a of ev?.alerts ?? []) {
    if (alertVitalKey(a) !== key) continue
    if (!lvl || STATUS_RANK[a.level] > STATUS_RANK[lvl]) lvl = a.level
  }
  return lvl
}

export type SaveOutcome = { key: VitalKey; tone: Status; title: string; detail: string }

const LEVEL_WORDS: Record<Status, string> = { ok: 'normal', warn: 'needs attention', crit: 'urgent' }

/** What changed with one saved reading: new value against the previous one, and the alert before → after. */
export function describeSave(key: VitalKey, before: EvalLike | null, after: EvalLike): SaveOutcome | null {
  const def = after.defByKey[key]
  if (!def || !after.vitalStatus[key]) return null
  const unit = def.unit ? ` ${def.unit}` : ''
  const now = `${def.display(after.values)}${unit}`
  const hadReading = !!before?.vitalStatus[key]
  const prevDef = before?.defByKey[key]
  const prev = hadReading && prevDef ? `${prevDef.display(before!.values)}${unit}` : null

  const was = alertLevelFor(before, key)
  const is = alertLevelFor(after, key)
  let state: string
  if (was && !is) state = 'The alert has cleared.'
  else if (was && is && was === is) state = `Still ${LEVEL_WORDS[is]}. The alert stays on.`
  else if (was && is) state = `The alert is now ${is === 'crit' ? 'urgent' : 'at attention level'}.`
  else if (is) state = `New alert: ${LEVEL_WORDS[is]}.`
  else state = 'Rated normal. No alert.'

  return {
    key,
    tone: is ?? 'ok',
    title: `${def.label} saved: ${now}`,
    detail: `${prev ? `Before: ${prev}.` : 'First reading.'} ${state}`,
  }
}
