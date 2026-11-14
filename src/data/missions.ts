// Mission profiles. Every number is taken from src/data/kb/environment.json,
// which stores the source URL and supporting quote for each value.
export type Mission = {
  id: string
  name: string
  gravity: string
  doseRate: number // mSv per day (published average)
  doseNote: string
  delaySec: number // one-way communication delay used for triage
  delayRange: string
}

export const MISSIONS: Mission[] = [
  {
    id: 'iss',
    name: 'ISS — Low Earth Orbit',
    gravity: 'Microgravity',
    doseRate: 0.5,
    doseNote: 'ISS: on the order of 0.5 mSv/day (NASA LSAH newsletter, 2023)',
    delaySec: 0,
    delayRange: 'near real-time',
  },
  {
    id: 'lunar-transit',
    name: 'Artemis — Lunar Transit',
    gravity: 'Microgravity',
    doseRate: 1.2,
    doseNote: 'Artemis I: 26.7–35.4 mSv over the ~25-day flight ≈ 1.1–1.4 mSv/day (PMC11446838)',
    delaySec: 1.3,
    delayRange: '≈ 1.3 s',
  },
  {
    id: 'lunar-base',
    name: 'Lunar Surface Base',
    gravity: '0.165 g (Moon)',
    doseRate: 1.44,
    doseNote: 'Lunar surface: ~60 µSv/h ≈ 1.44 mSv/day (Chang’e-4 LND via DLR; secondary source)',
    delaySec: 1.3,
    delayRange: '≈ 1.3 s',
  },
  {
    id: 'mars-transit',
    name: 'Mars Transit',
    gravity: 'Microgravity',
    doseRate: 1.8,
    doseNote: 'Mars cruise: 1.8 mSv/day measured by Curiosity’s RAD (NASA JPL, 2013)',
    delaySec: 840,
    delayRange: '3–22 min (14 min shown)',
  },
  {
    id: 'mars-surface',
    name: 'Mars Surface Base',
    gravity: '0.38 g (Mars)',
    doseRate: 0.64,
    doseNote: 'Mars surface, Gale crater: 0.64 mSv/day measured by RAD (secondary citation of Hassler et al. 2014)',
    delaySec: 840,
    delayRange: '3–22 min (14 min shown)',
  },
]

// NASA-STD-3001 Vol 1 Rev B (V1 4030): career effective-dose limit.
export const CAREER_LIMIT_MSV = 600

// NASA-STD-3001 Vol 2 Rev D crew-health envelope for the cabin.
export const CABIN_LIMITS = { tempMin: 18, tempMax: 27, rhMin: 25, rhMax: 75 }

export function formatDelay(sec: number): string {
  if (sec < 0.5) return 'real-time'
  if (sec < 60) return `${sec.toFixed(1)} s`
  return `${Math.round(sec / 60)} min`
}
