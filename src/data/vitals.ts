export type Status = 'ok' | 'warn' | 'crit'
export type Source = 'sample' | 'manual' | 'live' | 'sim' | 'device'

export type Values = {
  sys: number
  dia: number
  hr: number
  spo2: number
  temp: number
  glucose: number
  sleep: number
  mood: number
  exercise: number
  vision: number
  water: number
}
export type FieldId = keyof Values

export const FIELD_IDS: FieldId[] = ['sys', 'dia', 'hr', 'spo2', 'temp', 'glucose', 'sleep', 'mood', 'exercise', 'vision', 'water']

export type Field = {
  id: FieldId
  label: string
  min: number
  max: number
  step: number
  scale?: string[] // rendered as 1..n choice buttons
}

export type VitalKey = 'bp' | 'hr' | 'spo2' | 'temp' | 'glucose' | 'sleep' | 'mood' | 'exercise' | 'vision' | 'water'

export type VitalDef = {
  key: VitalKey
  label: string
  short: string
  unit: string
  fields: Field[]
  primary: FieldId // the field plotted in trends
  display: (v: Values) => string
  evaluate: (v: Values) => Status
  ranges: string
  howTo: string
  source: string
  private?: boolean // hidden from ground crew
}

// Plain-text labels; the entry dialog draws a lucide face for each step (EditVitalModal).
const MOOD = ['Very low', 'Low', 'Okay', 'Good', 'Great']

// Single source of truth for thresholds. Triage is rule-based and works offline;
// AURA explains these results but never sets them.
export const VITALS: VitalDef[] = [
  {
    key: 'bp',
    label: 'Blood pressure',
    short: 'BP',
    unit: 'mmHg',
    primary: 'sys',
    fields: [
      { id: 'sys', label: 'Systolic (upper)', min: 60, max: 250, step: 1 },
      { id: 'dia', label: 'Diastolic (lower)', min: 30, max: 150, step: 1 },
    ],
    display: (v) => `${Math.round(v.sys)}/${Math.round(v.dia)}`,
    evaluate: (v) =>
      v.sys >= 140 || v.dia >= 90 || v.sys < 90 ? 'crit' : v.sys >= 130 || v.dia >= 80 ? 'warn' : 'ok',
    ranges: 'Normal < 130/80 · Elevated 130–139 / 80–89 · High ≥ 140/90 · Low: upper number < 90 is also flagged urgent',
    howTo: 'Rest 5 minutes. Cuff on the upper arm at heart level, stay still and silent, then start.',
    source: 'ACC/AHA 2017 blood pressure guideline',
  },
  {
    key: 'hr',
    label: 'Heart rate',
    short: 'HR',
    unit: 'bpm',
    primary: 'hr',
    fields: [{ id: 'hr', label: 'Resting heart rate', min: 20, max: 220, step: 1 }],
    display: (v) => `${Math.round(v.hr)}`,
    evaluate: (v) => (v.hr < 40 || v.hr > 120 ? 'crit' : v.hr < 50 || v.hr > 100 ? 'warn' : 'ok'),
    ranges: 'Normal 50–100 · Watch 40–49 or 101–120 · Alert < 40 or > 120 at rest',
    howTo: 'Measure at rest with the watch or the cuff, or count wrist pulses for 30 s and double it.',
    source: 'Standard clinical resting heart-rate ranges',
  },
  {
    key: 'spo2',
    label: 'Blood oxygen',
    short: 'SpO₂',
    unit: '%',
    primary: 'spo2',
    fields: [{ id: 'spo2', label: 'SpO₂', min: 50, max: 100, step: 1 }],
    display: (v) => `${Math.round(v.spo2)}`,
    evaluate: (v) => (v.spo2 < 92 ? 'crit' : v.spo2 < 95 ? 'warn' : 'ok'),
    ranges: 'Normal ≥ 95 · Watch 92–94 · Alert < 92',
    howTo: 'Keep your hand still and warm; read the value once it settles.',
    source: 'Standard pulse-oximetry ranges; NASA HRP hypoxia risk',
  },
  {
    key: 'temp',
    label: 'Body temperature',
    short: 'Temp',
    unit: '°C',
    primary: 'temp',
    fields: [{ id: 'temp', label: 'Body temperature', min: 30, max: 43, step: 0.1 }],
    display: (v) => v.temp.toFixed(1),
    evaluate: (v) => (v.temp > 38 || v.temp < 35 ? 'crit' : v.temp > 37.5 || v.temp < 36.1 ? 'warn' : 'ok'),
    ranges: 'Normal 36.1–37.5 · Watch 37.6–38.0 or 35.0–36.0 · Alert: fever > 38.0 or < 35.0',
    howTo: 'Measure before exercise or meals; hold the thermometer until it beeps.',
    source: 'Standard clinical temperature ranges',
  },
  {
    key: 'glucose',
    label: 'Blood sugar',
    short: 'Glucose',
    unit: 'mg/dL',
    primary: 'glucose',
    fields: [{ id: 'glucose', label: 'Fasting glucose', min: 20, max: 500, step: 1 }],
    display: (v) => `${Math.round(v.glucose)}`,
    evaluate: (v) =>
      v.glucose >= 126 || v.glucose < 60 ? 'crit' : v.glucose >= 100 || v.glucose < 70 ? 'warn' : 'ok',
    ranges: 'Fasting: Normal 70–99 · Watch 100–125 or 60–69 · Alert ≥ 126 or < 60',
    howTo: 'Measure after 8 hours without food; one drop of blood on the strip.',
    source: 'American Diabetes Association fasting glucose criteria',
  },
  {
    key: 'sleep',
    label: 'Sleep',
    short: 'Sleep',
    unit: 'h',
    primary: 'sleep',
    fields: [{ id: 'sleep', label: 'Sleep last night (hours)', min: 0, max: 16, step: 0.1 }],
    display: (v) => v.sleep.toFixed(1),
    evaluate: (v) => (v.sleep < 5 ? 'crit' : v.sleep < 7 ? 'warn' : 'ok'),
    ranges: 'Good ≥ 7 h · Short 5–6.9 h · Alert < 5 h',
    howTo: 'Log the hours you actually slept, not time in the sleep station.',
    source: 'NASA OCHMO TB-041: 7–9 h recommended; astronauts average ~6 h',
  },
  {
    key: 'mood',
    label: 'Mood',
    short: 'Mood',
    unit: '/ 5',
    primary: 'mood',
    private: true,
    fields: [{ id: 'mood', label: 'How do you feel today?', min: 1, max: 5, step: 1, scale: MOOD }],
    display: (v) => `${Math.round(v.mood)}`,
    evaluate: (v) => (v.mood <= 2 ? 'crit' : v.mood < 4 ? 'warn' : 'ok'),
    ranges: 'Good 4–5 · Watch 3 · Alert 1–2',
    howTo: 'Answer honestly — this stays between you, AURA and your flight surgeon.',
    source: 'NASA HRP risk: behavioral conditions and psychiatric disorders',
  },
  {
    key: 'exercise',
    label: 'Exercise',
    short: 'Exercise',
    unit: 'min',
    primary: 'exercise',
    fields: [{ id: 'exercise', label: 'Exercise today (minutes)', min: 0, max: 300, step: 5 }],
    display: (v) => `${Math.round(v.exercise)}`,
    evaluate: (v) => (v.exercise < 45 ? 'crit' : v.exercise < 90 ? 'warn' : 'ok'),
    ranges: 'On target ≥ 90 min · Low 45–89 · Alert < 45 (lower cut-offs are demo values)',
    howTo: 'Add up resistance and aerobic sessions. NASA reports ISS crews training 1.5–2 h a day.',
    source: 'NASA HRP — reduced fitness risk (1.5 h/day); NASA Astronaut Exercise (~2 h/day)',
  },
  {
    key: 'vision',
    label: 'Vision check',
    short: 'Vision',
    unit: '/ 5',
    primary: 'vision',
    fields: [{ id: 'vision', label: 'Near-vision sharpness (5 = as sharp as at launch)', min: 1, max: 5, step: 1, scale: ['1', '2', '3', '4', '5'] }],
    display: (v) => `${Math.round(v.vision)}`,
    evaluate: (v) => (v.vision <= 2 ? 'crit' : v.vision === 3 ? 'warn' : 'ok'),
    ranges: 'Sharp 4–5 · Slight blur 3 · Clear change 1–2',
    howTo: 'Cover one eye and read the smallest line on the checklist card; repeat with the other eye.',
    source: 'NASA HRP risk: Spaceflight Associated Neuro-ocular Syndrome (SANS)',
  },
  {
    key: 'water',
    label: 'Water intake',
    short: 'Water',
    unit: 'L',
    primary: 'water',
    fields: [{ id: 'water', label: 'Water today (litres)', min: 0, max: 8, step: 0.1 }],
    display: (v) => v.water.toFixed(1),
    evaluate: (v) => (v.water < 1.5 ? 'crit' : v.water < 2.5 ? 'warn' : 'ok'),
    ranges: 'On target ≥ 2.5 L · Low 1.5–2.4 L · Alert < 1.5 L (lower cut-offs are demo values)',
    howTo: 'Count drinks and rehydrated food water.',
    source: 'NASA OCHMO TB-027: minimum 2.5 L potable water per crew member per day',
  },
]

export const VITAL_BY_KEY = Object.fromEntries(VITALS.map((d) => [d.key, d])) as Record<VitalKey, VitalDef>

export const STATUS_COLOR: Record<Status, string> = { ok: '#4DC588', warn: '#FAC547', crit: '#F75D59' }
export const STATUS_LABEL: Record<Status, string> = { ok: 'Normal', warn: 'Attention', crit: 'Urgent' }
export const STATUS_RANK: Record<Status, number> = { ok: 0, warn: 1, crit: 2 }

export function worst(list: Status[]): Status {
  return list.includes('crit') ? 'crit' : list.includes('warn') ? 'warn' : 'ok'
}
