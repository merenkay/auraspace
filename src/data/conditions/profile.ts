// Health-profile vocabulary: known conditions, allergies and current medicines the person can record.
// The consultation engine uses it to weigh conditions and to suppress or flag first-aid medicines.
import type { AgeBand } from './types'

export type HealthProfile = {
  ageBand: AgeBand | null
  conditions: string[]
  allergies: string[]
  medicines: string[]
  notes: string
  updatedAt: string | null
  /** Demo crew records are simulated and say so in the UI. */
  simulated?: boolean
}

export type Choice = { id: string; label: string }

export const AGE_BANDS: Choice[] = [
  { id: 'under-40', label: 'Under 40' },
  { id: '40-64', label: '40–64' },
  { id: '65-79', label: '65–79' },
  { id: '80+', label: '80 or over' },
]

export const KNOWN_CONDITIONS: Choice[] = [
  { id: 'hypertension', label: 'High blood pressure' },
  { id: 'heart-disease', label: 'Heart disease or a previous heart attack' },
  { id: 'angina', label: 'Angina' },
  { id: 'heart-failure', label: 'Heart failure' },
  { id: 'previous-stroke', label: 'Previous stroke or mini-stroke' },
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'asthma', label: 'Asthma' },
  { id: 'copd', label: 'COPD' },
  { id: 'severe-allergy', label: 'Severe allergic reaction (anaphylaxis) in the past' },
  { id: 'kidney-disease', label: 'Kidney disease' },
  { id: 'kidney-stones', label: 'Kidney stones in the past' },
  { id: 'liver-disease', label: 'Liver disease' },
  { id: 'stomach-ulcer', label: 'Stomach ulcer or stomach bleeding' },
  { id: 'bleeding-disorder', label: 'Bleeding disorder' },
  { id: 'osteoporosis', label: 'Osteoporosis (fragile bones)' },
  { id: 'falls-history', label: 'A fall in the last year' },
  { id: 'panic-disorder', label: 'Panic attacks or anxiety disorder' },
  { id: 'depression', label: 'Depression' },
  { id: 'pregnancy', label: 'Pregnant' },
]

export const ALLERGIES: Choice[] = [
  { id: 'aspirin', label: 'Aspirin' },
  { id: 'nsaid', label: 'Ibuprofen or other anti-inflammatory painkillers (NSAIDs)' },
  { id: 'paracetamol', label: 'Paracetamol' },
  { id: 'penicillin', label: 'Penicillin' },
  { id: 'nuts', label: 'Peanuts or tree nuts' },
  { id: 'insect-stings', label: 'Bee or wasp stings' },
  { id: 'latex', label: 'Latex' },
]

export const MEDICINES: Choice[] = [
  { id: 'anticoagulant', label: 'Blood thinner (e.g. warfarin, apixaban, rivaroxaban)' },
  { id: 'antiplatelet', label: 'Clopidogrel or daily low-dose aspirin' },
  { id: 'blood-pressure', label: 'Blood-pressure medicine' },
  { id: 'gtn', label: 'GTN spray for angina' },
  { id: 'insulin', label: 'Insulin' },
  { id: 'diabetes-tablets', label: 'Diabetes tablets (e.g. gliclazide)' },
  { id: 'reliever-inhaler', label: 'Blue reliever inhaler' },
  { id: 'adrenaline-autoinjector', label: 'Adrenaline auto-injector (e.g. EpiPen)' },
  { id: 'antidepressant', label: 'Antidepressant' },
  { id: 'steroid', label: 'Steroid tablets' },
  { id: 'nsaid-regular', label: 'Regular anti-inflammatory painkillers' },
  { id: 'diuretic', label: 'Water tablets (diuretics)' },
]

const ALL = [...KNOWN_CONDITIONS, ...ALLERGIES, ...MEDICINES, ...AGE_BANDS]
export const CHOICE_LABEL: Record<string, string> = Object.fromEntries(ALL.map((c) => [c.id, c.label]))

export function emptyProfile(): HealthProfile {
  return { ageBand: null, conditions: [], allergies: [], medicines: [], notes: '', updatedAt: null }
}

const pick = (list: unknown, allowed: Choice[]) =>
  Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string' && allowed.some((c) => c.id === x)))] : []

/** Keeps only known ids; used for storage reads and before saving. */
export function cleanProfile(p: unknown): HealthProfile {
  const o = (p ?? {}) as Partial<HealthProfile>
  return {
    ageBand: AGE_BANDS.some((a) => a.id === o.ageBand) ? (o.ageBand as AgeBand) : null,
    conditions: pick(o.conditions, KNOWN_CONDITIONS),
    allergies: pick(o.allergies, ALLERGIES),
    medicines: pick(o.medicines, MEDICINES),
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 300) : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    ...(o.simulated ? { simulated: true } : {}),
  }
}
