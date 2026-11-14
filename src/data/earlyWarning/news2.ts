// NEWS2 (Royal College of Physicians, 2017) transcribed from the official charts. Do not edit the numbers:
// the RCP asks that "the standardised scoring systems and alert thresholds that underpin the NEWS remain unaltered".
// Chart 1 (scoring): https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf
// Chart 2 (triggers): https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf
// SpO2 Scale 2 is deliberately absent: the chart says "ONLY use Scale 2 under the direction of a qualified clinician".

/** Inclusive band [lo, hi] on the chart's recording precision; a missing bound is open-ended (≤ / ≥). */
export type News2Band = { score: 0 | 1 | 2 | 3; lo?: number; hi?: number }

export type News2Param = 'rr' | 'spo2' | 'o2' | 'sys' | 'pulse' | 'acvpu' | 'temp'

/** The seven NEWS2 parameters in chart order (ABCDE): six physiological + supplemental oxygen. */
export const NEWS2_PARAMS: News2Param[] = ['rr', 'spo2', 'o2', 'sys', 'pulse', 'acvpu', 'temp']

export const NEWS2_LABEL: Record<News2Param, string> = {
  rr: 'Respiration rate',
  spo2: 'Oxygen saturation (Scale 1)',
  o2: 'Air or oxygen',
  sys: 'Systolic blood pressure',
  pulse: 'Pulse',
  acvpu: 'Consciousness',
  temp: 'Temperature',
}

export const NEWS2_UNIT: Partial<Record<News2Param, string>> = { rr: '/min', spo2: '%', sys: 'mmHg', pulse: '/min', temp: '°C' }

/** Decimal places the chart records each numeric parameter with (temperature to 0.1 °C, the rest whole numbers). */
export const NEWS2_DECIMALS: Record<'rr' | 'spo2' | 'sys' | 'pulse' | 'temp', number> = { rr: 0, spo2: 0, sys: 0, pulse: 0, temp: 1 }

export const NEWS2_BANDS: Record<'rr' | 'spo2' | 'sys' | 'pulse' | 'temp', News2Band[]> = {
  // Respiration rate (per minute): ≤8 → 3 | 9–11 → 1 | 12–20 → 0 | 21–24 → 2 | ≥25 → 3
  rr: [
    { score: 3, hi: 8 },
    { score: 1, lo: 9, hi: 11 },
    { score: 0, lo: 12, hi: 20 },
    { score: 2, lo: 21, hi: 24 },
    { score: 3, lo: 25 },
  ],
  // SpO2 Scale 1 (%): ≤91 → 3 | 92–93 → 2 | 94–95 → 1 | ≥96 → 0
  spo2: [
    { score: 3, hi: 91 },
    { score: 2, lo: 92, hi: 93 },
    { score: 1, lo: 94, hi: 95 },
    { score: 0, lo: 96 },
  ],
  // Systolic blood pressure (mmHg): ≤90 → 3 | 91–100 → 2 | 101–110 → 1 | 111–219 → 0 | ≥220 → 3
  sys: [
    { score: 3, hi: 90 },
    { score: 2, lo: 91, hi: 100 },
    { score: 1, lo: 101, hi: 110 },
    { score: 0, lo: 111, hi: 219 },
    { score: 3, lo: 220 },
  ],
  // Pulse (per minute): ≤40 → 3 | 41–50 → 1 | 51–90 → 0 | 91–110 → 1 | 111–130 → 2 | ≥131 → 3
  pulse: [
    { score: 3, hi: 40 },
    { score: 1, lo: 41, hi: 50 },
    { score: 0, lo: 51, hi: 90 },
    { score: 1, lo: 91, hi: 110 },
    { score: 2, lo: 111, hi: 130 },
    { score: 3, lo: 131 },
  ],
  // Temperature (°C): ≤35.0 → 3 | 35.1–36.0 → 1 | 36.1–38.0 → 0 | 38.1–39.0 → 1 | ≥39.1 → 2
  temp: [
    { score: 3, hi: 35.0 },
    { score: 1, lo: 35.1, hi: 36.0 },
    { score: 0, lo: 36.1, hi: 38.0 },
    { score: 1, lo: 38.1, hi: 39.0 },
    { score: 2, lo: 39.1 },
  ],
}

/** Air or oxygen? Chart 1: Oxygen → 2, Air → 0. */
export const NEWS2_O2_SCORE = { air: 0, oxygen: 2 } as const

/** Consciousness (ACVPU). Chart 1: Alert → 0, CVPU → 3. "C" is new confusion. */
export type Acvpu = 'A' | 'C' | 'V' | 'P' | 'U'
export const ACVPU_LABEL: Record<Acvpu, string> = {
  A: 'Alert',
  C: 'New confusion or disorientation',
  V: 'Responds only to voice',
  P: 'Responds only to pain',
  U: 'Unresponsive',
}
export const NEWS2_ACVPU_SCORE: Record<Acvpu, 0 | 3> = { A: 0, C: 3, V: 3, P: 3, U: 3 }

/** Chart 2 wording, verbatim. Only ever shown for a complete score (all seven parameters). */
export type News2Trigger = 'low' | 'red' | 'medium' | 'high'
export const NEWS2_TRIGGER: Record<News2Trigger, { band: string; risk: string; response: string }> = {
  low: { band: 'Aggregate score 0–4', risk: 'Low', response: 'Ward-based response' },
  red: { band: 'Red score: Score of 3 in any individual parameter', risk: 'Low–medium', response: 'Urgent ward-based response*' },
  medium: { band: 'Aggregate score 5–6', risk: 'Medium', response: 'Key threshold for urgent response*' },
  high: { band: 'Aggregate score 7 or more', risk: 'High', response: 'Urgent or emergency response**' },
}
export const NEWS2_FOOTNOTES = [
  '* Response by a clinician or team with competence in the assessment and treatment of acutely ill patients and in recognising when the escalation of care to a critical care team is appropriate.',
  '** The response team must also include staff with critical care skills, including airway management.',
]

/** Who NEWS2 is for, in RCP's words (Executive summary, recommendations 1–3). */
export const NEWS2_POPULATION =
  'NEWS2 was developed and validated for adults (16 years or older) with acute illness in hospital and ambulance care. The RCP says it should not be used in children or in pregnancy, and it has not been validated for spaceflight, remote stations or self-measurement at home.'
