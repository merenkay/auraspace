// AURA onboard mode: structured, rule-based explanations built only from recorded data and the
// sourced knowledge base. It never invents values, never diagnoses and never changes thresholds.
import { recordsForSystem } from '../data/kb'
import { SYSTEM_BY_ID } from '../data/systems'
import { VITAL_BY_KEY, type VitalKey } from '../data/vitals'
import { baselineOf, seriesOf, timeAgo, VITAL_SYSTEM, type Evaluation } from './health'
import type { Measurement } from './types'

export type AuraAnswer = {
  question: string
  sections: { title: string; text: string }[]
  escalation: { level: 'ok' | 'warn' | 'crit'; text: string }
  refs: { title: string; org: string; url: string }[]
  confidence: string
  reviewed: number
}

const HYPOTHESES: Record<VitalKey, string> = {
  bp: 'Short sleep, stress or workload, caffeine, fluid shifts in microgravity, or a reading taken without rest.',
  hr: 'Recent exercise, stress, poor sleep, dehydration or fever.',
  spo2: 'Cold fingers or movement during the reading, cabin CO₂ or airflow, or a respiratory problem.',
  temp: 'Recent exercise or a hot drink, an infection, or a warm cabin.',
  glucose: 'A recent meal, stress, changes in activity or diet.',
  sleep: 'Schedule shifts, light exposure, noise, workload or stress.',
  mood: 'Isolation, workload, poor sleep, conflict or distance from family.',
  exercise: 'Schedule pressure, equipment availability, fatigue or a minor injury.',
  vision: 'Fluid shift toward the head (SANS), eye strain or dry eyes.',
  water: 'Busy schedule, reduced thirst in microgravity, or forgetting to log drinks.',
}

const MISSING: Record<VitalKey, string> = {
  bp: 'A rested repeat measurement and an ECG this week.',
  hr: 'A resting repeat and symptom notes (palpitations, dizziness).',
  spo2: 'A repeat with a warm hand and the cabin CO₂ reading at the same time.',
  temp: 'A repeat in 30 minutes and other symptoms (sore throat, rash, cough).',
  glucose: 'A confirmed fasting repeat and today’s meal log.',
  sleep: 'Light-exposure and caffeine timing logs.',
  mood: 'How you are sleeping and whether anything specific is weighing on you.',
  exercise: 'Reported fatigue and any pain during sessions.',
  vision: 'A professional OCT or fundoscopy exam.',
  water: 'Urine colour and any symptoms such as headache.',
}

const NEXT: Record<VitalKey, string> = {
  bp: 'Sit quietly for 5 minutes, cuff at heart level, and measure again.',
  hr: 'Rest for 5 minutes and re-measure.',
  spo2: 'Warm your hand, sit still and re-measure; check the cabin CO₂ panel.',
  temp: 'Re-measure in 30 minutes away from exercise and hot drinks; rest and hydrate.',
  glucose: 'Re-measure tomorrow morning before eating and log today’s meals.',
  sleep: 'Keep a fixed sleep window tonight and dim lights an hour before sleep.',
  mood: 'Take a break, talk to a crewmate you trust, and book a private conference if you would like one.',
  exercise: 'Complete the prescribed session; split it in two if your schedule is tight.',
  vision: 'Repeat the vision and Amsler grid checks for each eye.',
  water: 'Drink a glass now and log each drink for the rest of the day.',
}

export const KEYWORDS: [RegExp, VitalKey][] = [
  [/blood pressure|\bbp\b|tansiyon|systolic|diastolic/i, 'bp'],
  [/heart rate|pulse|nab[ıi]z|\bhr\b/i, 'hr'],
  [/oxygen|spo2|saturation|oksijen/i, 'spo2'],
  [/temp|fever|ate[sş]|s[ıi]cakl[ıi]k/i, 'temp'],
  [/sugar|glucose|[şs]eker/i, 'glucose'],
  [/sleep|uyku|tired|yorgun/i, 'sleep'],
  [/mood|sad|stress|ruh|mutsuz|stres/i, 'mood'],
  [/exercise|workout|ared|egzersiz|spor/i, 'exercise'],
  [/vision|eye|blur|g[öo]z|g[öo]rme/i, 'vision'],
  [/water|hydrat|drink|su\b|s[ıi]v[ıi]/i, 'water'],
]

export function topicFor(text: string): VitalKey | null {
  for (const [re, k] of KEYWORDS) if (re.test(text)) return k
  return null
}

export function answer(key: VitalKey, question: string, ev: Evaluation, rows: Measurement[], today: number): AuraAnswer {
  const d = VITAL_BY_KEY[key]
  const sys = SYSTEM_BY_ID[VITAL_SYSTEM[key]]
  const st = ev.vitalStatus[key]
  const meta = ev.meta[d.primary]
  if (!st || !meta) {
    return {
      question,
      sections: [{ title: 'WHAT I OBSERVED', text: `There is no ${d.label.toLowerCase()} reading I can access. I will not assume it is normal.` }],
      escalation: { level: 'warn', text: 'Record a measurement first, or ask the flight surgeon if you have symptoms.' },
      refs: [],
      confidence: 'None — no data',
      reviewed: 0,
    }
  }
  const base = baselineOf(rows, d.primary)
  const last7 = seriesOf(rows, d.primary, 7, today)
  const prev7 = seriesOf(rows, d.primary, 14, today).filter((p) => p.day <= today - 7)
  const avg = (a: { value: number }[]) => (a.length ? a.reduce((s, p) => s + p.value, 0) / a.length : null)
  const a7 = avg(last7)
  const p7 = avg(prev7)
  const digits = d.primary === 'temp' || d.primary === 'sleep' || d.primary === 'water' ? 1 : 0
  const fmt = (n: number) => n.toFixed(digits)

  let trend = ''
  if (a7 != null && p7 != null && Math.abs(a7 - p7) > (digits ? 0.15 : 1.5)) {
    trend = ` Your 7-day average (${fmt(a7)}) is ${a7 > p7 ? 'higher' : 'lower'} than the week before (${fmt(p7)}).`
  } else if (a7 != null) {
    trend = ` Your 7-day average is ${fmt(a7)}, stable versus the week before.`
  }

  const observed =
    `${d.label} is ${d.display(ev.values)} ${d.unit} (${meta.device}, ${timeAgo(meta.at)}).` +
    (base != null ? ` Your early-mission baseline was ${fmt(base)}.` : '') +
    trend
  const n = last7.length + prev7.length
  const confidence = st === 'ok' ? 'Moderate — readings are consistent' : n >= 10 ? 'Moderate — a clear trend from one device' : 'Low — few readings'

  const escalation =
    st === 'crit'
      ? { level: 'crit' as const, text: 'Follow the onboard protocol now and contact the flight surgeon. Include this finding in today’s report — do not wait for it to resolve on its own.' }
      : st === 'warn'
        ? { level: 'warn' as const, text: 'Not urgent. If a repeat measurement stays out of range, tell the crew medical officer and include it in today’s flight-surgeon report.' }
        : { level: 'ok' as const, text: 'No professional review needed for this reading. Keep the regular schedule.' }

  const refs = recordsForSystem(sys.id)
    .slice(0, 2)
    .map((r) => ({ title: r.title, org: r.organization, url: r.url }))

  return {
    question,
    sections: [
      { title: 'WHAT I OBSERVED', text: observed },
      { title: 'WHY IT MAY MATTER', text: sys.space.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.') },
      { title: 'POSSIBLE EXPLANATIONS', text: `${HYPOTHESES[key]} These are hypotheses, not findings.` },
      { title: 'WHAT IS MISSING', text: MISSING[key] },
      { title: 'HOW CERTAIN', text: confidence },
      { title: 'WHAT TO DO NEXT', text: NEXT[key] },
    ],
    escalation,
    refs: [...refs, { title: d.source, org: 'Threshold source', url: sys.sourceUrl }],
    confidence,
    reviewed: n,
  }
}
