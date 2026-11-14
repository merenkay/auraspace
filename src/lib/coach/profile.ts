// Training profile: defaults per context, allow-list cleaning (mirrored in public/api/routes/coach.php) and date helpers.
import { CONTEXT_DEFAULTS, DAY_OPTIONS, EQUIPMENT, FOCUS_IDS, LEVELS, LIMITS, MAX_FOCUS, MINUTE_OPTIONS } from '../../data/coach/catalog'
import { contextOf, type Context } from '../../data/contexts'
import type { EquipmentId, FocusId, FocusSuggestion, LimitId, TrainingProfile } from './types'

const DAY = 86400000

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}
/** Whole days from a to b (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY)
export function addDays(iso: string, n: number): string {
  const t = new Date(parse(iso) + n * DAY)
  return t.toISOString().slice(0, 10)
}
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (iso: string) => (new Date(parse(iso)).getUTCDay() + 6) % 7
export const mondayOf = (iso: string) => addDays(iso, -weekdayOf(iso))
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Focus areas the person would start with: the strongest suggestions, or general fitness. */
export function defaultFocus(suggestions: FocusSuggestion[]): FocusId[] {
  const strong = suggestions.filter((s) => s.score >= 2).map((s) => s.id)
  return strong.length ? strong.slice(0, MAX_FOCUS) : ['fitness']
}

export function defaultTrainingProfile(context: Context, suggestions: FocusSuggestion[], today: string): TrainingProfile {
  const d = CONTEXT_DEFAULTS[context]
  return { focus: defaultFocus(suggestions), confirmed: false, level: d.level, daysPerWeek: d.daysPerWeek, minutes: d.minutes, equipment: [...d.equipment], limits: [], startedAt: mondayOf(today), updatedAt: null, context }
}

const pickList = <T extends string>(list: unknown, allowed: readonly T[], max: number): T[] =>
  Array.isArray(list) ? [...new Set(list.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))].slice(0, max) : []

/** Keeps only known values; used for storage reads and before saving. */
export function cleanTrainingProfile(raw: unknown, fallbackContext: Context, today: string): TrainingProfile {
  const o = (raw ?? {}) as Partial<TrainingProfile>
  const context = o.context ? contextOf(o.context) : fallbackContext
  const d = CONTEXT_DEFAULTS[context]
  const equipmentIds = EQUIPMENT.filter((e) => e.contexts.includes(context)).map((e) => e.id) as EquipmentId[]
  const focus = pickList<FocusId>(o.focus, FOCUS_IDS, MAX_FOCUS)
  return {
    focus: focus.length ? focus : ['fitness'],
    confirmed: o.confirmed === true,
    level: LEVELS.some((l) => l.id === o.level) ? o.level! : d.level,
    daysPerWeek: DAY_OPTIONS.includes(Number(o.daysPerWeek)) ? Number(o.daysPerWeek) : d.daysPerWeek,
    minutes: MINUTE_OPTIONS.includes(Number(o.minutes)) ? Number(o.minutes) : d.minutes,
    equipment: Array.isArray(o.equipment) ? pickList<EquipmentId>(o.equipment, equipmentIds, 12) : [...d.equipment],
    limits: pickList<LimitId>(o.limits, LIMITS.map((l) => l.id), 8),
    startedAt: typeof o.startedAt === 'string' && DATE_RE.test(o.startedAt) ? o.startedAt : mondayOf(today),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    context,
  }
}
