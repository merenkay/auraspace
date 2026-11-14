// Environment-aware consultation: weighs reported symptoms against the measured room / cabin (DHT11 temperature
// and humidity, MQ-2 gas), in both directions, deterministically. No AI.
//
//   - "Expected here": with FRESH readings and the factor present now, sourced associations (src/data/cabinLink/
//     envDx.ts) explain a symptom: e.g. sweating at 31 °C / 78 %. For NON-emergency ranking only, an explained
//     symptom counts at half weight as evidence for an illness (AURA rule) and a benign explanation (heat strain,
//     cold, dry air) is offered as a candidate, with what to do and a discriminating follow-up question.
//   - "Not expected here": with fresh readings and the factor absent, a symptom such as sweating at 21 °C is noted
//     as not explained by the environment and adds a small weight (AURA rule) to illnesses that include it.
//
// Hard safety rules (tested in envDx.test.ts):
//   1. Red-flag rules run on the raw answers exactly as before. A raw emergency is returned unchanged (same
//      urgency, reasons, candidates and therefore the same plan and first step); only notes are attached.
//   2. The environment never turns an emergency or urgent result into a lower tier.
//   3. A symptom is explained only with fresh readings and the factor present now; stale / missing data gives
//      "no recent cabin readings", never "normal air".
//   4. Severity findings or words (severe, sudden, at rest, chest pain, confusion, blue lips, fainting …) cancel
//      every discount and explanation.
//   5. A fast heartbeat or breathlessness in heat is never explained away (NHS heatstroke signs).
//   6. Heatstroke signs in a hot room, and a "still unwell after cooling" answer, raise the urgency (raise only).
import { CABIN_LIMITS } from '../../data/missions'
import { CONDITIONS, URGENCY_RANK, type Cited, type Urgency } from '../../data/conditions'
import type { Context } from '../../data/contexts'
import {
  BREATH_999,
  DHT11_ACCURACY,
  DRY_EYES,
  DRY_EYES_URGENT,
  ENV_CONDITIONS,
  EXPECTATIONS,
  FOLLOW_UP,
  HEATSTROKE_FINDINGS,
  HEATSTROKE_HEART_BREATH,
  HEATSTROKE_NOT_EASED,
  HEAT_WATCH,
  HIGH_TEMP_HEAT,
  HI_EQUATION,
  HUMID_SWEAT,
  SEVERITY_FINDINGS,
  SEVERITY_TEXT,
  SWEAT_NORMAL,
  THIRST_HEAT,
  CHILLS_INFECTION,
  type EnvFactor,
} from '../../data/cabinLink/envDx'
import { assess, type Answers, type Assessment, type Candidate, type EngineInput, type NextQuestion } from '../doctor/engine'
import { FINDING_BY_ID } from '../doctor/findings'
import { fold } from '../doctor/parse'
import { assessWithCabin, cabinFactors, factorOf, gasAlarmRule, type CabinContext } from './context'
import { cToF, heatCategory, heatIndexC, heatIndexF, type HeatCategory } from './heatIndex'

/** AURA rule: weight multiplier for a symptom the measured environment explains (ranking only). */
export const EXPECTED_DISCOUNT = 0.5
/** AURA rule: weight of a "not explained by the environment" note for illnesses that include the symptom. */
export const NOT_EXPECTED_WEIGHT = 1
/** AURA rule: a vital reading is compared with the room only if it is at most this old. */
export const VITAL_NOTE_MAX_AGE_MS = 6 * 3_600_000

export type EnvNoteKind = 'expected' | 'strain' | 'watch' | 'not-expected' | 'cancelled' | 'no-data'
export type EnvNote = { finding: string; label: string; kind: EnvNoteKind; text: string; cite?: Cited }

export type EnvState = {
  quality: CabinContext['quality']
  fresh: boolean
  t: number | null
  h: number | null
  heat: boolean
  humid: boolean
  cold: boolean
  dry: boolean
  heatIndexC: number | null
  heatCategory: HeatCategory | null
}

export type EnvSummary = EnvState & {
  place: string
  ageMs: number | null
  /** "31 °C and 78 % humidity", or null without fresh values. */
  reading: string | null
  notes: EnvNote[]
  vitalNotes: EnvNote[]
  /** Environment explanations offered as candidates (condition ids). */
  offered: string[]
  /** Findings that counted less (ranking only). */
  discounted: string[]
  /** Severity findings / words that cancelled the environment explanation. */
  cancelledBy: string[]
  /** Raise-only rules triggered by the environment check. */
  escalations: string[]
  /** Follow-up finding asked because of the environment (or null). */
  followUp: string | null
  /** Sources behind the notes (for a sources list). */
  sources: Cited[]
}

export type EnvAssessment = Assessment & { environment: EnvSummary }

const PLACE: Record<Context, string> = { space: 'Cabin', polar: 'Station', home: 'Room' }

const SHORT: Record<string, string> = {
  sweating: 'sweating',
  thirst: 'thirst',
  fatigue: 'tiredness',
  headache: 'a headache',
  lightheaded: 'dizziness',
  cramps: 'cramps',
  nausea: 'feeling sick',
  chills: 'shivering or feeling cold',
  'eye-throat-irritation': 'stinging eyes or a scratchy throat',
  palpitations: 'a racing heartbeat',
  breathless: 'shortness of breath',
  'fast-breathing': 'fast breathing',
}
const shortOf = (id: string) => SHORT[id] ?? FINDING_BY_ID[id]?.label.toLowerCase() ?? id
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const rank = (u: Urgency) => URGENCY_RANK[u]
const maxU = (...us: Urgency[]) => us.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'selfcare' as Urgency)
const yesIds = (answers: Answers) => Object.entries(answers).filter(([, a]) => a === 'yes').map(([id]) => id)
const r0 = (n: number) => Math.round(n)
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '')

/** What the environment is like now, from the cabin context (fresh = newest reading ≤ 15 min old). */
export function environmentState(cabin: CabinContext | null): EnvState {
  const quality = cabin?.quality ?? 'none'
  const fresh = quality === 'fresh'
  const t = fresh ? (cabin?.latest?.t ?? null) : null
  const h = fresh ? (cabin?.latest?.h ?? null) : null
  const now = (id: 'heat' | 'humid' | 'cold' | 'dry') => fresh && !!factorOf(cabin, id)?.now
  const hiF = t != null && h != null ? heatIndexF(cToF(t), h) : null
  return {
    quality,
    fresh,
    t,
    h,
    heat: now('heat'),
    humid: now('humid'),
    cold: now('cold'),
    dry: now('dry'),
    heatIndexC: t != null && h != null ? heatIndexC(t, h) : null,
    heatCategory: hiF != null ? heatCategory(hiF) : null,
  }
}

function readingText(e: EnvState): string | null {
  if (e.t == null && e.h == null) return null
  const parts: string[] = []
  if (e.t != null) parts.push(`${r1(e.t)} °C`)
  if (e.h != null) parts.push(`${r0(e.h)} % humidity`)
  return parts.join(' and ')
}

/** Severity findings and words that cancel any environment explanation. */
export function severitySigns(answers: Answers, text?: string): string[] {
  const yes = new Set(yesIds(answers))
  const out = SEVERITY_FINDINGS.filter((id) => yes.has(id)).map((id) => FINDING_BY_ID[id]?.label.toLowerCase() ?? id)
  if (text && SEVERITY_TEXT.test(fold(text))) out.push('words such as “severe”, “sudden” or “at rest” in your description')
  return out
}

const factorPresent = (e: EnvState, f: EnvFactor) => (f === 'heat' ? e.heat : f === 'cold' ? e.cold : e.dry)

/** Per-symptom notes, explained findings and reverse-direction weights. Pure; exported for tests and views. */
export function environmentNotes(answers: Answers, cabin: CabinContext | null, context: Context, opts: { text?: string; allowExplain?: boolean } = {}) {
  const e = environmentState(cabin)
  const place = PLACE[context]
  const reading = readingText(e)
  const yes = yesIds(answers)
  const severity = severitySigns(answers, opts.text)
  const allow = opts.allowExplain !== false && severity.length === 0
  const notes: EnvNote[] = []
  const explained = new Map<EnvFactor, string[]>()
  const reverse: Record<string, { label: string; w: number }[]> = {}
  const sources: Cited[] = []
  const cite = (c: Cited) => {
    if (!sources.includes(c)) sources.push(c)
    return c
  }
  const addReverse = (finding: string, label: string, exclude: string[]) => {
    for (const c of CONDITIONS) {
      if (!c.contexts.includes(context) || exclude.includes(c.id) || !c.findings.some((f) => f.id === finding)) continue
      ;(reverse[c.id] ??= []).push({ label, w: NOT_EXPECTED_WEIGHT })
    }
  }

  for (const id of yes) {
    const exp = EXPECTATIONS.find((x) => x.finding === id)
    const watch = HEAT_WATCH[id]
    if (!exp && !watch) continue
    const name = shortOf(id)
    const label = FINDING_BY_ID[id]?.label ?? id
    if (!e.fresh) {
      if (exp)
        notes.push({
          finding: id,
          label,
          kind: 'no-data',
          text: e.quality === 'stale' ? `No recent ${place.toLowerCase()} readings (the newest is old), so AURA cannot tell whether the environment explains ${name}.` : `No recent ${place.toLowerCase()} readings, so AURA cannot tell whether the environment explains ${name}.`,
        })
      continue
    }
    if (watch && e.heat) {
      notes.push({ finding: id, label, kind: 'watch', text: `${place} is ${reading} — ${name} is not put down to the heat: the NHS lists it as a possible sign of heatstroke. Cool down, rest and check again.`, cite: cite(watch) })
      continue
    }
    if (!exp) continue
    if (factorPresent(e, exp.factor)) {
      // the discriminating answer does not fit the environment: chills with a fever point to an infection
      const misfit = exp.factor === 'cold' && answers.fever === 'yes' ? ['a fever'] : []
      if (!allow || misfit.length) {
        notes.push({ finding: id, label, kind: 'cancelled', text: `${place} is ${reading}, but ${name} is not put down to the environment because you also reported ${[...severity, ...misfit].join(', ')}.`, cite: cite(exp.cite) })
        continue
      }
      const list = explained.get(exp.factor) ?? []
      list.push(id)
      explained.set(exp.factor, list)
      const humidExtra = id === 'sweating' && e.humid ? ' In humid air sweat cools the body less well.' : ''
      if (id === 'sweating' && e.humid) cite(HUMID_SWEAT)
      notes.push({
        finding: id,
        label,
        kind: exp.kind === 'strain' ? 'strain' : 'expected',
        text:
          exp.kind === 'strain'
            ? `${place} is ${reading} — ${name} can be a sign of heat strain. Cool down and drink; it should ease within 30 minutes.`
            : `${place} is ${reading} — ${name} is an expected response to this.${humidExtra}`,
        cite: cite(exp.cite),
      })
      continue
    }
    // reverse direction: the factor is clearly absent in fresh readings
    if (id === 'sweating' && e.t != null && !e.heat) {
      notes.push({ finding: id, label, kind: 'not-expected', text: `${place} is ${reading} — sweating is not explained by the environment.`, cite: cite(SWEAT_NORMAL) })
      addReverse('sweating', `Sweating while the ${place.toLowerCase()} is ${r1(e.t)} °C is not explained by heat (sensor station)`, ['heat-illness'])
    } else if (id === 'thirst' && e.t != null && !e.heat) {
      notes.push({ finding: id, label, kind: 'not-expected', text: `${place} is ${reading} — thirst is not explained by heat.`, cite: cite(THIRST_HEAT) })
    } else if (id === 'chills' && e.t != null && !e.cold) {
      notes.push({ finding: id, label, kind: 'not-expected', text: `${place} is ${reading} — shivering is not explained by the room temperature; chills can also come with an infection.`, cite: cite(CHILLS_INFECTION) })
      addReverse('chills', `Shivering while the ${place.toLowerCase()} is ${r1(e.t)} °C is not explained by cold (sensor station)`, ['hypothermia', 'frostbite'])
    } else if (id === 'eye-throat-irritation' && e.h != null && !e.dry) {
      notes.push({ finding: id, label, kind: 'not-expected', text: `${place} humidity is ${r0(e.h)} % — the irritation is not explained by dry air.`, cite: cite(DRY_EYES) })
    }
  }
  return { env: e, place, reading, notes, explained, reverse, severity, sources }
}

/** Vital readings compared with the room (notes only, never a status change). */
export function vitalNotes(input: EngineInput, e: EnvState, place: string, reading: string | null): EnvNote[] {
  if (!e.fresh || !e.heat) return []
  const now = input.now ?? Date.now()
  const out: EnvNote[] = []
  const current = (k: 'hr' | 'temp') => {
    const r = input.readings?.[k]
    if (!r || !Number.isFinite(r.value)) return null
    if (r.at) {
      const age = now - Date.parse(r.at)
      if (!Number.isFinite(age) || age > VITAL_NOTE_MAX_AGE_MS) return null
    }
    return r.value
  }
  const hr = current('hr')
  if (hr != null && hr > 100)
    out.push({
      finding: 'hr',
      label: 'Heart rate',
      kind: 'watch',
      text: `Heart rate ${r0(hr)} bpm while the ${place.toLowerCase()} is ${reading}: heat makes the heart work harder, and the NHS lists a fast heartbeat among heatstroke signs. Cool down, rest and measure again. The reading’s status is unchanged.`,
      cite: HEATSTROKE_HEART_BREATH,
    })
  const temp = current('temp')
  if (temp != null && temp > 37.5)
    out.push({
      finding: 'temp',
      label: 'Body temperature',
      kind: 'watch',
      text: `Body temperature ${r1(temp)} °C while the ${place.toLowerCase()} is ${reading}: a high temperature can be a sign of heat exhaustion, not only of an infection. Cool down and measure again. The reading’s status is unchanged.`,
      cite: HIGH_TEMP_HEAT,
    })
  return out
}

function envCandidate(f: EnvFactor, ids: string[], reading: string | null, place: string, followAnswered: boolean): Candidate {
  const expected = EXPECTATIONS.filter((x) => x.factor === f).length
  const fu = FOLLOW_UP[f]
  return {
    condition: ENV_CONDITIONS[f],
    score: ids.length + 0.5,
    coverage: ids.length / expected,
    strength: ids.length >= 2 ? 'moderate' : 'weak', // AURA rule: an environment explanation is never "strong"
    matched: ids.map((id) => ({ id, label: FINDING_BY_ID[id]?.label ?? id, w: 1 })),
    factors: reading ? [{ id: 'env', label: `${place} ${reading} (fresh sensor reading)`, w: 1 }] : [],
    against: [],
    missing: followAnswered ? [] : [`${FINDING_BY_ID[fu.id]?.label ?? fu.id} — not asked yet`],
    unmeasured: [],
    emergency: [],
    urgent: [],
  }
}

/**
 * The consultation with the environment folded in (superset of assessWithCabin). `text` is the person's own
 * words, checked for severity words.
 */
export function assessWithEnvironment(input: EngineInput, cabin: CabinContext | null, opts: { text?: string } = {}): EnvAssessment {
  const raw = assess(input)
  const n = environmentNotes(input.answers, cabin, input.context, { text: opts.text })
  const vNotes = vitalNotes(input, n.env, n.place, n.reading)
  const yes = new Set(yesIds(input.answers))
  const summary = (extra: Partial<EnvSummary> = {}): EnvSummary => ({
    ...n.env,
    place: n.place,
    ageMs: cabin?.ageMs ?? null,
    reading: n.reading,
    notes: n.notes,
    vitalNotes: vNotes,
    offered: [],
    discounted: [],
    cancelledBy: n.severity,
    escalations: [],
    followUp: null,
    sources: [...n.sources, ...vNotes.map((v) => v.cite!).filter(Boolean), ...(n.env.heatIndexC != null ? [HI_EQUATION] : []), ...(n.env.fresh ? [DHT11_ACCURACY] : [])],
    ...extra,
  })

  // Rule 1: a raw emergency is returned exactly as it is.
  if (raw.urgency === 'emergency') return { ...raw, environment: summary() }

  // Raise-only rules from the environment check.
  const esc: { urgency: Urgency; reason: string }[] = []
  const heatSigns = HEATSTROKE_FINDINGS.filter((id) => yes.has(id) && id !== 'heat-not-eased')
  if (yes.has('heat-not-eased')) esc.push({ urgency: 'emergency', reason: `${HEATSTROKE_NOT_EASED.t} (NHS)` })
  else if (n.env.heat && heatSigns.length)
    esc.push({ urgency: 'emergency', reason: `AURA rule from the NHS heatstroke signs: ${heatSigns.map((id) => FINDING_BY_ID[id].label.toLowerCase()).join(', ')} while the ${n.place.toLowerCase()} is ${n.reading}` })
  if (yes.has('breathless-rest')) esc.push({ urgency: 'urgent', reason: 'AURA rule: breathlessness at rest is not explained by a warm or humid room — get it checked today (call for help at once if breathing is severely difficult)' })
  if (yes.has('eye-red-painful')) esc.push({ urgency: 'urgent', reason: `${DRY_EYES_URGENT.t} (NHS)` })
  if (yes.has('breathless-rest')) n.sources.push(BREATH_999)

  const cabinBase = assessWithCabin(input, cabin)
  const allowDiscount = rank(raw.urgency) < rank('urgent') && n.severity.length === 0 && esc.length === 0
  const explained = allowDiscount ? n.explained : new Map<EnvFactor, string[]>()
  const discount: Record<string, number> = {}
  for (const ids of explained.values()) for (const id of ids) discount[id] = EXPECTED_DISCOUNT

  const extra: Record<string, { label: string; w: number }[]> = { ...cabinFactors(cabin) }
  for (const [id, list] of Object.entries(n.reverse)) extra[id] = [...(extra[id] ?? []), ...list]
  const out = assess({ ...input, extraFactors: { ...input.extraFactors, ...extra }, discount })
  const gasRule = gasAlarmRule(cabin, input.answers)

  // Urgency: never below the raw / cabin result when that is urgent or emergency.
  let urgency: Urgency
  let reasons: string[]
  let ruleBased: boolean
  const floor = rank(raw.urgency) >= rank('urgent') || rank(cabinBase.urgency) >= rank('urgent') ? maxU(raw.urgency, cabinBase.urgency) : null
  const allExplained = yes.size > 0 && [...yes].every((id) => [...explained.values()].some((ids) => ids.includes(id)))
  if (floor) {
    urgency = maxU(floor, out.urgency)
    const src = rank(cabinBase.urgency) >= rank(out.urgency) ? cabinBase : out
    reasons = src.reasons
    ruleBased = src.ruleBased
  } else if (allExplained && !raw.ruleBased) {
    // Every symptom fits the measured environment: AURA's illness tier (after the discount) without the
    // "no clear match" review step, since the environment is the clear match. Can be below "soon"; never below
    // the tier of a well-matched illness.
    urgency = out.noClearMatch ? 'selfcare' : out.urgency
    reasons = [
      ...out.reasons.filter((r) => !/^No condition in AURA/.test(r)),
      `Every symptom you reported fits the measured ${n.place.toLowerCase()} (${n.reading}); follow the steps and check again — get help if it does not ease`,
    ]
    ruleBased = out.ruleBased
  } else {
    urgency = maxU(raw.urgency, cabinBase.urgency, out.urgency)
    const src = [out, cabinBase, raw].find((x) => x.urgency === urgency) ?? out
    reasons = src.reasons
    ruleBased = src.ruleBased
  }
  if (gasRule && rank(urgency) < rank('urgent')) {
    urgency = 'urgent'
    ruleBased = true
    reasons = [...reasons, gasRule]
  }
  for (const x of esc) {
    if (rank(x.urgency) > rank(urgency)) urgency = x.urgency
    reasons = [...reasons, x.reason]
    ruleBased = true
  }

  // Candidates: illnesses (discounted) plus the benign environment explanations.
  let candidates = floor ? cabinBase.candidates : out.candidates
  const offered: string[] = []
  if (allowDiscount && explained.size) {
    const pinned = candidates.filter((c) => c.emergency.length || c.urgent.length)
    const rest = candidates.filter((c) => !c.emergency.length && !c.urgent.length)
    for (const [f, ids] of explained) {
      const answered = input.answers[FOLLOW_UP[f].id] != null
      rest.push(envCandidate(f, ids, n.reading, n.place, answered))
      offered.push(ENV_CONDITIONS[f].id)
    }
    rest.sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    candidates = [...pinned, ...rest]
  }

  // Next question: safety checks first, then the environment's discriminating question.
  let next: NextQuestion | null = urgency === 'emergency' ? null : (floor ? cabinBase.next : out.next)
  let followUp: string | null = null
  if (urgency !== 'emergency' && !(next && /^Safety check/.test(next.why))) {
    const want: { id: string; why: string }[] = []
    const heatWatch = n.env.heat && ['palpitations', 'breathless', 'fast-breathing'].some((id) => yes.has(id))
    if ((explained.has('heat') || heatWatch) && input.answers['heat-not-eased'] == null) want.push({ id: 'heat-not-eased', why: `Environment check: ${HEATSTROKE_NOT_EASED.t}` })
    if (heatWatch && (yes.has('breathless') || yes.has('fast-breathing')) && input.answers['breathless-rest'] == null) want.push({ id: 'breathless-rest', why: 'Environment check: breathing hard at rest does not fit a warm room.' })
    if (explained.has('dry') && input.answers['eye-red-painful'] == null) want.push({ id: 'eye-red-painful', why: `Environment check: ${DRY_EYES_URGENT.t}` })
    if (explained.has('cold') && input.answers.fever == null) want.push({ id: 'fever', why: `Environment check: ${CHILLS_INFECTION.t}` })
    const w = want[0]
    if (w && FINDING_BY_ID[w.id]) {
      followUp = w.id
      next = { id: w.id, question: FINDING_BY_ID[w.id].question, label: FINDING_BY_ID[w.id].label, why: w.why }
    }
  }

  const noClearMatch = offered.length > 0 && candidates[0] && offered.includes(candidates[0].condition.id) && candidates[0].strength !== 'weak' ? false : floor ? cabinBase.noClearMatch : out.noClearMatch
  return {
    urgency,
    reasons: [...new Set(reasons)],
    ruleBased,
    candidates,
    noClearMatch,
    next,
    yesCount: raw.yesCount,
    suspectedStroke: raw.suspectedStroke,
    environment: summary({ offered, discounted: Object.keys(discount), escalations: esc.map((x) => x.reason), followUp }),
  }
}

/** One short spoken / written line about the environment for this assessment (null when nothing to say). */
export function environmentLine(a: EnvAssessment): string | null {
  const e = a.environment
  if (a.urgency === 'emergency') return null // emergencies: instructions only
  const expected = e.notes.filter((x) => x.kind === 'expected' || x.kind === 'strain').map((x) => shortOf(x.finding))
  const watch = e.notes.filter((x) => x.kind === 'watch').map((x) => shortOf(x.finding))
  const notExp = e.notes.filter((x) => x.kind === 'not-expected').map((x) => shortOf(x.finding))
  const noData = e.notes.some((x) => x.kind === 'no-data')
  const parts: string[] = []
  const advice = e.heat ? ' Cool down, drink, and check again in 30 minutes.' : e.cold ? ' Warm up.' : e.dry ? ' A humidifier and screen breaks can help.' : ''
  if (expected.length) parts.push(`The ${e.place.toLowerCase()} is ${e.reading}, so ${list(expected)} ${expected.length > 1 ? 'are' : 'is'} expected.${advice}`)
  if (watch.length) parts.push(`In this heat, ${list(watch)} needs a re-check: cool down and tell me if it does not ease.`)
  if (notExp.length) parts.push(`${cap(list(notExp))} ${notExp.length > 1 ? 'are' : 'is'} not explained by the ${e.place.toLowerCase()} at ${e.reading}.`)
  if (!parts.length && noData) parts.push(`There are no recent ${e.place.toLowerCase()} readings, so I could not check the air.`)
  return parts.length ? parts.join(' ') : null
}

function list(xs: string[]) {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** Spoken / chat answer for "is it the air?" / "how is the cabin?": what the readings make expected. */
export function environmentBrief(cabin: CabinContext | null, context: Context): string {
  const e = environmentState(cabin)
  const place = PLACE[context].toLowerCase()
  if (!e.fresh) return e.quality === 'stale' ? `The newest ${place} reading is old, so I can’t say what the air is like now.` : `There are no recent ${place} readings, so I can’t say whether the air plays a part.`
  const r = readingText(e)
  const bits: string[] = []
  if (e.heat) bits.push(`In this heat, sweating and thirst are expected, and tiredness, headache or dizziness can be heat strain: cool down and drink, and if you still feel unwell after 30 minutes, get help.${e.humid ? ' The humid air makes sweating cool you less.' : ''}`)
  if (e.cold) bits.push('In this cold, shivering is the body making heat: warm up.')
  if (e.dry) bits.push('The air is very dry, which can make eyes dry or gritty.')
  if (!bits.length) bits.push(`That’s inside the ${CABIN_LIMITS.tempMin} to ${CABIN_LIMITS.tempMax} degree band, so heat or cold would not explain sweating or shivering.`)
  const hi = e.heatIndexC != null && e.heatCategory && e.heatCategory.id !== 'none' ? ` It feels like about ${r0(e.heatIndexC)} degrees (heat index, ${e.heatCategory.label.toLowerCase()}).` : ''
  return `The ${place} is ${r}.${hi} ${bits.join(' ')} Tell me your symptoms and I’ll weigh them against the room.`
}
