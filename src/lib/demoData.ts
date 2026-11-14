// Deterministic, clearly simulated demo dataset.
// Used by the in-browser demo mode AND by tools/gen-seed.ts to seed the MySQL database,
// so both modes show the same crew. Self-contained on purpose (Node runs it with type stripping).

export type DemoRole = 'astronaut' | 'surgeon' | 'ground'

export type DemoCrew = {
  id: number
  username: string
  name: string
  callsign: string
  position: string
  color: string
  agency: string
  streak: number
  doneTasks: string[]
}

export type DemoStaff = { id: number; username: string; name: string; role: DemoRole; title: string }

export type DemoMeasurement = {
  crewId: number
  metric: string
  value: number
  day: number
  at: string
  source: string
  device: string
}

export const MISSION = {
  name: 'Mars Transit',
  profileId: 'mars-transit',
  day: 142,
  totalDays: 210,
  environment: 'Spacecraft',
  context: 'space' as const,
}

export const CREW: DemoCrew[] = [
  { id: 1, username: 'okafor', name: 'Mira Okafor', callsign: 'CDR', position: 'Commander', color: '#92C1FD', agency: 'Demo crew', streak: 12, doneTasks: ['bp', 'temp', 'mood'] },
  { id: 2, username: 'reyes', name: 'Daniel Reyes', callsign: 'PLT', position: 'Pilot', color: '#B9DAFF', agency: 'Demo crew', streak: 3, doneTasks: ['bp'] },
  { id: 3, username: 'tanaka', name: 'Aiko Tanaka', callsign: 'MS1', position: 'Mission Specialist', color: '#C7C4BD', agency: 'Demo crew', streak: 31, doneTasks: ['bp', 'temp', 'mood', 'ared'] },
  { id: 4, username: 'brandt', name: 'Lukas Brandt', callsign: 'FE', position: 'Flight Engineer', color: '#9B9891', agency: 'Demo crew', streak: 0, doneTasks: [] },
]

export const STAFF: DemoStaff[] = [
  { id: 101, username: 'surgeon', name: 'Dr. Selin Arslan', role: 'surgeon', title: 'Flight Surgeon' },
  { id: 102, username: 'capcom', name: 'Jonas Weber', role: 'ground', title: 'Mission Control · CAPCOM' },
]

export const TASKS_BY_CONTEXT: Record<'space' | 'polar' | 'home', { id: string; label: string; time: string }[]> = {
  space: [] as { id: string; label: string; time: string }[],
  polar: [
    { id: 'bp', label: 'Morning blood pressure', time: '08:00' },
    { id: 'spo2', label: 'Oxygen saturation', time: '08:10' },
    { id: 'mood', label: 'Mood check-in', time: '09:00' },
    { id: 'light', label: 'Bright-light break', time: '10:00' },
    { id: 'exercise', label: 'Exercise session', time: '17:00' },
    { id: 'sleep', label: 'Log last night’s sleep', time: '21:00' },
  ],
  home: [
    { id: 'bp', label: 'Morning blood pressure', time: '08:30' },
    { id: 'water', label: 'Glass of water', time: '10:00' },
    { id: 'walk', label: 'Short walk', time: '11:00' },
    { id: 'mood', label: 'How are you today?', time: '12:00' },
    { id: 'call', label: 'Call family or a friend', time: '16:00' },
    { id: 'sleep', label: 'Log last night’s sleep', time: '20:00' },
  ],
}

export const TASKS = [
  { id: 'bp', label: 'Morning blood pressure', time: '08:30' },
  { id: 'temp', label: 'Body temperature', time: '08:45' },
  { id: 'mood', label: 'Mood check-in', time: '09:00' },
  { id: 'ared', label: 'ARED resistance session', time: '11:00' },
  { id: 'vision', label: 'Vision self-check', time: '14:00' },
  { id: 'water', label: 'Log water intake', time: '20:00' },
]
TASKS_BY_CONTEXT.space = TASKS

// mulberry32 PRNG
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const METRICS: { id: string; every: number; hour: number; source: string; device: string; digits: number }[] = [
  { id: 'sys', every: 1, hour: 8.5, source: 'device', device: 'Omron BP monitor', digits: 0 },
  { id: 'dia', every: 1, hour: 8.5, source: 'device', device: 'Omron BP monitor', digits: 0 },
  { id: 'hr', every: 1, hour: 9.1, source: 'device', device: 'Galaxy Watch', digits: 0 },
  { id: 'spo2', every: 1, hour: 9.1, source: 'device', device: 'Galaxy Watch', digits: 0 },
  { id: 'temp', every: 1, hour: 8.7, source: 'manual', device: 'Thermometer', digits: 1 },
  { id: 'glucose', every: 3, hour: 7.8, source: 'manual', device: 'Glucometer', digits: 0 },
  { id: 'sleep', every: 1, hour: 6.5, source: 'device', device: 'Galaxy Watch', digits: 1 },
  { id: 'mood', every: 1, hour: 9.0, source: 'manual', device: 'Self-report', digits: 0 },
  { id: 'exercise', every: 1, hour: 17.3, source: 'manual', device: 'ARED / T2 log', digits: 0 },
  { id: 'vision', every: 7, hour: 14.0, source: 'manual', device: 'Vision card', digits: 0 },
  { id: 'water', every: 1, hour: 20.0, source: 'manual', device: 'Drink log', digits: 1 },
]

type Base = Record<string, number>
const BASE: Record<number, Base> = {
  1: { sys: 118, dia: 76, hr: 64, spo2: 98, temp: 36.7, glucose: 88, sleep: 7.0, mood: 4.2, exercise: 104, vision: 5, water: 2.6 },
  2: { sys: 116, dia: 74, hr: 60, spo2: 98, temp: 36.6, glucose: 90, sleep: 7.1, mood: 4.3, exercise: 100, vision: 5, water: 2.7 },
  3: { sys: 112, dia: 72, hr: 58, spo2: 98, temp: 36.6, glucose: 85, sleep: 7.4, mood: 4.4, exercise: 105, vision: 5, water: 2.8 },
  4: { sys: 121, dia: 78, hr: 66, spo2: 97, temp: 36.8, glucose: 92, sleep: 6.9, mood: 4.0, exercise: 95, vision: 5, water: 2.6 },
}
const NOISE: Base = { sys: 3, dia: 2.5, hr: 3, spo2: 0.7, temp: 0.15, glucose: 4, sleep: 0.35, mood: 0.45, exercise: 8, vision: 0.2, water: 0.2 }

// Story arcs over the last days of the mission (simulated scenarios for the demo).
function storyOffset(crewId: number, metric: string, day: number, last: number): number {
  const ramp = (start: number, delta: number) => (day <= start ? 0 : ((day - start) / (last - start)) * delta)
  if (crewId === 1) {
    if (metric === 'sys') return ramp(118, 17)
    if (metric === 'dia') return ramp(118, 10)
    if (metric === 'sleep') return ramp(130, -0.9)
  }
  if (crewId === 2) {
    if (metric === 'sleep') return ramp(124, -2.5)
    if (metric === 'mood') return ramp(126, -2.2)
    if (metric === 'hr') return ramp(126, 9)
  }
  if (crewId === 3) {
    if (metric === 'vision') return ramp(100, -1)
  }
  if (crewId === 4) {
    if (metric === 'water') return ramp(120, -0.9)
    if (metric === 'exercise') return ramp(128, -45)
    if (metric === 'temp') return ramp(136, 0.6)
  }
  return 0
}

const CLAMP: Record<string, [number, number]> = {
  spo2: [88, 100], mood: [1, 5], vision: [1, 5], exercise: [0, 200], sleep: [3, 10], water: [0.5, 4],
}

export function missionStart(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (MISSION.day - 1))
  return d
}

export function generateMeasurements(now = new Date()): DemoMeasurement[] {
  const start = missionStart(now)
  const out: DemoMeasurement[] = []
  for (const c of CREW) {
    METRICS.forEach((m, mi) => {
      const r = rng(c.id * 1000 + mi * 37 + 7)
      for (let day = 1; day <= MISSION.day; day++) {
        if ((MISSION.day - day) % m.every !== 0) continue
        let v = BASE[c.id][m.id] + (r() - 0.5) * 2 * NOISE[m.id] + storyOffset(c.id, m.id, day, MISSION.day)
        const cl = CLAMP[m.id]
        if (cl) v = Math.min(cl[1], Math.max(cl[0], v))
        const p = Math.pow(10, m.digits)
        v = Math.round(v * p) / p
        const at = new Date(start.getTime() + (day - 1) * 86400000 + m.hour * 3600000)
        if (at.getTime() > now.getTime()) continue
        // Every generated reading is marked simulated, so no card can pass invented values off as coming from a real device.
        out.push({ crewId: c.id, metric: m.id, value: v, day, at: at.toISOString(), source: 'sim', device: m.device })
      }
    })
  }
  return out
}
