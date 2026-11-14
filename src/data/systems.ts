import type { VitalKey } from './vitals'

export type SystemId = 'brain' | 'eyes' | 'heart' | 'lungs' | 'metabolism' | 'immune' | 'bones' | 'radiation'

export type BodySystem = {
  id: SystemId
  name: string
  icon: string
  vitals: VitalKey[] // radiation has none; it is derived from the mission profile
  hazard: string // which of NASA's 5 hazards drives it
  hint: string // one-line hover note
  fn: string // what it does
  space: string // how spaceflight affects it
  tips: string[] // what the astronaut can do
  sourceLabel: string
  sourceUrl: string
}

export const SYSTEMS: BodySystem[] = [
  {
    id: 'brain',
    name: 'Brain & Behavior',
    icon: '🧠',
    vitals: ['sleep', 'mood'],
    hazard: 'Isolation & confinement',
    hint: 'Isolation and lost day–night rhythm disturb sleep and mood.',
    fn: 'Controls mood, focus, sleep and decision-making.',
    space:
      'Isolation, confinement, heavy workload and the loss of a natural 24-hour light cycle disrupt sleep and can lower mood and performance.',
    tips: [
      'Keep a fixed sleep schedule and dim the lights 1 hour before sleep.',
      'Avoid caffeine in the 6 hours before sleep.',
      'Schedule personal time and contact with family; talk to a crewmate.',
    ],
    sourceLabel: 'NASA HRP — Behavioral conditions; Inadequate sleep',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-behavioral-conditions-and-psychiatric-disorders/',
  },
  {
    id: 'eyes',
    name: 'Eyes (SANS)',
    icon: '👁️',
    vitals: ['vision'],
    hazard: 'Gravity fields',
    hint: 'About 70% of ISS astronauts show swelling at the back of the eye.',
    fn: 'Vision — essential for procedures, piloting and reading displays.',
    space:
      'Without gravity, body fluids shift toward the head. This can swell the optic disc and flatten the back of the eye, changing near vision (Spaceflight Associated Neuro-ocular Syndrome).',
    tips: [
      'Repeat the vision check for each eye separately.',
      'Use your adjustable “space anticipation” glasses if near vision has blurred.',
      'Report any new blur, headache or blind spot at the next medical conference.',
    ],
    sourceLabel: 'NASA HRP — Risk of SANS',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-spaceflight-associated-neuro-ocular-syndrome-sans/',
  },
  {
    id: 'heart',
    name: 'Heart & Circulation',
    icon: '❤️',
    vitals: ['bp', 'hr'],
    hazard: 'Gravity fields',
    hint: 'The heart works differently when blood no longer pools in the legs.',
    fn: 'Pumps blood, delivering oxygen and nutrients to every organ.',
    space:
      'In microgravity blood shifts headward and the heart works less against gravity. Vessels and heart rhythm can change, and you may feel faint when gravity returns.',
    tips: [
      'Sit still for 5 minutes and measure again.',
      'Drink water and check your salt intake for the day.',
      'Do not skip cardio sessions; note any chest pain, palpitations or dizziness.',
    ],
    sourceLabel: 'NASA HRP — Risk of cardiovascular adaptations',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-cardiovascular-adaptations/',
  },
  {
    id: 'lungs',
    name: 'Lungs & Oxygen',
    icon: '🫁',
    vitals: ['spo2'],
    hazard: 'Hostile / closed environment',
    hint: 'Closed-cabin air quality shows up first in your blood oxygen.',
    fn: 'Bring oxygen into the blood and remove carbon dioxide.',
    space:
      'In a sealed cabin CO₂ can build up: NASA limits it to a 3 mmHg one-hour average, and crews report headaches between about 2.8 and 4.5 mmHg. Spacewalk preparation also changes pressure and oxygen levels. Low blood oxygen affects thinking before you feel breathless.',
    tips: [
      'Warm your hand and re-measure; cold fingers give false low readings.',
      'Check cabin CO₂ and airflow at your location; move to a ventilated area.',
      'Headache, confusion or blue lips with a low reading is an emergency.',
    ],
    sourceLabel: 'NASA HRP — Risk of hypoxia',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-hypoxia/',
  },
  {
    id: 'metabolism',
    name: 'Metabolism & Nutrition',
    icon: '🍽️',
    vitals: ['glucose'],
    hazard: 'Distance from Earth',
    hint: 'A limited food system can lead to under-eating and sugar swings.',
    fn: 'Turns food into energy and keeps blood sugar stable.',
    space:
      'With no resupply, food variety is limited and appetite often drops. Under-nutrition and altered metabolism affect energy, bones, muscles and immunity.',
    tips: [
      'Low value with shakiness or sweating: eat fast-acting sugar now, re-measure in 15 minutes.',
      'Log your meals today; aim to finish your planned calories.',
      'Re-measure tomorrow morning before eating.',
    ],
    sourceLabel: 'NASA HRP — Risk of inadequate food and nutrition',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-inadequate-food-and-nutrition/',
  },
  {
    id: 'immune',
    name: 'Immune System',
    icon: '🛡️',
    vitals: ['temp'],
    hazard: 'Hostile / closed environment',
    hint: 'Stress and radiation weaken immunity; fever is the early sign.',
    fn: 'Defends the body against infections.',
    space:
      'Stress, radiation and poor sleep weaken the immune response. Dormant viruses can reactivate, and microbes spread easily between crew in a closed cabin.',
    tips: [
      'Re-measure temperature in 30 minutes, away from exercise and hot drinks.',
      'Rest, hydrate, and limit close contact with crewmates until you know more.',
      'Note other symptoms: rash, sore throat, cough.',
    ],
    sourceLabel: 'NASA HRP — Risk of altered immune system responses',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-altered-immune-system-responses/',
  },
  {
    id: 'bones',
    name: 'Bones & Muscles',
    icon: '🦴',
    vitals: ['exercise'],
    hazard: 'Gravity fields',
    hint: 'Without loading, bones lose about 1–1.5% density per month.',
    fn: 'Support the body, allow movement and protect organs.',
    space:
      'On 4–6 month missions bones lose on average 1–1.5% of their density per month, and average strength and aerobic fitness drop 10–12% from pre-flight levels. ISS crews counter this with 1.5 hours of resistance and aerobic exercise per day.',
    tips: [
      'Complete today’s resistance session — hips, legs and spine first.',
      'If you missed a session, split it into two shorter ones.',
      'Check vitamin D and calcium intake in your meal plan.',
    ],
    sourceLabel: 'NASA HRP — Risk of spaceflight-induced bone changes',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/',
  },
  {
    id: 'radiation',
    name: 'Radiation Exposure',
    icon: '☢️',
    vitals: [],
    hazard: 'Space radiation',
    hint: 'Whole-body dose accumulates every day beyond Earth’s shield.',
    fn: 'Whole-body exposure — every cell is affected, not one organ.',
    space:
      'Beyond Earth’s magnetic field, galactic cosmic rays and solar particle events raise lifetime cancer risk and can affect the nervous system and heart. Dose only ever goes up.',
    tips: [
      'During a solar particle event, move to the storm shelter immediately.',
      'Sleep and rest in the best-shielded area of the vehicle.',
      'Keep your personal dosimeter on you at all times.',
    ],
    sourceLabel: 'NASA HRP — Risk of radiation-induced cancers',
    sourceUrl: 'https://www.nasa.gov/reference/risk-of-radiation-induced-cancers/',
  },
]

export const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s])) as Record<SystemId, BodySystem>
