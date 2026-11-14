// Builds the care plan for one condition: who to contact (context- and Earth-delay-aware), what to do now,
// what not to do, medicines (checked against the profile), what to monitor, when to escalate, and sources.
import type { Context } from '../../data/contexts'
import { SOURCES, sourceOf, type Cited, type Condition, type EvidenceKind, type Urgency } from '../../data/conditions'
import type { HealthProfile } from '../../data/conditions/profile'
import { CABIN_SOURCES } from '../../data/cabinLink/sources'
import { formatDelay } from '../../data/missions'
import type { Assessment } from './engine'
import { asRedFlag, localise } from './localise'
import { adviseMeds, type MedAdvice } from './meds'

export type PlanItem = { text: string; src: string; quote: string }
export type PlanSource = { id: string; org: string; title: string; url: string; quotes: string[] }

export type CarePlan = {
  conditionId: string
  name: string
  urgency: Urgency
  first: string
  summary: PlanItem | null
  steps: PlanItem[]
  donts: PlanItem[]
  meds: MedAdvice[]
  redflags: PlanItem[]
  monitor: PlanItem[]
  escalate: PlanItem[]
  prevention: PlanItem[]
  sources: PlanSource[]
}

export const URGENCY_TEXT: Record<Urgency, { title: string; short: string }> = {
  emergency: { title: 'Emergency — get help now', short: 'Emergency' },
  urgent: { title: 'Urgent — get medical advice today', short: 'Urgent' },
  soon: { title: 'See a professional soon', short: 'Soon' },
  selfcare: { title: 'Self-care — keep an eye on it', short: 'Self-care' },
}

/** Who to contact and how fast, in the person's context. Space includes the Earth communication delay. */
export function firstStep(urgency: Urgency, ctx: Context, delaySec = 0): string {
  const remote = delaySec >= 60
  const wait = remote ? ` A reply from Earth takes at least ${formatDelay(delaySec * 2)}, so start the steps below without waiting for it.` : ''
  if (ctx === 'space') {
    if (urgency === 'emergency') return `Alert your crewmates and the crew medical officer now, start the onboard emergency procedure and call the flight surgeon on the private medical channel.${wait}`
    if (urgency === 'urgent') return `Tell the crew medical officer now and ask for a private medical conference with the flight surgeon today.${wait}`
    if (urgency === 'soon') return 'Raise it with the flight surgeon at the next private medical conference and include it in today’s report.'
    return 'This can usually be managed onboard. Tell the crew medical officer, log it in today’s report, and ask for a conference if it does not improve.'
  }
  if (ctx === 'polar') {
    if (urgency === 'emergency') return 'Alert the station doctor and a colleague now. Outside help can be far away, so start the steps below straight away.'
    if (urgency === 'urgent') return 'See the station doctor today. If anything gets worse, alert them straight away.'
    if (urgency === 'soon') return 'Mention it to the station doctor in the next few days, sooner if it gets worse.'
    return 'This can usually be looked after at the station. Tell the station doctor if it does not improve or gets worse.'
  }
  if (urgency === 'emergency') return 'Call 112 now (or your local emergency number; 999 in the UK). Say what is happening — the call handler will tell you what to do.'
  if (urgency === 'urgent') return 'Get medical advice today: contact your doctor or an urgent-care line (NHS 111 in the UK). If it gets worse, call 112.'
  if (urgency === 'soon') return 'Book an appointment with your doctor in the next few days, sooner if it gets worse.'
  return 'This can usually be looked after at home. Contact your doctor if it does not improve or gets worse.'
}

const MED_LINE = /aspirin|\bGTN\b|auto-injector|adrenaline|inhaler|\bpuffs?\b|paracetamol|ibuprofen|promethazine|painkiller|glucagon/i

function items(c: Condition, kind: EvidenceKind, ctx: Context, opts: { dropMeds?: boolean; max?: number } = {}): PlanItem[] {
  const seen = new Set<string>()
  const out: PlanItem[] = []
  for (const x of (c.ev[kind] ?? []) as Cited[]) {
    if (opts.dropMeds && MED_LINE.test(x.t)) continue
    const text = localise(kind === 'redflag' ? asRedFlag(x.t) : x.t, ctx)
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push({ text, src: x.s, quote: x.q })
    if (opts.max && out.length >= opts.max) break
  }
  return out
}

export function carePlan(c: Condition, a: Assessment, ctx: Context, profile: HealthProfile | null, delaySec = 0): CarePlan {
  const cand = a.candidates.find((x) => x.condition.id === c.id)
  // The overall urgency applies to the plan of the condition that triggered it; others use their own tier.
  const urgency: Urgency = cand && (cand.emergency.length || a.candidates[0]?.condition.id === c.id) ? a.urgency : c.urgency
  const meds = adviseMeds(c.ev.meds, ctx, profile, a.suspectedStroke)
  const plan: CarePlan = {
    conditionId: c.id,
    name: c.name,
    urgency,
    first: firstStep(urgency, ctx, delaySec),
    summary: items(c, 'summary', ctx, { max: 1 })[0] ?? null,
    steps: items(c, 'action', ctx, { dropMeds: meds.length > 0 || c.id === 'stroke' }),
    donts: items(c, 'dont', ctx),
    meds,
    redflags: items(c, 'redflag', ctx),
    monitor: items(c, 'monitor', ctx),
    escalate: items(c, 'escalate', ctx),
    prevention: items(c, 'prevention', ctx),
    sources: [],
  }
  const byId = new Map<string, PlanSource>()
  const add = (id: string, quote: string) => {
    // environment explanations (src/data/cabinLink/envDx.ts) cite the cabin-link sources
    const s = SOURCES[id] ? sourceOf(id) : (CABIN_SOURCES[id] ?? sourceOf(id))
    const cur = byId.get(id) ?? { id, org: s.org, title: s.title, url: s.url, quotes: [] }
    if (cur.quotes.length < 3 && !cur.quotes.includes(quote)) cur.quotes.push(quote)
    byId.set(id, cur)
  }
  for (const list of [plan.summary ? [plan.summary] : [], plan.steps, plan.donts, plan.redflags, plan.escalate, plan.monitor]) for (const it of list) add(it.src, it.quote)
  for (const m of meds) {
    add(m.source, m.quote)
    for (const k of m.matched) add(k.s, k.q)
  }
  plan.sources = [...byId.values()]
  return plan
}
