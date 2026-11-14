// Writes public/api/seed.json from the shared demo generator (run automatically by `npm run build`).
// Rows carry mission day + minute-of-day so the server can place them relative to "today".
import { mkdirSync, writeFileSync } from 'node:fs'
import { CREW, MISSION, STAFF, TASKS, generateMeasurements, missionStart } from '../src/lib/demoData.ts'

const end = new Date(2030, 0, 1, 23, 59) // end of a day → nothing is skipped as "future"
const start = missionStart(end).getTime()
const measurements = generateMeasurements(end).map((m) => ({
  c: m.crewId,
  m: m.metric,
  v: m.value,
  d: m.day,
  t: Math.round((new Date(m.at).getTime() - start) / 60000 - (m.day - 1) * 1440),
  s: m.source,
  dev: m.device,
}))

mkdirSync('public/api', { recursive: true })
writeFileSync('public/api/seed.json', JSON.stringify({ mission: MISSION, crew: CREW, staff: STAFF, tasks: TASKS, measurements }))
console.log(`seed.json: ${measurements.length} measurements`)
