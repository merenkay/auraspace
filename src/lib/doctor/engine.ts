// AURA offline consultation engine: deterministic scoring of known conditions from answered findings,
// current readings, context and the health profile. No AI, no network. Language stays "possible / consistent with".
import type { Context } from '../../data/contexts'
import { CONDITIONS, URGENCY_RANK, type Condition, type ReadingTest, type Rule, type Urgency } from '../../data/conditions'
import type { HealthProfile } from '../../data/conditions/profile'
import type { FieldId } from '../../data/vitals'
import { FINDING_BY_ID } from './findings'

export type Answer = 'yes' | 'no' | 'unsure'
export type Answers = Record<string, Answer>
export type Reading = { value: number; at?: string }
export type Readings = Partial<Record<FieldId, Reading>>

export type EngineInput = {
  answers: Answers
  context: Context
  readings?: Readings
  profile?: HealthProfile | null
  /** ms timestamp used to decide whether a reading is current (default: Date.now()). */
  now?: number
  /**
   * Optional extra supporting factors per condition id (e.g. cabin-air readings from src/lib/cabinLink).
   * Additive only: they add to the score like a matched factor, never count as a key factor, never change
   * strength, red-flag rules or `against`. Weights <= 0 are ignored.
   */
  extraFactors?: Record<string, { label: string; w: number }[]>
  /**
   * Optional evidence discount per finding id (0..1 multiplier on its weight), e.g. sweating in a hot room
   * (src/lib/cabinLink/envDx.ts). Ranking only: the yes-set used by red-flag rules, hallmark status and
   * `against` are unchanged. Values outside [0, 1) are ignored.
   */
  discount?: Record<string, number>
}

export type Strength = 'strong' | 'moderate' | 'weak'
export type Match = { id: string; label: string; w: number }

export type Candidate = {
  condition: Condition
  score: number
  coverage: number
  strength: Strength
  matched: Match[]
  factors: Match[]
  against: Match[]
  missing: string[]
  unmeasured: string[]
  emergency: string[]
  urgent: string[]
}

export type NextQuestion = { id: string; question: string; label: string; why: string }

export type Assessment = {
  urgency: Urgency
  reasons: string[]
  ruleBased: boolean
  candidates: Candidate[]
  noClearMatch: boolean
  next: NextQuestion | null
  yesCount: number
  suspectedStroke: boolean
}

/** Readings older than this are not used as evidence (they are reported as not current). */
export const READING_MAX_AGE_DAYS = 7

const METRIC_LABEL: Record<FieldId, string> = {
  sys: 'blood pressure', dia: 'blood pressure', hr: 'heart rate', spo2: 'blood oxygen', temp: 'temperature', glucose: 'glucose',
  sleep: 'sleep', mood: 'mood', exercise: 'exercise', vision: 'vision check', water: 'water intake',
}

function currentReading(readings: Readings | undefined, metric: FieldId, now: number): Reading | null {
  const r = readings?.[metric]
  if (!r || !Number.isFinite(r.value)) return null
  if (r.at) {
    const age = (now - new Date(r.at).getTime()) / 86400000
    if (Number.isFinite(age) && age > READING_MAX_AGE_DAYS) return null
  }
  return r
}

function testMet(t: ReadingTest, readings: Readings | undefined, now: number): boolean | null {
  const r = currentReading(readings, t.metric, now)
  if (!r) return null
  return t.op === '>=' ? r.value >= t.value : r.value <= t.value
}

function anyMet(tests: ReadingTest[], readings: Readings | undefined, now: number): boolean | null {
  const res = tests.map((t) => testMet(t, readings, now))
  if (res.some((x) => x === true)) return true
  if (res.every((x) => x === null)) return null
  return false
}

export function ruleMet(rule: Rule, yes: Set<string>, readings: Readings | undefined, now: number): boolean {
  if (!rule.need && !rule.reading) return false
  if (rule.need && !rule.need.every((g) => g.some((id) => yes.has(id)))) return false
  if (rule.reading && anyMet(rule.reading, readings, now) !== true) return false
  return true
}

const label = (id: string) => FINDING_BY_ID[id]?.label ?? id

function scoreCondition(c: Condition, input: EngineInput, yes: Set<string>, now: number): Candidate {
  const { answers, readings, profile, context } = input
  let yesW = 0
  let totalW = 0
  let noPenalty = 0
  let hallmarkYes = false
  const matched: Match[] = []
  const missing: string[] = []
  for (const f of c.findings) {
    totalW += f.w
    const a = answers[f.id]
    if (a === 'yes') {
      const k = input.discount?.[f.id]
      const w = k != null && k >= 0 && k < 1 ? f.w * k : f.w
      yesW += w
      matched.push({ id: f.id, label: label(f.id), w })
      if (f.hallmark) hallmarkYes = true
    } else if (f.hallmark) {
      missing.push(`${label(f.id)} — ${a === 'no' ? 'you said no' : a === 'unsure' ? 'not sure' : 'not asked yet'}`)
      if (a === 'no') noPenalty += f.w
    }
  }
  const factors: Match[] = []
  const unmeasured: string[] = []
  let factorW = 0
  let keyFactor = false
  for (const fac of c.factors ?? []) {
    let hit = false
    if (fac.kind === 'reading') {
      const met = anyMet(fac.any, readings, now)
      if (met === null) {
        const names = [...new Set(fac.any.map((t) => METRIC_LABEL[t.metric]))].join(' / ')
        if (!unmeasured.includes(names)) unmeasured.push(names)
      }
      hit = met === true
    } else if (fac.kind === 'context') hit = fac.contexts.includes(context)
    else if (profile) {
      hit =
        (!!fac.condition && profile.conditions.includes(fac.condition)) ||
        (!!fac.medicine && profile.medicines.includes(fac.medicine)) ||
        (!!fac.age && !!profile.ageBand && fac.age.includes(profile.ageBand))
    }
    if (hit) {
      factors.push({ id: fac.label, label: fac.label, w: fac.w })
      factorW += fac.w
      if (fac.w >= 3) keyFactor = true
    }
  }
  for (const fac of input.extraFactors?.[c.id] ?? []) {
    if (!(fac.w > 0)) continue
    factors.push({ id: fac.label, label: fac.label, w: fac.w })
    factorW += fac.w
  }
  const against: Match[] = []
  let againstW = 0
  for (const ag of c.against ?? []) {
    const hit = ag.finding ? answers[ag.finding] === (ag.when ?? 'yes') : ag.reading ? testMet(ag.reading, readings, now) === true : false
    if (hit) {
      against.push({ id: ag.label, label: ag.label, w: ag.w })
      againstW += ag.w
    }
  }
  const emergency = (c.emergencyIf ?? []).filter((r) => ruleMet(r, yes, readings, now)).map((r) => r.label)
  const urgent = (c.urgentIf ?? []).filter((r) => ruleMet(r, yes, readings, now)).map((r) => r.label)
  const coverage = totalW ? yesW / totalW : 0
  const penalty = noPenalty + againstW
  const score = yesW + factorW * 0.5 - penalty
  const strength: Strength =
    (hallmarkYes || (keyFactor && yesW > 0)) && coverage >= 0.4 && penalty < yesW / 2
      ? 'strong'
      : ((hallmarkYes || (keyFactor && yesW > 0)) && coverage >= 0.2 && penalty < yesW) || coverage >= 0.35
        ? 'moderate'
        : 'weak'
  return { condition: c, score, coverage, strength, matched, factors, against, missing, unmeasured, emergency, urgent }
}

function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b
}

/** The tier a well-matched candidate implies without a red-flag rule: its own tier when strong, capped at urgent otherwise. */
function tierOf(c: Candidate): Urgency {
  return c.strength === 'strong' ? c.condition.urgency : maxUrgency('selfcare', c.condition.urgency === 'emergency' ? 'urgent' : c.condition.urgency)
}

export function assess(input: EngineInput): Assessment {
  const now = input.now ?? Date.now()
  const yes = new Set(Object.entries(input.answers).filter(([, a]) => a === 'yes').map(([id]) => id))
  const pool = CONDITIONS.filter((c) => c.contexts.includes(input.context))
  const scored = pool.map((c) => scoreCondition(c, input, yes, now))
  const candidates = scored
    .filter((c) => c.matched.length > 0 || c.emergency.length > 0 || c.urgent.length > 0)
    .sort((a, b) => b.emergency.length - a.emergency.length || b.score - a.score || b.coverage - a.coverage)

  const emergencyRules = candidates.flatMap((c) => c.emergency)
  const urgentRules = candidates.flatMap((c) => c.urgent)
  const noClearMatch = !candidates.some((c) => c.strength !== 'weak')
  const reasons: string[] = []
  let urgency: Urgency = 'selfcare'
  let ruleBased = false
  if (emergencyRules.length) {
    urgency = 'emergency'
    ruleBased = true
    reasons.push(...new Set(emergencyRules))
  } else {
    if (urgentRules.length) {
      urgency = 'urgent'
      ruleBased = true
      reasons.push(...new Set(urgentRules))
    }
    const top = candidates.find((c) => c.strength !== 'weak')
    if (top) {
      const tier = tierOf(top)
      if (URGENCY_RANK[tier] > URGENCY_RANK[urgency]) reasons.push(`Best match: ${top.condition.name.toLowerCase()} (${top.strength} match)`)
      urgency = maxUrgency(urgency, tier)
    }
    // Every other well-matched candidate that explains something the leader does not keeps its own tier too, so a
    // milder condition that happens to rank first (for example after the knowledge base grows) cannot hide it.
    const topIds = new Set(top?.condition.findings.map((f) => f.id) ?? [])
    for (const c of candidates) {
      if (c === top || c.strength === 'weak' || !c.matched.some((m) => !topIds.has(m.id))) continue
      const tier = tierOf(c)
      if (URGENCY_RANK[tier] <= URGENCY_RANK[urgency]) continue
      reasons.push(`Also possible: ${c.condition.name.toLowerCase()} (${c.strength} match)`)
      urgency = tier
    }
    if (yes.size > 0 && noClearMatch) {
      urgency = maxUrgency(urgency, 'soon')
      reasons.push('No condition in AURA’s knowledge base matches well, so a professional should review your symptoms')
    } else if (URGENCY_RANK[urgency] < URGENCY_RANK.soon) {
      // self-care only when the best well-matched condition accounts for everything the person reported
      const best = candidates.find((c) => c.strength !== 'weak')
      const own = new Set(best?.condition.findings.map((f) => f.id) ?? [])
      const unexplained = [...yes].filter((id) => !!FINDING_BY_ID[id] && !own.has(id))
      if (unexplained.length) {
        urgency = 'soon'
        reasons.push(`The best match does not explain: ${unexplained.map((id) => label(id).toLowerCase()).join('; ')}. A professional should review your symptoms`)
      }
    }
  }
  const strokeCand = candidates.find((c) => c.condition.id === 'stroke')
  const suspectedStroke = !!strokeCand && (strokeCand.emergency.length > 0 || strokeCand.strength === 'strong')
  const base = { urgency, reasons, ruleBased, candidates, noClearMatch, yesCount: yes.size, suspectedStroke }
  return { ...base, next: urgency === 'emergency' ? null : nextQuestion(candidates, input, yes, now) }
}

/**
 * Picks the follow-up question that best separates the leading candidates. Questions that could complete
 * a red-flag rule come first (safety), then questions that split the candidates, then confirmation of the leader.
 */
export function nextQuestion(candidates: Candidate[], input: EngineInput, yes: Set<string>, now: number): NextQuestion | null {
  const top = candidates.filter((c) => c.score > 0).slice(0, 4)
  if (!top.length) return null
  const total = top.reduce((s, c) => s + Math.max(c.score, 0.5), 0)
  const p = top.map((c) => Math.max(c.score, 0.5) / total)
  const weightIn = (c: Condition, id: string) => c.findings.find((f) => f.id === id)?.w ?? ((c.emergencyIf ?? []).some((r) => r.need?.some((g) => g.includes(id))) ? 2 : 0)
  const pool = new Set<string>()
  top.forEach((c) => {
    c.condition.findings.forEach((f) => pool.add(f.id))
    ;(c.condition.emergencyIf ?? []).forEach((r) => r.need?.forEach((g) => g.forEach((id) => pool.add(id))))
  })
  let best: { id: string; value: number; why: string } | null = null
  for (const id of pool) {
    if (input.answers[id] || !FINDING_BY_ID[id]) continue
    let share = 0
    let sep = 0
    let red = 0
    let redFor = ''
    top.forEach((c, i) => {
      const w = weightIn(c.condition, id)
      if (w > 0) share += p[i]
    })
    top.forEach((c, i) => {
      const w = weightIn(c.condition, id)
      sep += p[i] * w * (1 - share)
      for (const r of c.condition.emergencyIf ?? []) {
        if (!r.need?.some((g) => g.includes(id))) continue
        const others = r.need.filter((g) => !g.includes(id))
        const readingOk = !r.reading || anyMet(r.reading, input.readings, now) === true
        // a one-group rule ("bleeding that will not stop") counts once its condition's hallmark is already present
        const plausible = others.length > 0 || c.condition.findings.some((f) => f.hallmark && yes.has(f.id))
        if (readingOk && others.every((g) => g.some((x) => yes.has(x))) && plausible) {
          red += p[i] * 3
          redFor ||= c.condition.name.toLowerCase()
        }
      }
    })
    const lead = top[0].condition.findings.find((f) => f.id === id)
    const confirm = lead?.hallmark ? p[0] * lead.w : 0
    const value = red * 2 + sep + confirm * 0.6 + (lead ? lead.w * 0.1 : 0)
    if (!best || value > best.value) {
      const why = red > 0 ? `Safety check: this sign would make ${redFor} more urgent.` : top.length > 1 && sep > confirm ? `This helps tell apart ${top.slice(0, 2).map((c) => c.condition.name.replace(/^possible /i, '').toLowerCase()).join(' and ')}.` : `This helps confirm or rule out ${top[0].condition.name.replace(/^possible /i, '').toLowerCase()}.`
      best = { id, value, why }
    }
  }
  if (!best || best.value < 0.2) return null
  const d = FINDING_BY_ID[best.id]
  return { id: best.id, question: d.question, label: d.label, why: best.why }
}
