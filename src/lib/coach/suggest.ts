// Suggests focus areas from data AURA already has, and says why. The person confirms or changes them.
// Deterministic: the same inputs give the same list in the same order.
import { FOCUS_IDS } from '../../data/coach/catalog'
import type { HealthProfile } from '../../data/conditions/profile'
import { vitalFor, type Context } from '../../data/contexts'
import type { SavedAssessment } from '../clinic'
import { seriesOf, type Evaluation } from '../health'
import type { Measurement } from '../types'
import type { FieldId } from '../../data/vitals'
import type { CoachRuleId } from '../../data/coach/sources'
import type { FocusId, FocusSuggestion, LimitId } from './types'

export type SuggestInput = {
  context: Context
  ev: Evaluation | null
  rows: Measurement[]
  profile: HealthProfile | null
  latest: SavedAssessment | null
  /** Today's tracking day (mission day in space). */
  day: number
  limits?: LimitId[]
  now?: number
}

export type SuggestReason = { text: string; ruleId?: CoachRuleId }
export type FocusSuggestionFull = FocusSuggestion & { why: SuggestReason[] }

const ASSESSMENT_FOCUS: Record<string, [FocusId, number][]> = {
  'space-back-pain': [['back', 3]],
  'fall-fracture': [['balance', 3], ['bone', 2]],
  'seasonal-low-mood': [['mood', 2]],
  'behavioural-health': [['mood', 2]],
  'panic-attack': [['mood', 2]],
  'sleep-loss': [['sleep', 2]],
  'hypertensive-crisis': [['bp', 3]],
  'hypoglycaemia': [['glucose', 2]],
}

const avg = (xs: { value: number }[]) => (xs.length ? xs.reduce((s, p) => s + p.value, 0) / xs.length : null)

export function suggestFocus({ context, ev, rows, profile, latest, day, limits = [], now = Date.now() }: SuggestInput): FocusSuggestionFull[] {
  const score = new Map<FocusId, number>()
  const why = new Map<FocusId, SuggestReason[]>()
  const add = (id: FocusId, s: number, text: string, ruleId?: CoachRuleId) => {
    score.set(id, (score.get(id) ?? 0) + s)
    const list = why.get(id) ?? []
    if (!list.some((r) => r.text === text)) list.push({ text, ruleId })
    why.set(id, list)
  }
  const has = (k: 'conditions' | 'medicines', id: string) => !!profile?.[k].includes(id)
  const series = (f: FieldId, days: number) => seriesOf(rows, f, days, day)

  // Microgravity: muscle and bone loss are always relevant and grow with time in flight.
  if (context === 'space') {
    const months = Math.max(0, day) / 30.4
    const extra = day > 90 ? 2 : day > 30 ? 1 : 0
    add('muscle', 3 + extra, `Day ${day} in flight (about ${months.toFixed(1)} months): without gravity, muscle becomes smaller and weaker.`, 'spaceAtrophy')
    add('bone', 3 + extra, `NASA estimates bone loss of 1–1.5% per month in flight; you are about ${months.toFixed(1)} months in.`, 'spaceBoneLoss')
  }

  // Health profile.
  if (has('conditions', 'osteoporosis')) add('bone', 3, 'Your health profile lists osteoporosis.')
  if (has('conditions', 'falls-history')) {
    add('balance', 3, 'Your health profile lists a fall in the last year.', 'fallsDose')
    add('bone', 1, 'A past fall makes bone strength more important.')
  }
  const age = profile?.ageBand
  if (age === '65-79' || age === '80+') {
    add('muscle', 2, `Age ${age === '80+' ? '80 or over' : '65–79'}: muscle mass and strength fall with age.`, 'sarcopeniaAge')
    add('balance', age === '80+' ? 2 : 1, 'Strength and balance work lowers the risk of falls in later life.', 'olderWeekly')
  }
  if (has('conditions', 'hypertension') || has('medicines', 'blood-pressure')) add('bp', 3, 'Your health profile lists high blood pressure or blood-pressure medicine.', 'htnLowers')
  if (has('conditions', 'diabetes') || has('medicines', 'insulin') || has('medicines', 'diabetes-tablets')) add('glucose', 3, 'Your health profile lists diabetes or diabetes medicine.', 'dmBoth')
  if (has('conditions', 'depression') || has('conditions', 'panic-disorder')) add('mood', 2, 'Your health profile lists depression or anxiety.', 'moodGroup')

  // Movement limitations the person entered.
  if (limits.includes('knee') || limits.includes('hip')) add('joints', 2, 'You marked knee or hip problems.', 'oaExercise')
  if (limits.includes('back')) add('back', 2, 'You marked back problems.', 'backGroup')

  // Current readings and their trends.
  if (ev?.meta.sys) {
    const sys = series('sys', 14)
    const dia = series('dia', 14)
    const s = avg(sys)
    const d = avg(dia)
    if (ev.vitalStatus.bp && ev.vitalStatus.bp !== 'ok') add('bp', 3, `Latest blood pressure ${Math.round(ev.values.sys)}/${Math.round(ev.values.dia)} mmHg is above range.`, 'htnLowers')
    else if (s != null && d != null && sys.length >= 3 && (s >= 130 || d >= 80)) add('bp', 2, `Your 14-day average blood pressure is ${Math.round(s)}/${Math.round(d)} mmHg.`, 'htnLowers')
  }
  if (ev?.meta.glucose && ev.vitalStatus.glucose && ev.vitalStatus.glucose !== 'ok') add('glucose', 2, `Latest glucose ${Math.round(ev.values.glucose)} mg/dL is outside range.`, 'dmBoth')
  const mood = series('mood', 7)
  const moodAvg = avg(mood)
  if (ev && moodAvg != null && vitalFor('mood', context).evaluate({ ...ev.values, mood: moodAvg }) !== 'ok') add('mood', 2, `Your mood over the last 7 days averaged ${moodAvg.toFixed(1)} of 5.`, 'moodAny')
  const sleep = series('sleep', 7)
  const sleepAvg = avg(sleep)
  if (sleepAvg != null && sleepAvg < 7) add('sleep', sleepAvg < 6 ? 3 : 2, `You averaged ${sleepAvg.toFixed(1)} h of sleep over the last 7 nights.`, 'sleepDaytime')
  const target = context === 'space' ? 90 : 21
  const ex7 = avg(series('exercise', 7))
  if (ex7 != null && ex7 < target) add('fitness', 2, `You averaged ${Math.round(ex7)} min of exercise a day over the last week (target about ${target}).`, context === 'space' ? 'spaceSchedule' : 'adultsWeekly')
  const ex30 = series('exercise', 30)
  const ex30Avg = avg(ex30)
  if (ex30Avg != null && ex30.length >= 7 && ex30Avg < target / 2) add('muscle', 1, `Little exercise over the last 30 days (about ${Math.round(ex30Avg)} min a day): unused muscles weaken.`, 'muscleDisuse')

  // Latest saved assessment.
  if (latest) {
    for (const [id, s] of ASSESSMENT_FOCUS[latest.conditionId ?? ''] ?? []) add(id, s, `Your last AURA assessment was about ${latest.conditionName.replace(/^Possible /, '').toLowerCase()}.`)
    const ageDays = (now - new Date(latest.createdAt).getTime()) / 86400000
    if ((latest.urgency === 'urgent' || latest.urgency === 'emergency') && ageDays > 7 && ageDays <= 90) add('muscle', 2, 'You are recovering from a recent illness: bed rest quickly costs leg strength.', 'bedRest')
  }

  // Everyone benefits from general fitness; it is the fallback when nothing else applies.
  add('fitness', 1, context === 'space' ? 'Aerobic fitness is part of every flight programme.' : 'Everyone benefits from regular aerobic and strength activity.', context === 'space' ? 'spaceAerobic' : 'adultsWeekly')

  const order = (id: FocusId) => FOCUS_IDS.indexOf(id)
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s, reasons: (why.get(id) ?? []).map((r) => r.text), why: why.get(id) ?? [] }))
    .sort((a, b) => b.score - a.score || order(a.id) - order(b.id))
}
