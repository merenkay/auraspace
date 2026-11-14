export type Status = 'ok' | 'warn' | 'crit'
export type Source = 'sample' | 'manual' | 'live' | 'sim'

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
}
export type FieldId = keyof Values

export const DEFAULT_VALUES: Values = {
  sys: 128,
  dia: 82,
  hr: 72,
  spo2: 97,
  temp: 36.8,
  glucose: 92,
  sleep: 5.5,
  mood: 3,
  exercise: 130,
  vision: 4,
}

export type Field = {
  id: FieldId
  label: string
  min: number
  max: number
  step: number
  scale?: string[] // if set, rendered as 1..n choice buttons
}

export type VitalKey = 'bp' | 'hr' | 'spo2' | 'temp' | 'glucose' | 'sleep' | 'mood' | 'exercise' | 'vision'

export type VitalDef = {
  key: VitalKey
  label: string
  unit: string
  fields: Field[]
  display: (v: Values) => string
  evaluate: (v: Values) => Status
  ranges: string // human-readable thresholds
  howTo: string // simple measuring instruction
  source: string // where the thresholds come from
}

// Single source of truth for thresholds. Triage is rule-based and works offline.
export const VITALS: VitalDef[] = [
  {
    key: 'bp',
    label: 'Blood Pressure',
    unit: 'mmHg',
    fields: [
      { id: 'sys', label: 'Systolic (upper)', min: 60, max: 250, step: 1 },
      { id: 'dia', label: 'Diastolic (lower)', min: 30, max: 150, step: 1 },
    ],
    display: (v) => `${v.sys}/${v.dia}`,
    evaluate: (v) =>
      v.sys >= 140 || v.dia >= 90 || v.sys < 90 ? 'crit' : v.sys >= 130 || v.dia >= 80 ? 'warn' : 'ok',
    ranges: 'Normal < 130/80 · Elevated 130–139 / 80–89 · High ≥ 140/90 or systolic < 90',
    howTo: 'Rest 5 minutes. Wrap the cuff on your upper arm at heart level, stay still and silent, then press start.',
    source: 'ACC/AHA 2017 blood pressure guideline',
  },
  {
    key: 'hr',
    label: 'Heart Rate',
    unit: 'bpm',
    fields: [{ id: 'hr', label: 'Resting heart rate', min: 20, max: 220, step: 1 }],
    display: (v) => `${Math.round(v.hr)}`,
    evaluate: (v) => (v.hr < 40 || v.hr > 120 ? 'crit' : v.hr < 50 || v.hr > 100 ? 'warn' : 'ok'),
    ranges: 'Normal 50–100 · Watch 40–49 or 101–120 · Alert < 40 or > 120 (at rest)',
    howTo: 'Measure at rest. Use the watch, the cuff reading, or count wrist pulses for 30 s and double it.',
    source: 'Standard clinical resting heart-rate ranges',
  },
  {
    key: 'spo2',
    label: 'Blood Oxygen',
    unit: '% SpO₂',
    fields: [{ id: 'spo2', label: 'SpO₂', min: 50, max: 100, step: 1 }],
    display: (v) => `${Math.round(v.spo2)}`,
    evaluate: (v) => (v.spo2 < 92 ? 'crit' : v.spo2 < 95 ? 'warn' : 'ok'),
    ranges: 'Normal ≥ 95 · Watch 92–94 · Alert < 92',
    howTo: 'Keep your hand still and warm. Read the watch or fingertip oximeter after the value settles.',
    source: 'Standard pulse-oximetry ranges; NASA HRP hypoxia risk',
  },
  {
    key: 'temp',
    label: 'Body Temp',
    unit: '°C',
    fields: [{ id: 'temp', label: 'Body temperature', min: 30, max: 43, step: 0.1 }],
    display: (v) => v.temp.toFixed(1),
    evaluate: (v) => (v.temp > 38 || v.temp < 35 ? 'crit' : v.temp > 37.5 || v.temp < 36.1 ? 'warn' : 'ok'),
    ranges: 'Normal 36.1–37.5 · Watch 37.6–38.0 · Fever > 38.0 or hypothermia < 35',
    howTo: 'Measure before exercise or meals. Hold the thermometer in place until it beeps.',
    source: 'Standard clinical temperature ranges; NASA HRP immune risk',
  },
  {
    key: 'glucose',
    label: 'Blood Sugar',
    unit: 'mg/dL',
    fields: [{ id: 'glucose', label: 'Fasting glucose', min: 20, max: 500, step: 1 }],
    display: (v) => `${Math.round(v.glucose)}`,
    evaluate: (v) =>
      v.glucose >= 126 || v.glucose < 60 ? 'crit' : v.glucose >= 100 || v.glucose < 70 ? 'warn' : 'ok',
    ranges: 'Fasting: Normal 70–99 · Watch 100–125 or 60–69 · Alert ≥ 126 or < 60',
    howTo: 'Measure after 8 hours without food. Clean a fingertip, apply one drop of blood to the test strip.',
    source: 'American Diabetes Association fasting glucose criteria',
  },
  {
    key: 'sleep',
    label: 'Sleep',
    unit: 'hours',
    fields: [{ id: 'sleep', label: 'Sleep last night', min: 0, max: 16, step: 0.5 }],
    display: (v) => v.sleep.toFixed(1),
    evaluate: (v) => (v.sleep < 5 ? 'crit' : v.sleep < 7 ? 'warn' : 'ok'),
    ranges: 'Good ≥ 7 h · Short 5–6.9 h · Alert < 5 h',
    howTo: 'Log the hours you actually slept, not the time spent in your sleep station.',
    source: 'NASA HRP risk: inadequate sleep and irregular schedules',
  },
  {
    key: 'mood',
    label: 'Mood',
    unit: '/ 5',
    fields: [{ id: 'mood', label: 'How do you feel today?', min: 1, max: 5, step: 1, scale: ['😞', '🙁', '😐', '🙂', '😄'] }],
    display: (v) => `${['😞', '🙁', '😐', '🙂', '😄'][v.mood - 1] ?? ''} ${v.mood}`,
    evaluate: (v) => (v.mood <= 2 ? 'crit' : v.mood === 3 ? 'warn' : 'ok'),
    ranges: 'Good 4–5 · Watch 3 · Alert 1–2',
    howTo: 'Answer honestly — this is for you. A low day is normal; a low week is worth talking about.',
    source: 'NASA HRP risk: behavioral conditions and psychiatric disorders',
  },
  {
    key: 'exercise',
    label: 'Exercise',
    unit: 'min today',
    fields: [{ id: 'exercise', label: 'Exercise today (minutes)', min: 0, max: 300, step: 5 }],
    display: (v) => `${Math.round(v.exercise)}`,
    evaluate: (v) => (v.exercise < 60 ? 'crit' : v.exercise < 120 ? 'warn' : 'ok'),
    ranges: 'On target ≥ 120 min · Low 60–119 · Alert < 60',
    howTo: 'Add up resistance and cardio sessions. ISS crews exercise about 2 hours every day.',
    source: 'ISS exercise countermeasure routine; NASA HRP bone and fitness risks',
  },
  {
    key: 'vision',
    label: 'Vision Check',
    unit: '/ 5',
    fields: [{ id: 'vision', label: 'Near-vision sharpness (read the checklist card at arm’s length)', min: 1, max: 5, step: 1, scale: ['1', '2', '3', '4', '5'] }],
    display: (v) => `${v.vision}`,
    evaluate: (v) => (v.vision <= 2 ? 'crit' : v.vision === 3 ? 'warn' : 'ok'),
    ranges: 'Sharp 4–5 · Slight blur 3 · Clear change 1–2',
    howTo: 'Cover one eye and read the smallest line you can on the checklist card. Repeat with the other eye. 5 = as sharp as at launch.',
    source: 'NASA HRP risk: Spaceflight Associated Neuro-ocular Syndrome (SANS)',
  },
]

export const VITAL_BY_KEY = Object.fromEntries(VITALS.map((d) => [d.key, d])) as Record<VitalKey, VitalDef>

export const STATUS_COLOR: Record<Status, string> = { ok: '#34d399', warn: '#fbbf24', crit: '#f87171' }
export const STATUS_LABEL: Record<Status, string> = { ok: 'NOMINAL', warn: 'WATCH', crit: 'ALERT' }

export function worst(list: Status[]): Status {
  return list.includes('crit') ? 'crit' : list.includes('warn') ? 'warn' : 'ok'
}
