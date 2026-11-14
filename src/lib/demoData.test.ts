import php from '../../public/api/lib.php?raw'
import { describe, expect, it } from 'vitest'
import { CREW, MISSION, STAFF, TASKS, TASKS_BY_CONTEXT, generateMeasurements, missionStart } from './demoData'
import { evaluate } from './health'
import type { Measurement } from './types'
import type { FieldId } from '../data/vitals'

const NOW = new Date(2026, 10, 14, 23, 30) // late evening: every metric of the final day has been logged
const rowsFor = (all: ReturnType<typeof generateMeasurements>, id: number): Measurement[] =>
  all.filter((m) => m.crewId === id).map((m, i) => ({ ...m, id: i + 1, metric: m.metric as FieldId }))

describe('generator', () => {
  const all = generateMeasurements(NOW)

  it('is deterministic for a fixed date', () => {
    expect(generateMeasurements(NOW)).toEqual(all)
    expect(generateMeasurements(new Date(NOW))).toEqual(all)
  })

  it('never emits timestamps in the future', () => {
    for (const now of [new Date(2026, 10, 14, 0, 1), new Date(2026, 10, 14, 7, 0), new Date(2026, 10, 14, 12, 0), NOW]) {
      for (const m of generateMeasurements(now)) expect(Date.parse(m.at), `${m.metric} day ${m.day}`).toBeLessThanOrEqual(now.getTime())
    }
  })

  it('earlier in the day only the metrics already logged exist on the final day', () => {
    const morning = generateMeasurements(new Date(2026, 10, 14, 7, 0)).filter((m) => m.crewId === 1 && m.day === MISSION.day)
    expect(morning.map((m) => m.metric)).toEqual(['sleep']) // 06:30 is the only slot before 07:00
  })

  it('days run 1..142 and day 142 is today', () => {
    const days = all.map((m) => m.day)
    expect(Math.min(...days)).toBe(1)
    expect(Math.max(...days)).toBe(MISSION.day)
    expect(missionStart(NOW).getTime()).toBe(new Date(2026, 10, 14 - 141).getTime())
    const last = all.find((m) => m.day === MISSION.day)!
    expect(new Date(last.at).getDate()).toBe(14)
  })

  it('covers every crew member and metric, with cadence glucose/3 days, vision/7 days', () => {
    for (const c of CREW) {
      const mine = all.filter((m) => m.crewId === c.id)
      expect(new Set(mine.map((m) => m.metric)).size).toBe(11)
      expect(mine.filter((m) => m.metric === 'sys')).toHaveLength(MISSION.day)
      expect(mine.filter((m) => m.metric === 'glucose').every((m) => (MISSION.day - m.day) % 3 === 0)).toBe(true)
      expect(mine.filter((m) => m.metric === 'vision').every((m) => (MISSION.day - m.day) % 7 === 0)).toBe(true)
    }
  })

  it('values stay inside the server validation ranges (METRICS in public/api/lib.php)', () => {
    const block = php.match(/const METRICS = \[([\s\S]*?)\];/)![1]
    const ranges: Record<string, [number, number]> = {}
    for (const m of block.matchAll(/'(\w+)'\s*=>\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]/g)) ranges[m[1]] = [Number(m[2]), Number(m[3])]
    expect(Object.keys(ranges)).toHaveLength(11)
    for (const m of all) {
      const [lo, hi] = ranges[m.metric]
      expect(m.value, `${m.metric}=${m.value}`).toBeGreaterThanOrEqual(lo)
      expect(m.value, `${m.metric}=${m.value}`).toBeLessThanOrEqual(hi)
    }
  })

  it('rounds to the metric precision and marks every reading as simulated', () => {
    for (const m of all) {
      expect(m.source).toBe('sim') // generated crew readings are always labelled simulated
      if (['sys', 'dia', 'hr', 'spo2', 'glucose', 'mood', 'exercise', 'vision'].includes(m.metric)) expect(Number.isInteger(m.value)).toBe(true)
      else expect(Math.abs(m.value * 10 - Math.round(m.value * 10))).toBeLessThan(1e-6)
    }
  })
})

describe('crew stories hold on the final day', () => {
  const all = generateMeasurements(NOW)
  const mission = { context: 'space' as const, profileId: MISSION.profileId, day: MISSION.day }
  const ev = (id: number) => evaluate(rowsFor(all, id), mission)

  it('crew 1 (Okafor): elevated blood pressure', () => {
    const e = ev(1)
    expect(e.vitalStatus.bp).toBe('warn')
    expect(e.alerts.some((a) => a.key === 'bp')).toBe(true)
  })

  it('crew 2 (Reyes): very short sleep and low mood', () => {
    const e = ev(2)
    expect(e.vitalStatus.sleep).toBe('crit')
    expect(['warn', 'crit']).toContain(e.vitalStatus.mood)
    expect(e.values.mood).toBeLessThan(3.5)
    expect(e.vitalStatus.bp).toBe('ok')
  })

  it('crew 3 (Tanaka): everything normal', () => {
    const e = ev(3)
    expect(e.alerts).toEqual([])
    expect(e.score).toBe(100)
    expect(e.overall).toBe('ok')
  })

  it('crew 4 (Brandt): low water and low exercise', () => {
    const e = ev(4)
    expect(['warn', 'crit']).toContain(e.vitalStatus.water)
    expect(['warn', 'crit']).toContain(e.vitalStatus.exercise)
    expect(e.vitalStatus.bp).toBe('ok')
    expect(e.vitalStatus.sleep).toBe('ok')
  })

  it('the stories are not accidents of one noise draw: the last three days still show them', () => {
    for (const day of [140, 141, 142]) {
      const upTo = rowsFor(all, 1).filter((r) => r.day <= day)
      const e = evaluate(upTo, { ...mission, day })
      if (day >= 140) expect(['warn', 'crit']).toContain(e.vitalStatus.bp)
    }
  })

  it('the stories also hold when the app is opened at any hour of the day', () => {
    for (let h = 0; h < 24; h += 1) {
      const rows = generateMeasurements(new Date(2026, 10, 14, h, 30))
      const e = (id: number) => evaluate(rowsFor(rows, id), mission)
      expect(e(1).vitalStatus.bp, `h${h} crew1`).toBe('warn')
      expect(['warn', 'crit'], `h${h} crew2`).toContain(e(2).vitalStatus.sleep)
      expect(e(2).values.sleep, `h${h} crew2`).toBeLessThan(5.5)
      expect(e(3).alerts, `h${h} crew3`).toEqual([])
      expect(['warn', 'crit'], `h${h} crew4 water`).toContain(e(4).vitalStatus.water)
      expect(['warn', 'crit'], `h${h} crew4 exercise`).toContain(e(4).vitalStatus.exercise)
    }
  })

  it('the first weeks of every member are healthy (a baseline exists before the story starts)', () => {
    for (const c of CREW) {
      const early = rowsFor(all, c.id).filter((r) => r.day <= 14)
      const e = evaluate(early, { ...mission, day: 14 })
      expect(e.vitalStatus.bp, `crew ${c.id}`).toBe('ok')
      expect(e.vitalStatus.sleep, `crew ${c.id}`).not.toBe('crit')
    }
  })
})

describe('static demo definitions', () => {
  it('crew ids 1..4 and staff ids 101, 102 with the roles the app expects', () => {
    expect(CREW.map((c) => c.id)).toEqual([1, 2, 3, 4])
    expect(STAFF.map((s) => [s.id, s.role])).toEqual([[101, 'surgeon'], [102, 'ground']])
  })
  it('task lists exist for each context and have unique ids', () => {
    for (const c of ['space', 'polar', 'home'] as const) {
      const ids = TASKS_BY_CONTEXT[c].map((t) => t.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
    }
    expect(TASKS_BY_CONTEXT.space).toBe(TASKS)
  })
  it('streaks and pre-done tasks refer to real tasks', () => {
    const ids = TASKS.map((t) => t.id)
    for (const c of CREW) for (const t of c.doneTasks) expect(ids).toContain(t)
  })
})
