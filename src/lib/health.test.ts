import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '../data/contexts'
import type { FieldId, Values } from '../data/vitals'
import { baselineOf, evaluate, latestOf, radiation, seriesOf, summaryOf, systemsFor, timeAgo } from './health'
import type { Measurement } from './types'
import { generateMeasurements, MISSION } from './demoData'

let nextId = 1
function row(metric: FieldId, value: number, day: number, at?: string, source = 'sim', device = 'x'): Measurement {
  return { id: nextId++, crewId: 1, metric, value, day, at: at ?? new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString(), source, device }
}

const NORMAL: Values = { sys: 118, dia: 76, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7.5, mood: 4, exercise: 100, vision: 5, water: 2.8 }
/** One row per field, all on `day`, optionally patched. */
function snapshot(patch: Partial<Values> = {}, day = 142): Measurement[] {
  const v = { ...NORMAL, ...patch }
  return (Object.keys(v) as FieldId[]).map((k) => row(k, v[k], day))
}
const mission = (context: Context = 'space', day = 142, profileId = 'mars-transit') => ({ context, profileId, day })

describe('latestOf', () => {
  it('newest timestamp wins, regardless of row order', () => {
    const a = row('hr', 60, 1, '2026-11-14T08:00:00.000Z')
    const b = row('hr', 90, 2, '2026-11-14T09:00:00.000Z')
    expect(latestOf([a, b]).values.hr).toBe(90)
    expect(latestOf([b, a]).values.hr).toBe(90)
  })
  it('an imported device row newer than a simulated one wins (and the reverse)', () => {
    const sim = row('sleep', 7, 142, '2026-11-14T06:30:00.000Z', 'sim')
    const dev = row('sleep', 4.5, 142, '2026-11-14T07:10:00.000Z', 'device', 'Galaxy Watch')
    expect(latestOf([sim, dev]).meta.sleep).toBe(dev)
    expect(latestOf([dev, sim]).meta.sleep).toBe(dev)
    const olderDev = row('sleep', 4.5, 141, '2026-11-13T07:10:00.000Z', 'device')
    expect(latestOf([olderDev, sim]).values.sleep).toBe(7)
  })
  it('compares instants, not strings, when timestamp formats differ', () => {
    // 10:00+02:00 is 08:00Z, which is earlier than 08:30Z even though the string sorts later
    const early = row('hr', 50, 1, '2026-11-14T10:00:00+02:00')
    const late = row('hr', 99, 1, '2026-11-14T08:30:00.000Z')
    expect(latestOf([early, late]).values.hr).toBe(99)
    expect(latestOf([late, early]).values.hr).toBe(99)
  })
  it('keeps metrics apart and falls back to defaults for missing ones', () => {
    const l = latestOf([row('sys', 150, 1)])
    expect(l.values.sys).toBe(150)
    expect(l.meta.dia).toBeUndefined()
    expect(l.values.dia).toBe(78)
  })
})

describe('seriesOf', () => {
  const rows = [1, 2, 3, 4, 5].map((d) => row('hr', 60 + d, d))
  it('window edges: day > today - days', () => {
    expect(seriesOf(rows, 'hr', 3, 5).map((p) => p.day)).toEqual([3, 4, 5])
    expect(seriesOf(rows, 'hr', 5, 5).map((p) => p.day)).toEqual([1, 2, 3, 4, 5])
    expect(seriesOf(rows, 'hr', 1, 5).map((p) => p.day)).toEqual([5])
  })
  it('ignores other metrics and sorts by day', () => {
    const mixed = [row('hr', 70, 4), row('sys', 120, 4), row('hr', 65, 2)]
    expect(seriesOf(mixed, 'hr', 14, 5)).toEqual([{ day: 2, value: 65 }, { day: 4, value: 70 }])
  })
  it('imported days <= 0 appear only when the window reaches them', () => {
    const imported = [row('sleep', 6, -3), row('sleep', 7, 0), row('sleep', 8, 1)]
    expect(seriesOf(imported, 'sleep', 14, 3).map((p) => p.day)).toEqual([-3, 0, 1])
    expect(seriesOf(imported, 'sleep', 3, 3).map((p) => p.day)).toEqual([1])
    expect(seriesOf(imported, 'sleep', 4, 3).map((p) => p.day)).toEqual([0, 1])
  })
  it('one point per day: the newest reading of the day, whatever the row order', () => {
    const morning = row('hr', 60, 7, '2026-11-14T07:00:00.000Z')
    const evening = row('hr', 80, 7, '2026-11-14T19:00:00.000Z')
    expect(seriesOf([morning, evening], 'hr', 14, 7)).toEqual([{ day: 7, value: 80 }])
    expect(seriesOf([evening, morning], 'hr', 14, 7)).toEqual([{ day: 7, value: 80 }])
  })
})

describe('baselineOf', () => {
  it('is null without data for the metric', () => {
    expect(baselineOf([], 'hr')).toBeNull()
    expect(baselineOf([row('sys', 120, 1)], 'hr')).toBeNull()
  })
  it('averages the first 14 days of the person own data, not the first 14 mission days', () => {
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => row('hr', 60, 50 + i)), // days 50..63
      row('hr', 200, 64), // outside the first 14 days of data
    ]
    expect(baselineOf(rows, 'hr')).toBe(60)
  })
  it('works with imported history at days <= 0', () => {
    const rows = [row('hr', 70, -5), row('hr', 80, 8), row('hr', 1000, 9)] // -5..8 is 14 days
    expect(baselineOf(rows, 'hr')).toBe(75) // days -5..8 only
  })
})

describe('radiation', () => {
  it('status boundaries: warn from 50 %, crit above 80 %', () => {
    // mars-transit 1.8 mSv/day, career limit 600 mSv
    expect(radiation('mars-transit', 166).status).toBe('ok')
    expect(radiation('mars-transit', 167).status).toBe('warn')
    expect(radiation('mars-transit', 266).status).toBe('warn')
    expect(radiation('mars-transit', 267).status).toBe('crit')
  })
  it('unknown profile falls back to the first mission', () => {
    expect(radiation('nope', 10).mission.id).toBe('iss')
  })
})

describe('evaluate: no data is not normal', () => {
  it('has no data and no measured systems before the first reading', () => {
    const e = evaluate([], mission('home'))
    expect(e.hasData).toBe(false)
    expect(Object.values(e.systemMeasured).some(Boolean)).toBe(false)
  })
  it('marks only the systems that have a reading', () => {
    const e = evaluate([row('hr', 70, 142)], mission('home'))
    expect(e.hasData).toBe(true)
    expect(e.systemMeasured.heart).toBe(true)
    expect(e.systemMeasured.lungs).toBe(false)
    expect(evaluate([], mission('space')).systemMeasured.radiation).toBe(true)
  })
})

describe('evaluate: statuses and score', () => {
  it('all normal gives score 100 and no alerts', () => {
    const e = evaluate(snapshot(), mission())
    expect(e.score).toBe(100)
    expect(e.alerts).toEqual([])
    expect(e.overall).toBe('ok')
    expect(Object.values(e.vitalStatus).every((s) => s === 'ok')).toBe(true)
  })

  it('maps a vital to its system status', () => {
    const e = evaluate(snapshot({ sys: 135 }), mission())
    expect(e.vitalStatus.bp).toBe('warn')
    expect(e.systemStatus.heart).toBe('warn')
    expect(e.systemStatus.lungs).toBe('ok')
    expect(e.overall).toBe('warn')
    const c = evaluate(snapshot({ spo2: 90 }), mission())
    expect(c.systemStatus.lungs).toBe('crit')
    expect(c.overall).toBe('crit')
  })

  it('score = 100 - 9 per attention - 22 per urgent', () => {
    expect(evaluate(snapshot({ sys: 135 }), mission()).score).toBe(91)
    expect(evaluate(snapshot({ sys: 150 }), mission()).score).toBe(78)
    expect(evaluate(snapshot({ sys: 150, sleep: 6, hr: 110 }), mission()).score).toBe(100 - 22 - 9 - 9)
    expect(evaluate(snapshot({ sys: 150, spo2: 90, hr: 130, sleep: 3 }), mission()).score).toBe(100 - 4 * 22)
  })

  it('score never drops below 0', () => {
    // readings logged on day 267 so they are current; radiation is urgent too
    const worst = snapshot({ sys: 200, dia: 120, hr: 30, spo2: 80, temp: 40, glucose: 300, sleep: 2, mood: 1, exercise: 0, vision: 1, water: 0 }, 267)
    const e = evaluate(worst, mission('space', 267))
    expect(e.score).toBe(0)
    expect(e.overall).toBe('crit')
  })

  it('radiation counts toward the score in space', () => {
    expect(evaluate(snapshot(), mission('space', 167)).score).toBe(91)
    expect(evaluate(snapshot(), mission('space', 267)).score).toBe(78)
  })

  it('only vitals that have data are judged (missing data is not scored)', () => {
    const e = evaluate([row('sys', 150, 1), row('dia', 95, 1)], mission())
    expect(e.vitals.map((v) => v.key)).toEqual(['bp'])
    expect(e.vitalStatus).toEqual({ bp: 'crit' })
    // a half-measured blood pressure is not judged either
    expect(evaluate([row('sys', 150, 1)], mission()).vitals).toEqual([])
  })
})

describe('evaluate: alerts', () => {
  it('are sorted urgent first, then attention', () => {
    const e = evaluate(snapshot({ sleep: 6, sys: 150, hr: 110, spo2: 90 }), mission())
    expect(e.alerts.map((a) => a.level)).toEqual(['crit', 'crit', 'warn', 'warn'])
    expect(e.alerts.slice(0, 2).map((a) => a.key).sort()).toEqual(['bp', 'spo2'])
  })
  it('carry title, action text, timestamp and system', () => {
    const e = evaluate(snapshot({ sys: 150, dia: 95 }), mission())
    const a = e.alerts.find((x) => x.key === 'bp')!
    expect(a.title).toBe('Blood pressure 150/95 mmHg')
    expect(a.detail).toMatch(/Rest 5 minutes/)
    expect(a.system).toBe('heart')
    expect(a.at).toBeTruthy()
  })
  it('radiation alert appears only in the space context', () => {
    const space = evaluate(snapshot(), mission('space', 200))
    expect(space.alerts.map((a) => a.key)).toEqual(['rad'])
    expect(space.alerts[0].title).toMatch(/Radiation 60% of career limit/)
    expect(space.showRad).toBe(true)
    for (const c of ['polar', 'home'] as const) {
      const e = evaluate(snapshot(), mission(c, 200))
      expect(e.alerts.find((a) => a.key === 'rad')).toBeUndefined()
      expect(e.showRad).toBe(false)
      expect(e.systemStatus.radiation).toBe('ok')
      expect(e.score).toBe(100)
    }
  })
  it('hidden systems never drive the overall status', () => {
    expect(systemsFor('space').map((s) => s.id)).toContain('radiation')
    expect(systemsFor('polar').map((s) => s.id)).not.toContain('radiation')
    expect(systemsFor('home').map((s) => s.id)).not.toContain('eyes')
    const e = evaluate(snapshot({ vision: 1 }), mission('polar'))
    expect(e.vitals.map((v) => v.key)).not.toContain('vision')
    expect(e.overall).toBe('ok')
  })
  it('context overrides apply: 60 min of exercise is fine at home but low in space', () => {
    expect(evaluate(snapshot({ exercise: 60 }), mission('home')).vitalStatus.exercise).toBe('ok')
    expect(evaluate(snapshot({ exercise: 60 }), mission('space')).vitalStatus.exercise).toBe('warn')
    expect(evaluate(snapshot({ water: 2.2 }), mission('polar')).vitalStatus.water).toBe('ok')
    expect(evaluate(snapshot({ water: 2.2 }), mission('space')).vitalStatus.water).toBe('warn')
  })
  it('three short nights: the sleep alert is raised once, never duplicated by the trend rule', () => {
    const rows = [...snapshot({ sleep: 5.5 }, 142), row('sleep', 5.4, 141), row('sleep', 5.2, 140)]
    const e = evaluate(rows, mission())
    expect(e.alerts.filter((a) => a.key.startsWith('sleep')).map((a) => a.key)).toEqual(['sleep'])
  })
  it('the trend rule needs three consecutive days inside the window', () => {
    const gap = [...snapshot({ sleep: 5.5 }, 142), row('sleep', 5.4, 141), row('sleep', 5.2, 139)]
    expect(evaluate(gap, mission()).alerts.some((a) => a.key === 'sleep-trend')).toBe(false)
  })
})

describe('evaluate: privacy', () => {
  const rows = snapshot({ mood: 1 })
  it('ground role (hidePrivate) never gets mood in vitals, alerts, summary or score', () => {
    const e = evaluate(rows, mission(), true)
    expect(e.vitals.map((v) => v.key)).not.toContain('mood')
    expect(e.vitalStatus.mood).toBeUndefined()
    expect(e.alerts.find((a) => a.key === 'mood')).toBeUndefined()
    expect(e.score).toBe(100)
    expect(JSON.stringify(summaryOf(e))).not.toMatch(/Mood/i)
  })
  it('everyone else sees mood', () => {
    const e = evaluate(rows, mission(), false)
    expect(e.vitalStatus.mood).toBe('crit')
    expect(e.alerts.find((a) => a.key === 'mood')?.level).toBe('crit')
    expect(e.score).toBe(78)
  })
})

describe('evaluate: data quality and freshness', () => {
  it('missing data: nothing is scored, no numeric score is offered, every measurement is listed as missing', () => {
    const e = evaluate([], mission('home'))
    expect(e.quality).toMatchObject({ expected: 9, present: 0, current: 0, old: 0, missing: 9, sufficient: false })
    expect(e.scoreReady).toBe(false)
    expect(e.overallShown).toBeNull()
    expect(e.quality.needs.join(' ')).toMatch(/Blood pressure.*not measured/)
  })

  it('a single normal measurement is "insufficient data", never 100/100 or "normal"', () => {
    const e = evaluate([row('hr', 70, 142)], mission('home'))
    expect(e.quality).toMatchObject({ present: 1, current: 1, missing: 8, sufficient: false })
    expect(e.scoreReady).toBe(false)
    expect(e.overallShown).toBeNull()
    expect(e.alerts).toEqual([])
    expect(e.quality.needs.join(' ')).toMatch(/Blood pressure/)
    expect(summaryOf(e)).toMatchObject({ scoreReady: false, data: { expected: 9, current: 1, missing: 8 } })
  })

  it('a single abnormal measurement still alerts and sets the status, but gives no score', () => {
    const e = evaluate([row('sys', 150, 142), row('dia', 95, 142)], mission('home'))
    expect(e.scoreReady).toBe(false)
    expect(e.alerts.map((a) => a.key)).toEqual(['bp'])
    expect(e.overallShown).toBe('crit')
  })

  it('sufficiency: half of the tracked measurements current, including blood pressure and heart rate', () => {
    const half = snapshot().filter((r) => ['sys', 'dia', 'hr', 'spo2', 'temp', 'sleep'].includes(r.metric)) // bp, hr, spo2, temp, sleep = 5 of 10
    expect(evaluate(half, mission()).scoreReady).toBe(true)
    const noHr = snapshot().filter((r) => r.metric !== 'hr')
    const e = evaluate(noHr, mission())
    expect(e.quality.current).toBe(9)
    expect(e.scoreReady).toBe(false)
    expect(e.quality.needs).toEqual([`${e.defByKey.hr!.label} (not measured yet)`])
  })

  it('old data: classified by mission day, not counted in the score, alerts or body-system colours', () => {
    const rows = [...snapshot({}, 142), row('sys', 150, 130), row('dia', 95, 130)].filter((r) => !(['sys', 'dia'].includes(r.metric) && r.day === 142))
    const e = evaluate(rows, mission())
    const bp = e.quality.items.find((i) => i.key === 'bp')!
    expect(bp).toMatchObject({ state: 'old', day: 130, ageDays: 12, maxAgeDays: 3, status: 'crit' })
    expect(e.quality).toMatchObject({ current: 9, old: 1, missing: 0, present: 10 })
    expect(e.vitalStatus.bp).toBe('crit') // last known status is kept...
    expect(e.currentStatus.bp).toBeUndefined() // ...but it is not a current one
    expect(e.alerts.find((a) => a.key === 'bp')).toBeUndefined()
    expect(e.systemStatus.heart).toBe('ok')
    expect(e.score).toBe(100)
    expect(e.scoreReady).toBe(false) // blood pressure is required to be current
    expect(e.overallShown).toBeNull()
  })

  it('an old abnormal reading is surfaced as last known (abnormal first), in the evaluation and in the report summary', () => {
    // temperature old but normal (6 days), glucose old and high (22 days): the abnormal one is listed first
    const rows = [...snapshot({}, 142).filter((r) => !['glucose', 'temp'].includes(r.metric)), row('glucose', 250, 120), row('temp', 36.6, 136)]
    const e = evaluate(rows, mission())
    expect(e.lastKnown.map((i) => i.key)).toEqual(['glucose', 'temp'])
    expect(e.lastKnown[0].status).not.toBe('ok')
    expect(e.lastKnown[1]).toMatchObject({ status: 'ok', ageDays: 6 })
    expect(e.scoreReady).toBe(true)
    expect(e.score).toBe(100)
    expect(e.alerts.find((a) => a.key === 'glucose')).toBeUndefined()
    const s = summaryOf(e)
    expect(s.oldReadings?.map((o) => o.label)).toEqual(e.lastKnown.map((i) => i.label))
    expect(s.vitals.find((v) => v.label === e.defByKey.glucose!.label)?.value).toMatch(/old: 22 days, last known/)
  })

  it('freshness windows: 3 days by default (the early-warning window), 7 for the weekly vision check', () => {
    const at = (day: number) => evaluate([...snapshot({}, 142).filter((r) => !['hr', 'vision'].includes(r.metric)), row('hr', 65, day), row('vision', 5, day)], mission())
    expect(at(139).quality.items.find((i) => i.key === 'hr')!.state).toBe('current')
    expect(at(138).quality.items.find((i) => i.key === 'hr')!.state).toBe('old')
    expect(at(135).quality.items.find((i) => i.key === 'vision')!.state).toBe('current')
    expect(at(134).quality.items.find((i) => i.key === 'vision')!.state).toBe('old')
  })

  it('the simulated crew is unchanged when its data is current (crew 1: score 82, two alerts), late evening and early morning', () => {
    const crew = (now: Date, id: number) =>
      generateMeasurements(now)
        .filter((m) => m.crewId === id)
        .map((m, i) => ({ ...m, id: i + 1, metric: m.metric as FieldId }))
    const sim = { context: 'space' as const, profileId: MISSION.profileId, day: MISSION.day }
    const evening = evaluate(crew(new Date(2026, 10, 14, 23, 30), 1), sim)
    expect(evening.score).toBe(82)
    expect(evening.alerts).toHaveLength(2)
    expect(evening.scoreReady).toBe(true)
    expect(evening.quality).toMatchObject({ expected: 10, current: 10, old: 0, missing: 0 })
    // 03:00: today's readings are not logged yet (glucose last on day 139, vision on 135) — still inside their windows
    for (const id of [1, 2, 3, 4]) {
      const early = evaluate(crew(new Date(2026, 10, 14, 3, 0), id), sim)
      expect(early.quality.current, `crew ${id}`).toBe(10)
      expect(early.scoreReady).toBe(true)
    }
    // Server demo: the mission day stays 142, so the readings stay current however many calendar days pass.
    const twoWeeksLater = evaluate(crew(new Date(2026, 10, 1, 23, 30), 1), sim)
    expect(twoWeeksLater.score).toBe(82)
  })

  it('privacy filter: the ground role does not count mood as expected, missing or old', () => {
    const e = evaluate(snapshot({ mood: 1 }), mission(), true)
    expect(e.quality.expected).toBe(9)
    expect(e.quality.items.map((i) => i.key)).not.toContain('mood')
    expect(e.lastKnown.map((i) => i.key)).not.toContain('mood')
    expect(JSON.stringify(summaryOf(e))).not.toMatch(/Mood/i)
  })
})

describe('summaryOf', () => {
  it('mirrors the evaluation', () => {
    const e = evaluate(snapshot({ sys: 150, dia: 95, sleep: 6 }), mission())
    const s = summaryOf(e)
    expect(s.overall).toBe('crit')
    expect(s.score).toBe(e.score)
    expect(s.alerts).toEqual(e.alerts.map((a) => ({ title: a.title, level: a.level })))
    expect(s.vitals).toContainEqual({ label: 'Blood pressure', value: '150/95 mmHg', status: 'crit' })
    expect(s.vitals).toContainEqual({ label: 'Sleep', value: '6.0 h', status: 'warn' })
    expect(s.vitals).toHaveLength(e.vitals.length)
  })
})

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers())
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString()

  it('handles missing input and short spans', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0))
    expect(timeAgo(undefined)).toBe('—')
    expect(timeAgo(at(2026, 10, 14, 11, 59))).toBe('1 min ago')
    expect(timeAgo(new Date(Date.now() - 20000).toISOString())).toBe('just now')
    expect(timeAgo(at(2026, 10, 14, 11, 15))).toBe('45 min ago')
  })
  it('later the same day shows the clock time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0))
    expect(timeAgo(at(2026, 10, 14, 8, 5))).toBe('today 08:05')
  })
  it('across midnight: 22:30 yesterday seen at 00:10 is "yesterday", not "today"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 0, 10, 0))
    expect(timeAgo(at(2026, 10, 13, 22, 30))).toBe('yesterday 22:30')
  })
  it('18:35 yesterday seen at 09:00 is yesterday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 9, 0, 0))
    expect(timeAgo(at(2026, 10, 13, 18, 35))).toBe('yesterday 18:35')
  })
  it('older dates count calendar days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 0, 5, 0))
    expect(timeAgo(at(2026, 10, 12, 23, 59))).toBe('2 days ago')
    expect(timeAgo(at(2026, 9, 30, 12, 0))).toBe('15 days ago')
  })
})
