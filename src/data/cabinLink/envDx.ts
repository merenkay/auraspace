// Sourced associations between the measured room/cabin environment and reported symptoms, used by the
// environment-aware consultation (src/lib/cabinLink/envDx.ts). Every `q` is a verbatim quote from the page in
// CABIN_SOURCES (fetched 14 Nov 2026). Weights, discounts and time windows are AURA's own rules and are
// labelled "AURA rule" where they are shown.
//
// Deliberately NOT treated as "expected in heat": a fast heartbeat and breathlessness. The NHS lists both
// among the signs of heatstroke ("a fast heartbeat", "fast breathing or shortness of breath"), so in a hot
// room AURA flags them for a re-check instead of explaining them away.
import type { Cited, Condition } from '../conditions/types'

export type EnvFactor = 'heat' | 'cold' | 'dry'

export type Expectation = {
  finding: string
  factor: EnvFactor
  /** physiological = the body's normal response; strain = an early, usually self-limiting heat-strain sign. */
  kind: 'physiological' | 'strain'
  cite: Cited
}

export const SWEAT_NORMAL: Cited = {
  t: 'Sweating is how the body cools down; sweating when the body does not need to cool down is what counts as excessive.',
  q: "you may be sweating excessively if you're sweating when your body does not need to cool down",
  s: 'nhs-sweating',
}
export const THIRST_HEAT: Cited = { t: 'Being in a hot environment for too long can dehydrate you; feeling thirsty is the first sign.', q: 'have been in the sun, or a hot environment, too long', s: 'nhs-dehydration' }
export const HEAT_EXHAUSTION_SIGNS: Cited = {
  t: 'Tiredness, dizziness, headache, feeling sick, cramps and heavy sweating are signs of heat exhaustion.',
  q: 'The symptoms of heat exhaustion include: ... tiredness ... dizziness ... headache',
  s: 'nhs-heat',
}
export const HEAT_30_MIN: Cited = { t: 'Heat exhaustion usually settles without emergency help if you can cool down within 30 minutes.', q: 'Heat exhaustion does not usually need emergency medical help if you can cool down within 30 minutes.', s: 'nhs-heat' }
export const HEATSTROKE_NOT_EASED: Cited = {
  t: 'Still being unwell after 30 minutes of resting somewhere cool and drinking is a sign of heatstroke — get emergency help.',
  q: 'still being unwell after 30 minutes of resting in a cool place, being cooled and drinking fluids',
  s: 'nhs-heat',
}
export const HEATSTROKE_HEART_BREATH: Cited = { t: 'In the heat, a fast heartbeat or fast breathing / shortness of breath can be signs of heatstroke.', q: 'a fast heartbeat … fast breathing or shortness of breath', s: 'nhs-heat' }
export const HEATSTROKE_SKIN: Cited = { t: 'Hot skin that is not sweating, confusion or loss of consciousness are signs of heatstroke.', q: "hot skin that's not sweating and might look red", s: 'nhs-heat' }
export const HUMID_SWEAT: Cited = { t: 'High humidity makes it harder for the body to cool itself by sweating.', q: 'High relative humidity makes it difficult for the body to cool itself through sweating.', s: 'osha-heat' }
export const HIGH_TEMP_HEAT: Cited = { t: 'A high temperature can be a sign of heat exhaustion.', q: 'a high temperature', s: 'nhs-heat' }
export const CHILLS_COLD: Cited = { t: 'Chills are the body’s way of producing heat when it feels cold.', q: "They are the body's way of producing heat when it feels cold.", s: 'medline-chills' }
export const CHILLS_INFECTION: Cited = { t: 'Chills can also be caused by an infection.', q: 'Any infections', s: 'medline-chills' }
export const DRY_EYES: Cited = { t: 'Heated or air-conditioned rooms and dry air can cause dry, sore or gritty eyes.', q: "you spend time in air conditioned or heated environments … it's windy, dry or dusty", s: 'nhs-dry-eyes' }
export const DRY_EYES_URGENT: Cited = { t: 'Get urgent advice if an eye is painful and red.', q: 'your eye is painful and red', s: 'nhs-dry-eyes' }
export const BREATH_999: Cited = { t: 'Severe difficulty breathing, a tight or heavy chest, or blue-grey lips need emergency help.', q: 'you have severe difficulty breathing', s: 'nhs-breath' }
export const DHT11_ACCURACY: Cited = { t: 'The DHT11 reads temperature to about ±2 °C and humidity to about ±5 %.', q: 'Good for 0-50°C temperature readings ±2°C accuracy', s: 'adafruit-dht' }
export const HI_SHADE: Cited = { t: 'Heat index values assume shade and light wind.', q: 'heat index values were devised for shady, light wind conditions', s: 'nws-heat-tools' }
export const HI_EQUATION: Cited = { t: 'Heat index computed with NOAA’s published Rothfusz regression and adjustments.', q: 'HI = -42.379 + 2.04901523*T + 10.14333127*RH', s: 'noaa-hi-equation' }

/** Symptoms the measured environment can explain (only with fresh readings and the factor present now). */
export const EXPECTATIONS: Expectation[] = [
  { finding: 'sweating', factor: 'heat', kind: 'physiological', cite: SWEAT_NORMAL },
  { finding: 'thirst', factor: 'heat', kind: 'physiological', cite: THIRST_HEAT },
  { finding: 'fatigue', factor: 'heat', kind: 'strain', cite: HEAT_EXHAUSTION_SIGNS },
  { finding: 'headache', factor: 'heat', kind: 'strain', cite: HEAT_EXHAUSTION_SIGNS },
  { finding: 'lightheaded', factor: 'heat', kind: 'strain', cite: HEAT_EXHAUSTION_SIGNS },
  { finding: 'cramps', factor: 'heat', kind: 'strain', cite: { t: 'Cramps in the arms, legs and stomach are a sign of heat exhaustion.', q: 'cramps in the arms, legs and stomach', s: 'nhs-heat' } },
  { finding: 'nausea', factor: 'heat', kind: 'strain', cite: { t: 'Feeling sick is a sign of heat exhaustion.', q: 'feeling sick (nausea)', s: 'nhs-heat' } },
  { finding: 'chills', factor: 'cold', kind: 'physiological', cite: CHILLS_COLD },
  { finding: 'eye-throat-irritation', factor: 'dry', kind: 'physiological', cite: DRY_EYES },
]

/** In heat these are NOT explained away: flagged for a re-check (NHS heatstroke signs). */
export const HEAT_WATCH: Record<string, Cited> = { palpitations: HEATSTROKE_HEART_BREATH, breathless: HEATSTROKE_HEART_BREATH, 'fast-breathing': HEATSTROKE_HEART_BREATH }

/** Heatstroke signs from the NHS list that, in a hot room now, make it an emergency (raise only). */
export const HEATSTROKE_FINDINGS = ['hot-skin-no-sweat', 'confusion', 'collapse', 'heat-not-eased']

/**
 * Severity findings: when any is reported, nothing is explained by the environment (AURA rule from the
 * request: severe, sudden, at rest, with chest pain, with confusion, blue lips, fainting).
 */
export const SEVERITY_FINDINGS = [
  'chest-pain', 'pain-spread', 'confusion', 'pale-blue-skin', 'collapse', 'severe-headache', 'hot-skin-no-sweat', 'speech', 'one-side-weak', 'face-droop',
  'vision-loss', 'throat-swelling', 'self-harm', 'breathless-rest', 'heat-not-eased', 'eye-red-painful', 'drowsy',
]

/** Severity words in free text (English + folded Turkish). */
export const SEVERITY_TEXT = /\b(?:severe|severely|sudden|suddenly|worst|unbearable|at rest|while resting|sitting still|can'?t breathe|cannot breathe|blue lips|faint(?:ed|ing)?|passed out|siddetli|aniden|ani\b|dinlenirken|nefes alamiyorum|bayil)/

/** Benign, environment-related explanations offered as candidates (never strong, always self-care with a re-check). */
const ALL = ['space', 'polar', 'home'] as Condition['contexts']

export const ENV_CONDITIONS: Record<EnvFactor, Condition> = {
  heat: {
    id: 'env-heat-strain',
    name: 'Heat strain from a hot room',
    blurb: 'The body is working to shed heat. It usually settles within 30 minutes of cooling down and drinking; if it does not, treat it as heatstroke.',
    system: 'metabolism',
    contexts: ALL,
    urgency: 'selfcare',
    findings: [],
    ev: {
      summary: [HEAT_30_MIN],
      action: [
        { t: 'Move to a cool place.', q: 'Move them to a cool place.', s: 'nhs-heat' },
        { t: 'Remove unnecessary clothing.', q: 'Remove all unnecessary clothing like a jacket or socks.', s: 'nhs-heat' },
        { t: 'Drink plenty of water.', q: 'Give them plenty of water to drink', s: 'nhs-heat' },
        { t: 'Cool the skin with cool water and a fan.', q: 'Cool their skin – spray or sponge them with cool water and fan them.', s: 'nhs-heat' },
      ],
      redflag: [HEATSTROKE_NOT_EASED, HEATSTROKE_SKIN, HEATSTROKE_HEART_BREATH],
      monitor: [{ t: 'Check again after 30 minutes of cooling down.', q: 'if you can cool down within 30 minutes', s: 'nhs-heat' }],
    },
  },
  cold: {
    id: 'env-cold-stress',
    name: 'Feeling cold in a cold room',
    blurb: 'Shivering is how the body makes heat in the cold. Warm up; if chills come with a fever, an infection is more likely.',
    system: 'metabolism',
    contexts: ALL,
    urgency: 'selfcare',
    findings: [],
    ev: {
      summary: [CHILLS_COLD],
      action: [{ t: 'Warm up: if fully awake, have a warm non-alcoholic drink and something sugary.', q: "give them a warm non-alcoholic drink and some sugary food like chocolate if they're fully awake", s: 'nhs-hypothermia' }],
      redflag: [CHILLS_INFECTION],
    },
  },
  dry: {
    id: 'env-dry-air',
    name: 'Irritation from dry air',
    blurb: 'Very dry, heated or air-conditioned air can make eyes dry, sore or gritty.',
    system: 'eyes',
    contexts: ALL,
    urgency: 'selfcare',
    findings: [],
    ev: {
      summary: [DRY_EYES],
      action: [
        { t: 'Use a humidifier to stop the air getting dry.', q: 'use a humidifier to stop the air getting dry', s: 'nhs-dry-eyes' },
        { t: 'Take breaks to rest your eyes from screens.', q: 'take breaks to rest your eyes when watching TV or using a computer screen', s: 'nhs-dry-eyes' },
      ],
      redflag: [DRY_EYES_URGENT, { t: 'Any change to your sight needs emergency help.', q: 'you have any changes to your sight, like wavy lines, flashing or loss of vision', s: 'nhs-dry-eyes' }],
    },
  },
}

/** The discriminating follow-up per factor (finding id asked next when the explanation is offered). */
export const FOLLOW_UP: Record<EnvFactor, { id: string; cite: Cited }> = {
  heat: { id: 'heat-not-eased', cite: HEATSTROKE_NOT_EASED },
  cold: { id: 'fever', cite: CHILLS_INFECTION },
  dry: { id: 'eye-red-painful', cite: DRY_EYES_URGENT },
}
