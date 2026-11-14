// Mission profiles. Dose rates and delays are approximate public figures
// (ISS dosimetry, MSL-RAD cruise/surface, Chang'e-4 LND) — verify before final submission.
export type Mission = {
  id: string
  name: string
  gravity: string
  doseRate: number // mSv per day (estimate)
  delaySec: number // one-way communication delay to Earth
}

export const MISSIONS: Mission[] = [
  { id: 'iss', name: 'ISS — Low Earth Orbit', gravity: 'Microgravity', doseRate: 0.6, delaySec: 0 },
  { id: 'lunar-transit', name: 'Artemis — Lunar Transit', gravity: 'Microgravity', doseRate: 1.0, delaySec: 1.3 },
  { id: 'lunar-base', name: 'Lunar Surface Base', gravity: '1/6 g', doseRate: 1.4, delaySec: 1.3 },
  { id: 'mars-transit', name: 'Mars Transit', gravity: 'Microgravity', doseRate: 1.8, delaySec: 840 },
  { id: 'mars-surface', name: 'Mars Surface Base', gravity: '3/8 g', doseRate: 0.7, delaySec: 840 },
]

// NASA career space-radiation limit (effective dose).
export const CAREER_LIMIT_MSV = 600

export function formatDelay(sec: number): string {
  if (sec < 0.5) return 'real-time'
  if (sec < 60) return `${sec.toFixed(1)} s`
  return `${Math.round(sec / 60)} min`
}
