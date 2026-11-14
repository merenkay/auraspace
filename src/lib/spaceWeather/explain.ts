// Plain-language meaning of flare classes and the NOAA S / G / R scales. Every effect text is NOAA's or NASA's own
// wording (see refs.ts); AURA adds only the arithmetic (which level a number falls in).
import { REF, type Citation } from './refs'

/* ------------------------------------------------------------- flares */

const FLARE_BASE: Record<string, number> = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }
const FLARE_UNITS: Record<string, number> = { A: 1, B: 10, C: 100, M: 1000, X: 10000 } // in units of 1e-8 W/m²

export type FlareInfo = { letter: 'A' | 'B' | 'C' | 'M' | 'X'; magnitude: number; peakWm2: number; r: number; meaning: string; sources: Citation[] }

/** NOAA R-scale from the flare's X-ray class: R1 M1, R2 M5, R3 X1, R4 X10, R5 X20 (NOAA Space Weather Scales). */
export function rFromFlare(letter: string, magnitude: number): number {
  const u = (FLARE_UNITS[letter] ?? 0) * magnitude
  const eps = 1e-6
  if (u >= 200000 - eps) return 5
  if (u >= 100000 - eps) return 4
  if (u >= 10000 - eps) return 3
  if (u >= 5000 - eps) return 2
  if (u >= 1000 - eps) return 1
  return 0
}

const FLARE_MEANING: Record<string, string> = {
  A: 'A class: the weakest X-ray level, about 10⁻⁸ W/m² at peak (NOAA).',
  B: 'B class: ten times A, about 10⁻⁷ W/m² at peak (NOAA).',
  C: 'C class: “C-class flares are too weak to noticeably affect Earth.” (NASA)',
  M: 'M class: “M-class flares can cause brief radio blackouts at the poles and minor radiation storms that might endanger astronauts.” (NASA)',
  X: 'X class: the strongest class. “X flares also have the potential to create global transmission problems and world-wide blackouts.” (NASA)',
}

/** "M1.9" → letter, magnitude, peak X-ray flux, NOAA R level and NASA's sentence for that class. Null for anything else. */
export function flareInfo(cls: string | null | undefined): FlareInfo | null {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)$/i.exec((cls ?? '').trim())
  if (!m) return null
  const letter = m[1].toUpperCase() as FlareInfo['letter']
  const magnitude = Number(m[2])
  return { letter, magnitude, peakWm2: FLARE_BASE[letter] * magnitude, r: rFromFlare(letter, magnitude), meaning: FLARE_MEANING[letter], sources: [REF.noaaFlares, REF.nasaFlares] }
}

/** Orders flare classes: X2 > X1 > M9 > … Unknown classes sort last. */
export function flareRank(cls: string | null | undefined): number {
  const i = flareInfo(cls)
  return i ? FLARE_UNITS[i.letter] * i.magnitude : -1
}

/* ------------------------------------------------------------- NOAA scales (verbatim) */

export type ScaleLevel = { level: number; name: string; threshold: string; effect: string; frequency: string }

/** Solar radiation storms. Threshold = flux of ≥ 10 MeV protons (pfu). Effect = NOAA's "Biological" line. */
export const S_SCALE: ScaleLevel[] = [
  { level: 1, name: 'Minor', threshold: '10 pfu', effect: 'Biological: None.', frequency: '50 per cycle' },
  { level: 2, name: 'Moderate', threshold: '100 pfu', effect: 'Biological: Passengers and crew in high-flying aircraft at high latitudes may be exposed to elevated radiation risk.', frequency: '25 per cycle' },
  { level: 3, name: 'Strong', threshold: '1,000 pfu', effect: 'Biological: Radiation hazard avoidance recommended for astronauts on EVA; passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk.', frequency: '10 per cycle' },
  { level: 4, name: 'Severe', threshold: '10,000 pfu', effect: 'Biological: Unavoidable radiation hazard to astronauts on EVA; passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk.', frequency: '3 per cycle' },
  { level: 5, name: 'Extreme', threshold: '100,000 pfu', effect: 'Biological: Unavoidable high radiation hazard to astronauts on EVA (extra-vehicular activity); passengers and crew in high-flying aircraft at high latitudes may be exposed to radiation risk.', frequency: 'Fewer than 1 per cycle' },
]

/** Geomagnetic storms. Threshold = Kp. Effect = NOAA's "Other systems" line (radio, navigation, aurora). */
export const G_SCALE: ScaleLevel[] = [
  { level: 1, name: 'Minor', threshold: 'Kp 5', effect: 'Other systems: Migratory animals are affected at this and higher levels; aurora is commonly visible at high latitudes (northern Michigan and Maine).', frequency: '1700 per cycle' },
  { level: 2, name: 'Moderate', threshold: 'Kp 6', effect: 'Other systems: HF radio propagation can fade at higher latitudes, and aurora has been seen as low as New York and Idaho (typically 55° geomagnetic lat.).', frequency: '600 per cycle' },
  { level: 3, name: 'Strong', threshold: 'Kp 7', effect: 'Other systems: Intermittent satellite navigation and low-frequency radio navigation problems may occur, HF radio may be intermittent, and aurora has been seen as low as Illinois and Oregon (typically 50° geomagnetic lat.).', frequency: '200 per cycle' },
  { level: 4, name: 'Severe', threshold: 'Kp 8, including a 9-', effect: 'Other systems: Induced pipeline currents affect preventive measures, HF radio propagation sporadic, satellite navigation degraded for hours, low-frequency radio navigation disrupted, and aurora has been seen as low as Alabama and northern California (typically 45° geomagnetic lat.).', frequency: '100 per cycle' },
  { level: 5, name: 'Extreme', threshold: 'Kp 9', effect: 'Other systems: Pipeline currents can reach hundreds of amps, HF (high frequency) radio propagation may be impossible in many areas for one to two days, satellite navigation may be degraded for days, low-frequency radio navigation can be out for hours, and aurora has been seen as low as Florida and southern Texas (typically 40° geomagnetic lat.).', frequency: '4 per cycle' },
]

/** Radio blackouts. Threshold = flare class. Effect = NOAA's "HF Radio" line. */
export const R_SCALE: ScaleLevel[] = [
  { level: 1, name: 'Minor', threshold: 'M1', effect: 'HF Radio: Weak or minor degradation of HF radio communication on sunlit side, occasional loss of radio contact.', frequency: '2000 per cycle' },
  { level: 2, name: 'Moderate', threshold: 'M5', effect: 'HF Radio: Limited blackout of HF radio communication on sunlit side, loss of radio contact for tens of minutes.', frequency: '350 per cycle' },
  { level: 3, name: 'Strong', threshold: 'X1', effect: 'HF Radio: Wide area blackout of HF radio communication, loss of radio contact for about an hour on sunlit side of Earth.', frequency: '175 per cycle' },
  { level: 4, name: 'Severe', threshold: 'X10', effect: 'HF Radio: HF radio communication blackout on most of the sunlit side of Earth for one to two hours. HF radio contact lost during this time.', frequency: '8 per cycle' },
  { level: 5, name: 'Extreme', threshold: 'X20', effect: 'HF Radio: Complete HF (high frequency) radio blackout on the entire sunlit side of the Earth lasting for a number of hours. This results in no HF radio contact with mariners and en route aviators in this sector.', frequency: 'Less than 1 per cycle' },
]

const SCALES = { S: S_SCALE, G: G_SCALE, R: R_SCALE }

/** "S3 (Strong)" style name; level 0 → "none". */
export function scaleName(kind: 'S' | 'G' | 'R', level: number | null | undefined): string {
  if (level == null) return 'unknown'
  if (level <= 0) return 'none'
  const l = SCALES[kind][Math.min(5, Math.round(level)) - 1]
  return `${kind}${l.level} (${l.name})`
}

export function scaleLevel(kind: 'S' | 'G' | 'R', level: number | null | undefined): ScaleLevel | null {
  if (level == null || level < 1) return null
  return SCALES[kind][Math.min(5, Math.round(level)) - 1]
}

/** NOAA S-scale from the ≥ 10 MeV proton flux in pfu (10, 100, 1 000, 10 000, 100 000). */
export function sFromFlux(pfu: number | null | undefined): number | null {
  if (pfu == null || !Number.isFinite(pfu) || pfu < 0) return null
  if (pfu >= 1e5) return 5
  if (pfu >= 1e4) return 4
  if (pfu >= 1e3) return 3
  if (pfu >= 100) return 2
  if (pfu >= 10) return 1
  return 0
}

/**
 * NOAA G-scale from a Kp value as DONKI reports it (thirds: 5- = 4.67, 9- = 8.67). NOAA counts a whole Kp number
 * with its thirds (G3 = Kp 7: 7-, 7o, 7+) and puts 9- into G4 ("Kp = 8, including a 9-"); only 9o reaches G5.
 */
export function gFromKp(kp: number | null | undefined): number | null {
  if (kp == null || !Number.isFinite(kp) || kp < 0) return null
  if (kp >= 9 - 1e-6) return 5
  const k = Math.round(kp)
  if (k >= 8) return 4
  if (k === 7) return 3
  if (k === 6) return 2
  if (k === 5) return 1
  return 0
}

/** SCORE CME types as DONKI notifications state them. */
export const CME_TYPE: Record<string, string> = {
  S: 'S-type: speed under 500 km/s',
  C: 'C-type (common): 500–999 km/s',
  O: 'O-type (occasional): 1000–1999 km/s',
  R: 'R-type (rare): 2000–2999 km/s',
  ER: 'ER-type (extremely rare): over 3000 km/s',
}
