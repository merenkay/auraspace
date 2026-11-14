// First-aid medicine checks: every item is the source's own wording. The person's recorded allergies,
// conditions and medicines suppress or flag items using the tags on each sourced caution.
import type { Context } from '../../data/contexts'
import { CHOICE_LABEL, type HealthProfile } from '../../data/conditions/profile'
import type { MedCaution, MedEvidence } from '../../data/conditions/types'

export type MedStatus = 'suggested' | 'check-first' | 'if-prescribed' | 'not-for-you'

export type MedAdvice = {
  name: string
  purpose: string
  quote: string
  source: string
  status: MedStatus
  reasons: string[]
  matched: MedCaution[]
  cautions: MedCaution[]
  confirmWith: string
}

type Hit = { level: 'avoid' | 'check'; label: string }

/** Maps a caution tag to the profile entry that triggers it. */
function tagHit(tag: string, p: HealthProfile, suspectedStroke: boolean): Hit | null {
  const has = (list: string[], id: string) => list.includes(id)
  const [kind, val] = tag.split(':')
  if (tag === 'condition:suspected-stroke') return suspectedStroke ? { level: 'avoid', label: 'a stroke is also suspected' } : null
  if (kind === 'allergy') {
    const ids = val === 'aspirin' ? ['aspirin'] : val === 'nsaid' ? ['nsaid', 'aspirin'] : val === 'ibuprofen' ? ['nsaid'] : val === 'paracetamol' ? ['paracetamol'] : []
    const id = ids.find((x) => has(p.allergies, x))
    return id ? { level: 'avoid', label: `you are allergic to ${CHOICE_LABEL[id].toLowerCase()}` } : null
  }
  const COND: Record<string, string> = {
    asthma: 'asthma', 'stomach-ulcer': 'stomach-ulcer', 'bleeding-disorder': 'bleeding-disorder', kidney: 'kidney-disease', 'kidney-disease': 'kidney-disease',
    liver: 'liver-disease', 'liver-disease': 'liver-disease', 'heart-failure': 'heart-failure', heart: 'heart-disease', 'heart-disease': 'heart-disease',
    stroke: 'previous-stroke', 'previous-stroke': 'previous-stroke', pregnancy: 'pregnancy', diabetes: 'diabetes',
  }
  const MED: Record<string, string> = {
    anticoagulant: 'anticoagulant', warfarin: 'anticoagulant', antidepressant: 'antidepressant', antihypertensive: 'blood-pressure', steroid: 'steroid', nsaid: 'nsaid-regular',
  }
  if (kind === 'condition' || tag === 'pregnancy') {
    const id = COND[tag === 'pregnancy' ? 'pregnancy' : val]
    return id && has(p.conditions, id) ? { level: 'check', label: `your record lists ${CHOICE_LABEL[id].toLowerCase()}` } : null
  }
  if (kind === 'med' || kind === 'interaction') {
    const id = MED[val]
    return id && has(p.medicines, id) ? { level: 'check', label: `you take ${CHOICE_LABEL[id].toLowerCase()}` } : null
  }
  return null
}

/** The medicine needs to be the person's own prescribed device or medicine. */
function requiredMedicine(name: string): string | null {
  if (/GTN|glyceryl/i.test(name)) return 'gtn'
  if (/adrenaline/i.test(name)) return 'adrenaline-autoinjector'
  if (/reliever/i.test(name)) return 'reliever-inhaler'
  return null
}

/** Items from NASA operational sources are only offered in the space context. */
export function spaceOnly(name: string): boolean {
  return /promethazine|ondansetron|opioid|analgesics/i.test(name)
}

export function confirmLine(ctx: Context): string {
  if (ctx === 'space') return 'The crew medical officer confirms use from the onboard medical kit, together with the flight surgeon.'
  if (ctx === 'polar') return 'The station doctor confirms use from the station’s medical supplies.'
  return 'Confirm with the emergency operator, your doctor or a pharmacist.'
}

export function adviseMeds(meds: MedEvidence[] | undefined, ctx: Context, profile: HealthProfile | null, suspectedStroke: boolean): MedAdvice[] {
  const out: MedAdvice[] = []
  for (const m of meds ?? []) {
    if (ctx !== 'space' && spaceOnly(m.name)) continue
    const reasons: string[] = []
    const matched: MedCaution[] = []
    let avoid = false
    let check = false
    for (const c of m.cautions) {
      const hits = c.tags.map((t) => tagHit(t, profile ?? { ageBand: null, conditions: [], allergies: [], medicines: [], notes: '', updatedAt: null }, suspectedStroke)).filter((h): h is Hit => !!h)
      if (!hits.length) continue
      matched.push(c)
      for (const h of hits) {
        if (h.level === 'avoid') avoid = true
        else check = true
        const line = `Not suggested because ${h.label}.`
        const flag = `Check first because ${h.label}.`
        const text = h.level === 'avoid' ? line : flag
        if (!reasons.includes(text)) reasons.push(text)
      }
    }
    const need = requiredMedicine(m.name)
    let status: MedStatus = avoid ? 'not-for-you' : check ? 'check-first' : 'suggested'
    if (!avoid && need && !profile?.medicines.includes(need)) {
      status = 'if-prescribed'
      reasons.push('Only if it has been prescribed for you (your record does not list it).')
    }
    if (!profile || !profile.updatedAt) {
      if (status === 'suggested') status = 'check-first'
      reasons.push('Your health profile is empty, so AURA cannot check your allergies or medicines. Read the cautions first.')
    }
    const purpose = ctx === 'home' ? m.purpose : m.purpose.replace(/\b(?:the |an )?ambulance\b/gi, 'help')
    out.push({ name: m.name, purpose, quote: m.q, source: m.s, status, reasons, matched, cautions: m.cautions, confirmWith: confirmLine(ctx) })
  }
  return out
}
