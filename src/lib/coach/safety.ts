// Safety layer: runs before the programme is built. It keeps every restriction of the original coach
// (stop / caution / adjust from profile, latest assessment and readings) and turns them, plus the person's
// movement limitations, into exercise restrictions the generator must respect. Missing data is listed as
// "not checked", never treated as normal.
import { CHOICE_LABEL, type HealthProfile } from '../../data/conditions/profile'
import { CONTEXTS, type Context } from '../../data/contexts'
import { LIMIT_LABEL } from '../../data/coach/catalog'
import type { CoachRuleId } from '../../data/coach/sources'
import type { SavedAssessment } from '../clinic'
import { buildCoachPlan, type CoachPlan } from '../coachPlan'
import type { Evaluation } from '../health'
import type { ContraTag, Joint, Restriction, TrainingProfile } from './types'

export type SafetyInput = {
  context: Context
  ev: Evaluation | null
  profile: HealthProfile | null
  latest: SavedAssessment | null
  sleepAvg: number | null
  training: TrainingProfile
  now?: number
}

export type SafetyNote = { id: string; text: string; ruleId?: CoachRuleId; rule?: boolean }

export type Safety = {
  plan: CoachPlan
  onHold: boolean
  holdReason: string | null
  /** A caution is active: progression is only ever a suggestion for the care contact. */
  caution: boolean
  /** Light, everyday movement only (recent serious assessment not yet reviewed). */
  lightOnly: boolean
  blocked: Restriction[]
  effortCap: { max: number; reason: string; ruleId?: CoachRuleId; rule?: boolean } | null
  notChecked: string[]
  notes: SafetyNote[]
  cooldownMin: number
}

const JOINTS: Joint[] = ['knee', 'hip', 'shoulder', 'wrist', 'back']

export function buildSafety({ context, ev, profile, latest, sleepAvg, training, now }: SafetyInput): Safety {
  const plan = buildCoachPlan({ context, ev, profile, latest, sleepAvg, now })
  const contact = CONTEXTS[context].contact
  const has = (k: 'conditions' | 'medicines', id: string) => !!profile?.[k].includes(id)
  const ids = new Set(plan.items.map((i) => i.id))
  const stop = plan.items.find((i) => i.level === 'stop') ?? null
  const caution = plan.items.some((i) => i.level === 'caution')
  const lightOnly = ids.has('hold-review')

  const blocked: Restriction[] = []
  const block = (tag: ContraTag | Joint, reason: string, ruleId?: CoachRuleId, rule?: boolean) => {
    if (!blocked.some((b) => b.tag === tag && b.reason === reason)) blocked.push({ tag, reason, ruleId, rule })
  }

  if (has('conditions', 'osteoporosis')) {
    block('spinal-flexion', 'Osteoporosis: no exercises that bend the spine forward under load or to the end of its range.', 'osteoFlexion')
    block('impact', `Osteoporosis: AURA cannot tell whether you have had a spine fracture, so impact stays at brisk-walking level until your ${contact} says otherwise.`, 'osteoImpactCap', true)
  }
  if (has('conditions', 'falls-history')) block('unsupported-balance', 'A fall in the last year: balance and standing exercises keep a chair or wall within reach.', 'balanceSupport', true)
  if (profile?.ageBand === '80+') block('unsupported-balance', 'Age 80 or over: balance exercises keep a support within reach.', 'balanceSupport', true)
  if (context === 'home' && training.level === 'starting') block('unsupported-balance', 'Just starting: balance work begins next to a wall or stable chair.', 'balanceNearWall', true)

  for (const l of training.limits) {
    if (l === 'seated') {
      block('standing', 'You need to stay seated: standing exercises are swapped for seated ones.')
      block('unsupported-balance', 'You need to stay seated.')
      block('impact', 'You need to stay seated.')
    } else if (l === 'no-floor') block('floor', 'You can’t get down to the floor: floor exercises are swapped.')
    else if (l === 'no-impact') block('impact', 'You asked for no jumping or jogging.')
    else if ((JOINTS as string[]).includes(l)) block(l as Joint, `${LIMIT_LABEL[l]}: exercises that load this joint are swapped where possible.`, 'oaExercise', true)
  }

  // Readings and recent assessments.
  if (ids.has('bp-high')) {
    block('isometric', 'Blood pressure above range: no sustained holds (like planks) today.', 'htnRT', true)
    block('vigorous', 'Blood pressure above range: no hard intervals or maximal efforts today.', 'htnRT', true)
  }
  if (caution || lightOnly) block('vigorous', `A caution is active: no hard intervals until your ${contact} has looked at it.`, undefined, true)
  if (ids.has('sleep')) block('vigorous', 'Short sleep this week: no hard intervals.', undefined, true)

  let effortCap: Safety['effortCap'] = null
  const cap = (max: number, reason: string, ruleId?: CoachRuleId, rule?: boolean) => {
    if (!effortCap || max < effortCap.max) effortCap = { max, reason, ruleId, rule }
  }
  if (lightOnly) cap(4, 'Light activity only until your recent assessment is reviewed.', undefined, true)
  if (ids.has('bp-high')) cap(6, 'Blood pressure above range: keep to moderate effort.', 'htnRT', true)
  if (ids.has('cardiac-clearance')) cap(6, 'Heart condition on your profile: keep to moderate effort until cleared.', 'rtClearance', true)
  if (ids.has('sleep')) cap(6, 'Short sleep: keep today’s effort moderate.', undefined, true)
  if (ids.has('pregnancy')) cap(6, 'Pregnancy: keep to moderate effort and ask your midwife or doctor.', undefined, true)

  const notChecked: string[] = []
  if (!ev?.meta.sys) notChecked.push('Blood pressure — no reading yet. Measure it before your first session.')
  if (!profile) notChecked.push('Health profile — not filled in, so conditions such as osteoporosis, heart disease or a past fall are not accounted for.')
  const diabetes = has('conditions', 'diabetes') || has('medicines', 'insulin') || has('medicines', 'diabetes-tablets')
  if (diabetes && !ev?.meta.glucose) notChecked.push('Blood glucose — no reading yet. Check it before exercise.')

  const notes: SafetyNote[] = [
    { id: 'breathing', text: 'Never hold your breath during strength exercises: breathe out on the effort.', ruleId: 'breathing' },
    { id: 'warning', text: 'Stop and get checked if you feel chest pain or pressure, dizziness, palpitations or unusual breathlessness.', ruleId: 'warningSigns' },
  ]
  let cooldownMin = 5
  if (has('medicines', 'blood-pressure')) {
    cooldownMin = 10
    notes.push({ id: 'cooldown', text: 'You take blood-pressure medicine, so your cool-down is longer (10 minutes — the length is an AURA rule).', ruleId: 'htnCooldown' })
  }
  if (has('medicines', 'insulin')) notes.push({ id: 'order', text: 'Strength work comes before aerobic work in each session: for type 1 diabetes this lowers the risk of a hypo.', ruleId: 'dmOrder' })

  return {
    plan,
    onHold: !!stop,
    holdReason: stop ? stop.title : null,
    caution,
    lightOnly,
    blocked,
    effortCap,
    notChecked,
    notes,
    cooldownMin,
  }
}

/** Human label for a restriction tag (used in substitution reasons). */
export const TAG_LABEL: Record<ContraTag | Joint, string> = {
  'spinal-flexion': 'forward bending of the spine',
  impact: 'impact',
  'unsupported-balance': 'balance without support',
  standing: 'standing',
  floor: 'getting down to the floor',
  isometric: 'sustained holds',
  vigorous: 'vigorous effort',
  knee: 'knee load',
  hip: 'hip load',
  shoulder: 'shoulder load',
  wrist: 'wrist load',
  back: 'back load',
}

export const conditionLabel = (id: string) => CHOICE_LABEL[id] ?? id
