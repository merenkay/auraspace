// Sourced statements that link the cabin-air sensor station (DHT11 temperature/humidity + MQ-2 flammable gas)
// to symptoms and first steps. Same shape as the condition knowledge base: plain text `t`, verbatim quote `q`,
// source id `s`. Every page below was fetched and checked on 14 Nov 2026.
// Anything that is AURA's own modelling (thresholds on the raw gas ratio, time windows, weights) is NOT here:
// it lives in src/lib/cabinLink/context.ts and is labelled "AURA rule" in the UI.
import type { Cited, SourceInfo } from '../conditions/types'

export const CABIN_SOURCES: Record<string, SourceInfo> = {
  'nasa-tb-015': { org: 'NASA OCHMO', title: 'OCHMO-TB-015 Spaceflight Toxicology (technical brief, Rev B)', url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-015-spaceflight-toxicology.pdf' },
  'nasa-tb-002': { org: 'NASA OCHMO', title: 'OCHMO-TB-002 Environmental Control & Life Support System (technical brief)', url: 'https://www.nasa.gov/wp-content/uploads/2023/07/eclss-technical-brief-ochmo.pdf' },
  'mq2-datasheet': { org: 'Hanwei Electronics', title: 'MQ-2 gas sensor datasheet (hosted by Pololu)', url: 'https://www.pololu.com/file/0J309/MQ2.pdf' },
  'niosh-lpg': { org: 'CDC/NIOSH', title: 'NIOSH Pocket Guide to Chemical Hazards — L.P.G.', url: 'https://www.cdc.gov/niosh/npg/npgd0679.html' },
  'niosh-propane': { org: 'CDC/NIOSH', title: 'NIOSH Pocket Guide to Chemical Hazards — Propane', url: 'https://www.cdc.gov/niosh/npg/npgd0524.html' },
  'cdc-smoke': { org: 'CDC', title: 'How Wildfire Smoke Affects Your Body', url: 'https://www.cdc.gov/wildfires/risk-factors' },
  'nhs-co': { org: 'NHS', title: 'Carbon monoxide poisoning', url: 'https://www.nhs.uk/conditions/carbon-monoxide-poisoning/' },
  'niosh-heat': { org: 'CDC/NIOSH', title: 'Heat Stress and Workers', url: 'https://www.cdc.gov/niosh/heat-stress/about/index.html' },
  'nhs-heat': { org: 'NHS', title: 'Heat exhaustion and heatstroke', url: 'https://www.nhs.uk/conditions/heat-exhaustion-heatstroke/' },
  'nhs-hypothermia': { org: 'NHS', title: 'Hypothermia', url: 'https://www.nhs.uk/conditions/hypothermia/' },
  'nhs-dry-eyes': { org: 'NHS', title: 'Dry eyes', url: 'https://www.nhs.uk/conditions/dry-eyes/' },
  // environment-aware consultation (src/data/cabinLink/envDx.ts), fetched 14 Nov 2026
  'nhs-sweating': { org: 'NHS', title: 'Excessive sweating (hyperhidrosis)', url: 'https://www.nhs.uk/conditions/excessive-sweating-hyperhidrosis/' },
  'nhs-dehydration': { org: 'NHS', title: 'Dehydration', url: 'https://www.nhs.uk/conditions/dehydration/' },
  'osha-heat': { org: 'OSHA (US Dept. of Labor)', title: 'Heat — Heat Hazard Recognition', url: 'https://www.osha.gov/heat-exposure/hazards' },
  'medline-chills': { org: 'MedlinePlus (US National Library of Medicine)', title: 'Chills', url: 'https://medlineplus.gov/ency/article/003091.htm' },
  'nhs-breath': { org: 'NHS', title: 'Shortness of breath', url: 'https://www.nhs.uk/symptoms/shortness-of-breath/' },
  'noaa-hi-equation': { org: 'NOAA / National Weather Service (WPC)', title: 'The Heat Index Equation', url: 'https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml' },
  'nws-heat-index': { org: 'National Weather Service', title: 'What is the heat index?', url: 'https://www.weather.gov/ama/heatindex' },
  'nws-heat-tools': { org: 'National Weather Service', title: 'Heat Forecast Tools', url: 'https://www.weather.gov/safety/heat-index' },
  'adafruit-dht': { org: 'Adafruit', title: 'DHT11, DHT22 and AM2302 sensors — overview', url: 'https://learn.adafruit.com/dht/overview' },
}

/** What the sensor can and cannot tell. */
export const SENSOR_FACTS = {
  detects: { t: 'The MQ-2 reacts to combustible gas and smoke.', q: 'Detection Gas Combustible gas and smoke', s: 'mq2-datasheet' },
  gases: { t: 'It is most sensitive to LPG, propane and hydrogen.', q: 'High sensitivity to LPG, Propane and Hydrogen', s: 'mq2-datasheet' },
  /** Why a "normal" MQ-2 reading never rules out CO: CO is odourless and comes from incomplete combustion. */
  coInvisible: { t: 'Carbon monoxide has no colour or smell and comes from incomplete burning.', q: 'CO is an odorless, colorless gas that is produced by incomplete combustion of carbon-containing materials', s: 'nasa-tb-015' },
} satisfies Record<string, Cited>

/** Why each environmental factor can matter for symptoms. */
export const WHY: Record<'gas' | 'heat' | 'humid' | 'cold' | 'dry', Cited[]> = {
  gas: [
    { t: 'Breathing smoke can cause coughing, trouble breathing, stinging eyes, a scratchy throat, headaches and tiredness straight away.', q: 'Breathing in smoke can affect you right away, causing: Coughing, Trouble breathing, … Stinging eyes, Scratchy throat, … Headaches, Tiredness', s: 'cdc-smoke' },
    { t: 'Bottled fuel gas (LPG) can cause dizziness and drowsiness.', q: 'dizziness, drowsiness, asphyxia', s: 'niosh-lpg' },
    { t: 'Propane can cause dizziness and confusion.', q: 'dizziness, confusion, excitation, asphyxia', s: 'niosh-propane' },
    { t: 'Fires make carbon monoxide; its most common symptoms are headache, dizziness, weakness, upset stomach, vomiting, chest pain and confusion.', q: 'The most common symptoms of CO poisoning includes headache, dizziness, weakness, upset stomach, vomiting, chest pain, and confusion.', s: 'nasa-tb-015' },
  ],
  heat: [{ t: 'Heat exhaustion can cause tiredness, dizziness and headache.', q: 'The symptoms of heat exhaustion include: ... tiredness ... dizziness ... headache', s: 'nhs-heat' }],
  humid: [{ t: 'High temperature together with humidity is a risk factor for heat-related illness.', q: 'high temperature and humidity', s: 'niosh-heat' }],
  cold: [{ t: 'Living in a cold house is a risk for hypothermia, especially for older people living alone.', q: 'live in a cold house – older people living alone are particularly at risk', s: 'nhs-hypothermia' }],
  dry: [{ t: 'Dry air and heated or air-conditioned rooms can cause dry, sore or gritty eyes.', q: "you spend time in air conditioned or heated environments … it's windy, dry or dusty", s: 'nhs-dry-eyes' }],
}

/** Habitat bands used by the station (same numbers as CABIN_LIMITS in src/data/missions.ts). */
export const CABIN_BAND: Cited = {
  t: 'NASA keeps crew cabins between 18 and 27 °C and 25–75 % humidity for crew health.',
  q: 'safe levels of temperature and humidity for protection of crew health. 18°C - 27°C and 25-75% humidity',
  s: 'nasa-tb-002',
}

/** First steps shown in the "Cabin air" notice (the full gas-alarm steps come from src/components/env/gasGuidance.ts). */
export const FIRST_STEP = {
  freshAir: { t: 'Go outside, then get medical advice as soon as possible — do not go back in until you have it.', q: 'go outside … get medical advice as soon as possible – do not go back into the affected building until you have got advice', s: 'nhs-co' },
  coolPlace: { t: 'Move to a cool place and drink plenty of water.', q: 'Move them to a cool place. … Give them plenty of water to drink', s: 'nhs-heat' },
  warmUp: { t: 'Warm up: if fully awake, have a warm non-alcoholic drink and something sugary.', q: "give them a warm non-alcoholic drink and some sugary food like chocolate if they're fully awake", s: 'nhs-hypothermia' },
} satisfies Record<string, Cited>

/**
 * The "Anyone with symptoms?" checklist on the Environment page. Each item maps to a consultation finding
 * and carries the source that links it to smoke, fuel gas or carbon monoxide.
 */
export const SYMPTOM_CHECKLIST: { finding: string; label: string; cite: Cited }[] = [
  { finding: 'headache', label: 'Headache', cite: { t: 'Smoke and carbon monoxide can cause headaches.', q: 'Headaches', s: 'cdc-smoke' } },
  { finding: 'lightheaded', label: 'Dizziness', cite: { t: 'Fuel gas (LPG) can cause dizziness.', q: 'dizziness, drowsiness, asphyxia', s: 'niosh-lpg' } },
  { finding: 'nausea', label: 'Feeling sick', cite: { t: 'Carbon monoxide can make you feel or be sick.', q: 'feeling sick or being sick', s: 'nhs-co' } },
  { finding: 'breathless', label: 'Short of breath', cite: { t: 'Smoke can cause trouble breathing.', q: 'Trouble breathing', s: 'cdc-smoke' } },
  { finding: 'cough', label: 'Coughing', cite: { t: 'Smoke can cause coughing.', q: 'Coughing', s: 'cdc-smoke' } },
  { finding: 'eye-throat-irritation', label: 'Stinging eyes or scratchy throat', cite: { t: 'Smoke can cause stinging eyes and a scratchy throat.', q: 'Stinging eyes, Scratchy throat', s: 'cdc-smoke' } },
  { finding: 'drowsy', label: 'Unusually drowsy', cite: { t: 'Fuel gas (LPG) can cause drowsiness.', q: 'dizziness, drowsiness, asphyxia', s: 'niosh-lpg' } },
  { finding: 'confusion', label: 'Confused', cite: { t: 'Propane and carbon monoxide can cause confusion.', q: 'dizziness, confusion, excitation, asphyxia', s: 'niosh-propane' } },
]

export function cabinSource(id: string): SourceInfo {
  return CABIN_SOURCES[id] ?? { org: 'Source', title: id, url: '' }
}
