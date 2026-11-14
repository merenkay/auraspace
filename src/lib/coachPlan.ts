// Personalised activity programme: restrictions first, then adaptations, each with its reason and source.
// Built from the health profile, the latest saved AURA assessment, current readings and the context.
// The coach never increases a load on its own; it only holds, lowers or redirects activity.
import { CONDITION_BY_ID, sourceOf, type Cited, type SourceInfo } from '../data/conditions'
import { CHOICE_LABEL, type HealthProfile } from '../data/conditions/profile'
import { COACH_RULES, COACH_SOURCES } from '../data/coach/sources'
import { CONTEXTS, type Context } from '../data/contexts'
import type { SavedAssessment } from './clinic'
import type { Evaluation } from './health'

export type AdaptLevel = 'stop' | 'caution' | 'adjust'

export type Adaptation = {
  id: string
  level: AdaptLevel
  title: string
  text: string
  reason: string
  /** Where the advice comes from. `rule` marks AURA's own demo safety choice rather than a published guideline. */
  source: (SourceInfo & { quote?: string }) | null
  rule?: boolean
}

export type CoachPlan = { items: Adaptation[]; focus: { title: string; items: (Cited & { src: SourceInfo })[] } | null; basis: string[] }

export type CoachInput = { context: Context; ev: Evaluation | null; profile: HealthProfile | null; latest: SavedAssessment | null; sleepAvg: number | null; now?: number }

const CARDIO_NEURO = new Set(['heart-attack', 'stroke', 'hypertensive-crisis', 'decompression-sickness'])
const DAY = 86400000

/** Finds a sourced line in the knowledge base by condition, kind and a text pattern. */
function cite(conditionId: string, kind: 'prevention' | 'action' | 'monitor' | 'redflag' | 'risk', re: RegExp): (SourceInfo & { quote: string }) | null {
  const hit = (CONDITION_BY_ID[conditionId]?.ev[kind] ?? []).find((x) => re.test(x.t))
  return hit ? { ...sourceOf(hit.s), quote: hit.q } : null
}

export function buildCoachPlan({ context, ev, profile, latest, sleepAvg, now = Date.now() }: CoachInput): CoachPlan {
  const contact = CONTEXTS[context].contact
  const items: Adaptation[] = []
  const basis: string[] = []
  const has = (k: 'conditions' | 'medicines', id: string) => !!profile?.[k].includes(id)
  const measured = (f: keyof Evaluation['meta']) => !!ev?.meta[f]

  // 1. A recent serious assessment holds exercise until a professional has seen it.
  if (latest) {
    const ageDays = (now - new Date(latest.createdAt).getTime()) / DAY
    basis.push(`latest assessment (${new Date(latest.createdAt).toLocaleDateString()})`)
    const serious = latest.urgency === 'emergency' || latest.urgency === 'urgent'
    if (serious && ageDays <= 30 && latest.conditionId && CARDIO_NEURO.has(latest.conditionId)) {
      items.push({
        id: 'hold-cardiac',
        level: 'stop',
        title: 'No exercise until you are cleared',
        text: `Do not train until your ${contact} has reviewed you and cleared you for exercise.`,
        reason: `Your assessment on ${new Date(latest.createdAt).toLocaleDateString()} was ${latest.urgency} for ${latest.conditionName.toLowerCase()}.`,
        source: null,
        rule: true,
      })
    } else if (serious && ageDays <= 7) {
      items.push({
        id: 'hold-review',
        level: 'caution',
        title: 'Light activity only until reviewed',
        text: `Keep to light, everyday movement until your ${contact} has looked at your recent assessment.`,
        reason: `Your assessment on ${new Date(latest.createdAt).toLocaleDateString()} was ${latest.urgency} (${latest.conditionName.toLowerCase()}).`,
        source: null,
        rule: true,
      })
    }
  }

  // 2. Blood pressure: re-measure first; very high values stop the session.
  if (ev && measured('sys')) {
    basis.push('latest blood pressure')
    const sys = ev.values.sys
    const dia = ev.values.dia
    if (sys >= 180 || dia >= 120) {
      items.push({ id: 'bp-crisis', level: 'stop', title: 'Blood pressure 180/120 or higher', text: `Do not exercise. Re-measure after a few minutes of rest; if it stays this high, contact your ${contact} now.`, reason: `Latest reading ${Math.round(sys)}/${Math.round(dia)} mmHg.`, source: cite('hypertensive-crisis', 'monitor', /another reading/i) })
    } else if (ev.vitalStatus.bp && ev.vitalStatus.bp !== 'ok') {
      items.push({ id: 'bp-high', level: 'caution', title: 'Re-measure blood pressure before training', text: 'Sit quietly and take a second reading before the session. Keep loads as prescribed and avoid maximal lifts while it is above range.', reason: `Latest reading ${Math.round(sys)}/${Math.round(dia)} mmHg is above range.`, source: cite('hypertensive-crisis', 'monitor', /another reading/i), rule: true })
    }
  }

  // 3. Fever: rest.
  if (ev && measured('temp') && ev.values.temp >= 37.6) {
    items.push({ id: 'fever-rest', level: 'stop', title: 'Rest while you have a temperature', text: 'Skip training today, rest and drink plenty of fluids.', reason: `Latest temperature ${ev.values.temp.toFixed(1)} °C.`, source: cite('fever-infection', 'action', /rest/i) })
  }

  // 4. Diabetes: glucose around exercise.
  if (has('conditions', 'diabetes') || has('medicines', 'insulin') || has('medicines', 'diabetes-tablets')) {
    basis.push('diabetes on your profile')
    items.push({ id: 'glucose', level: 'adjust', title: 'Check glucose around exercise', text: 'Check your blood sugar before and after activity, and carry something sugary in case of a hypo.', reason: 'Your profile lists diabetes or diabetes medicine; extra activity and missed meals can cause low blood sugar.', source: cite('hypoglycaemia', 'prevention', /carry something sugary/i) })
  }

  // 5. Asthma: reliever at hand.
  if (has('conditions', 'asthma')) {
    items.push({ id: 'asthma', level: 'adjust', title: 'Keep your reliever inhaler with you', text: 'Carry your inhaler during every session and stop if you start to wheeze.', reason: 'Your profile lists asthma.', source: cite('asthma-attack', 'prevention', /carry your inhaler/i) })
  }

  // 5b. Heart and circulation conditions: medical advice before strength training; warning signs stop the session.
  const cardiac = ['heart-disease', 'angina', 'heart-failure', 'previous-stroke'].filter((c) => has('conditions', c))
  if (cardiac.length) {
    basis.push('heart condition on your profile')
    items.push({
      id: 'cardiac-clearance',
      level: 'caution',
      title: 'Ask before starting or stepping up strength work',
      text: `Check with your ${contact} which exercises suit you. Stop and get checked if you feel chest pain or pressure, dizziness, palpitations or unusual breathlessness.`,
      reason: `Your profile lists ${cardiac.map((c) => CHOICE_LABEL[c].toLowerCase()).join(', ')}.`,
      source: { ...COACH_SOURCES['aha-rt'], quote: COACH_RULES.rtClearance.q },
    })
  }

  // 5c. Pregnancy: no sourced exercise rules in this app — keep the starting level and ask.
  if (has('conditions', 'pregnancy')) {
    items.push({
      id: 'pregnancy',
      level: 'caution',
      title: 'Ask your midwife or doctor about exercise',
      text: 'Ask which exercises suit you now. AURA keeps your plan at its starting level and does not step it up.',
      reason: 'Your profile says you are pregnant.',
      source: null,
      rule: true,
    })
  }

  // 6. Falls at home: strength and balance.
  const older = profile?.ageBand === '65-79' || profile?.ageBand === '80+'
  if (context === 'home' && (older || has('conditions', 'falls-history') || has('conditions', 'osteoporosis'))) {
    basis.push('fall risk on your profile')
    items.push({ id: 'balance', level: 'adjust', title: 'Add strength and balance work', text: 'Do strength and balance activities at least twice a week, holding on to something stable at first.', reason: [older && `age ${CHOICE_LABEL[profile!.ageBand!]}`, has('conditions', 'falls-history') && 'a fall in the last year', has('conditions', 'osteoporosis') && 'osteoporosis'].filter(Boolean).join(', ') + ' — falls are more likely.', source: cite('fall-fracture', 'prevention', /strength and balance/i) })
  }

  // 7. Short sleep: lower intensity.
  if (sleepAvg != null && sleepAvg < 6) {
    basis.push('sleep over the last 7 nights')
    items.push({ id: 'sleep', level: 'adjust', title: 'Lower the intensity after short sleep', text: 'Keep today’s session at a comfortable effort and protect a fixed sleep window tonight.', reason: `You averaged ${sleepAvg.toFixed(1)} h of sleep over the last week.`, source: cite('sleep-loss', 'redflag', /six-hour nights/i), rule: true })
  }

  // 8. Hydration.
  if (ev && measured('water') && ev.vitalStatus.water && ev.vitalStatus.water !== 'ok') {
    items.push({ id: 'water', level: 'adjust', title: 'Drink before and during the session', text: 'Have a drink now and keep water within reach while you train.', reason: `Only ${ev.values.water.toFixed(1)} L logged today.`, source: cite('dehydration', 'prevention', /drink more when/i) })
  }
  if (has('conditions', 'kidney-stones')) {
    items.push({ id: 'stones', level: 'adjust', title: 'Keep fluids high', text: 'Spread drinks across the day to keep your urine pale.', reason: 'Your profile lists kidney stones in the past.', source: cite('renal-stone', 'prevention', /fluid|water|drink/i) })
  }

  const ORDER: Record<AdaptLevel, number> = { stop: 0, caution: 1, adjust: 2 }
  items.sort((a, b) => ORDER[a.level] - ORDER[b.level])

  // Prevention guidance from the condition in the latest assessment.
  let focus: CoachPlan['focus'] = null
  const cond = latest?.conditionId ? CONDITION_BY_ID[latest.conditionId] : null
  if (cond?.ev.prevention?.length) focus = { title: `From your last assessment: ${cond.name.replace(/^Possible /, '').toLowerCase()}`, items: cond.ev.prevention.slice(0, 4).map((p) => ({ ...p, src: sourceOf(p.s) })) }

  if (profile) basis.push('your health profile')
  return { items, focus, basis }
}
