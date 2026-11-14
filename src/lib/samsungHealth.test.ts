import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSample } from '../../tools/samsung-sample/sample'
import {
  analyzeExport,
  defaultSelection,
  findCol,
  listZip,
  localDate,
  parseCsv,
  parseOffset,
  parseTime,
  readZipEntry,
  tableFromName,
  toImportRows,
  trackingDay,
  type ExportSummary,
  type InputFile,
} from './samsungHealth'

const NOW = new Date(2026, 10, 14, 12, 0) // 14 Nov 2026, 12:00 local
const blob = (s: string | Uint8Array) => new Blob([typeof s === 'string' ? s : (s as BlobPart)])
const file = (path: string, s: string | Uint8Array): InputFile => ({ path, blob: blob(s) })
const metric = (s: ExportSummary, m: string) => s.metrics.find((x) => x.metric === m)

const HR_HEADER =
  'source,tag_id,com.samsung.health.heart_rate.create_sh_ver,com.samsung.health.heart_rate.heart_beat_count,com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.custom,com.samsung.health.heart_rate.binning_data,com.samsung.health.heart_rate.modify_sh_ver,com.samsung.health.heart_rate.update_time,com.samsung.health.heart_rate.create_time,com.samsung.health.heart_rate.client_data_id,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.client_data_ver,com.samsung.health.heart_rate.time_offset,com.samsung.health.heart_rate.deviceuuid,com.samsung.health.heart_rate.comment,com.samsung.health.heart_rate.pkg_name,com.samsung.health.heart_rate.end_time,com.samsung.health.heart_rate.datauuid,com.samsung.health.heart_rate.heart_rate'
// first two data rows of a real Galaxy Watch 6 export (public GitHub repo bastide/galaxy_watch_data), verbatim
const HR_REAL = `﻿com.samsung.shealth.tracker.heart_rate,6305105,3\n${HR_HEADER}\n,21313,62910051,1,2025-10-21 21:00:00.000,,26015114-43f1-418d-9b36-178aa275f10a.com.samsung.health.heart_rate.binning_data.json,62910051,2025-10-22 07:50:39.007,2025-10-21 21:39:00.749,,88.0,73.0,,UTC+0200,52AmZFQIp0,,com.sec.android.app.shealth,2025-10-21 21:59:59.999,26015114-43f1-418d-9b36-178aa275f10a,82.0,\n,21313,62910051,1,2025-10-22 06:00:00.000,,896e5833-dbb5-4a07-b003-ac116ce45442.com.samsung.health.heart_rate.binning_data.json,62910051,2025-10-22 07:50:39.070,2025-10-22 07:50:39.070,,56.0,54.0,,UTC+0200,52AmZFQIp0,,com.sec.android.app.shealth,2025-10-22 06:59:59.999,896e5833-dbb5-4a07-b003-ac116ce45442,54.0,\n`

describe('time handling', () => {
  it('parses Samsung UTC strings, epoch values and offsets', () => {
    expect(parseTime('2025-10-21 21:00:00.000')).toBe(Date.UTC(2025, 9, 21, 21))
    expect(parseTime('2025-10-21T21:00:00Z')).toBe(Date.UTC(2025, 9, 21, 21))
    expect(parseTime('2025-10-21 23:00:00+02:00')).toBe(Date.UTC(2025, 9, 21, 21))
    expect(parseTime('1761091200000')).toBe(Date.UTC(2025, 9, 22))
    expect(parseTime('1761091200')).toBe(Date.UTC(2025, 9, 22))
    expect(parseTime('21.10.2025 21:00')).toBe(Date.UTC(2025, 9, 21, 21))
    expect(parseTime('')).toBeNull()
    expect(parseTime('yesterday')).toBeNull()
    expect(parseOffset('UTC+0300')).toBe(180)
    expect(parseOffset('UTC+0530')).toBe(330)
    expect(parseOffset('UTC-0500')).toBe(-300)
    expect(parseOffset('GMT+05:30')).toBe(330)
    expect(parseOffset('UTC')).toBe(0)
    expect(parseOffset('21600000')).toBe(360) // SDK style milliseconds
    expect(parseOffset('nonsense')).toBeNull()
  })

  it('computes the local day with the export offset', () => {
    // 23:30 UTC is already the next day in Istanbul (UTC+3) but still the same day in New York (UTC-5)
    const t = Date.UTC(2026, 2, 1, 23, 30)
    expect(localDate(t, 180)).toBe('2026-03-02')
    expect(localDate(t, -300)).toBe('2026-03-01')
    expect(trackingDay(142, '2026-11-14', '2026-11-12')).toBe(140)
    expect(trackingDay(3, '2026-11-14', '2026-11-01')).toBe(-10)
  })
})

describe('CSV layer', () => {
  it('reads the real layout: BOM, metadata line, namespaced header, trailing comma', () => {
    const csv = parseCsv(HR_REAL)
    expect(csv.table).toBe('com.samsung.shealth.tracker.heart_rate')
    expect(csv.header[0]).toBe('source')
    const rows = [...csv.rows()]
    expect(rows).toHaveLength(2)
    expect(rows[0][findCol(csv.header, 'heart_rate')]).toBe('82.0')
    expect(rows[1][findCol(csv.header, 'start_time')]).toBe('2025-10-22 06:00:00.000')
    expect(findCol(csv.header, 'not_there')).toBe(-1)
  })

  it('handles quotes, embedded delimiters and newlines, CRLF, semicolons and decimal commas', () => {
    const quoted = parseCsv('start_time,amount,comment\r\n2026-01-02 10:00:00.000,250.0,"one, two"\r\n2026-01-02 11:00:00.000,300.0,"line1\nline2 ""quoted"""\r\n')
    const rows = [...quoted.rows()]
    expect(rows).toHaveLength(2)
    expect(rows[0][2]).toBe('one, two')
    expect(rows[1][2]).toBe('line1\nline2 "quoted"')
    const semi = parseCsv('com.samsung.health.water_intake;6303011;6\nstart_time;amount;time_offset\n2026-01-02 10:00:00.000;250,5;UTC+0300\n')
    expect(semi.delimiter).toBe(';')
    expect(semi.table).toBe('com.samsung.health.water_intake')
    expect([...semi.rows()][0][1]).toBe('250,5')
  })

  it('identifies tables from file names, including copies', () => {
    expect(tableFromName('x/com.samsung.shealth.exercise.20251024090645.csv')).toEqual({ table: 'com.samsung.shealth.exercise', stamp: '20251024090645' })
    expect(tableFromName('com.samsung.shealth.exercise.hr_zone.20251024090645.csv').table).toBe('com.samsung.shealth.exercise.hr_zone')
    expect(tableFromName('com.samsung.shealth.sleep.202008021218 (1).csv')).toEqual({ table: 'com.samsung.shealth.sleep', stamp: '202008021218' })
    expect(tableFromName('com.samsung.shealth.tracker.heart_rate.csv').table).toBe('com.samsung.shealth.tracker.heart_rate')
    expect(tableFromName('jsons/a/b.json').table).toBeNull()
    expect(tableFromName('notes.txt').table).toBeNull()
  })
})

describe('zip reader', () => {
  it('lists the central directory and reads stored and deflated entries', async () => {
    const zip = zipSync({ 'a/stored.csv': [strToU8('hello'), { level: 0 }], 'a/deflated.csv': [strToU8('x'.repeat(5000)), { level: 9 }], 'a/dir/': new Uint8Array(0) })
    const b = blob(zip)
    const entries = await listZip(b)
    expect(entries.map((e) => e.path).sort()).toEqual(['a/deflated.csv', 'a/stored.csv'])
    const text = async (p: string) => new TextDecoder().decode(await readZipEntry(b, entries.find((e) => e.path === p)!))
    expect(await text('a/stored.csv')).toBe('hello')
    expect(await text('a/deflated.csv')).toBe('x'.repeat(5000))
  })

  it('rejects something that is not a zip without throwing from analyzeExport', async () => {
    const s = await analyzeExport([file('export.zip', 'definitely not a zip')], { now: NOW })
    expect(s.files[0].status).toBe('error')
    expect(s.metrics).toHaveLength(0)
    expect(s.warnings.join(' ')).toMatch(/No heart-rate/)
  })
})

describe('synthetic sample export', () => {
  const sample = buildSample({ end: '2026-11-14', days: 45 })
  let s: ExportSummary

  beforeEach(async () => {
    s ??= await analyzeExport([file('samsung-health-SYNTHETIC-sample.zip', sample.zip)], { now: NOW })
  })

  it('is small enough to ship and is labelled SYNTHETIC', () => {
    expect(sample.zip.length).toBeLessThan(300 * 1024)
    expect(s.synthetic).toBe(true)
    expect(s.exportDate).toBe('2026-11-14')
  })

  it('finds every importable table and nothing for body temperature', () => {
    expect(s.metrics.map((m) => m.metric).sort()).toEqual(['bp', 'exercise', 'hr', 'sleep', 'spo2', 'water'])
    expect(metric(s, 'temp')).toBeUndefined()
  })

  it('maps sleep to the wake-up day, sums split nights and skips nights without the watch', () => {
    const sleep = metric(s, 'sleep')!
    expect(sleep.points).toHaveLength(43) // 45 nights minus 2 without the watch
    expect(sleep.points[sleep.points.length - 1].date).toBe('2026-11-14')
    for (const p of sleep.points) expect(p.value).toBeGreaterThan(4)
    for (const p of sleep.points) expect(p.value).toBeLessThan(10)
    const last3 = sleep.points.slice(-3).map((p) => p.value)
    expect(last3.every((v) => v < 6)).toBe(true) // the sample's short nights at the end
    const split = sleep.points.find((p) => p.n === 2)
    expect(split).toBeDefined()
    expect(split!.value).toBeGreaterThan(6)
  })

  it('estimates a plausible resting heart rate and leaves workouts and sleep out', () => {
    const hr = metric(s, 'hr')!
    expect(hr.points.length).toBeGreaterThanOrEqual(43)
    for (const p of hr.points) {
      expect(p.value).toBeGreaterThanOrEqual(60)
      expect(p.value).toBeLessThanOrEqual(80)
    }
  })

  it('aggregates spo2, blood pressure, exercise and water per day, dropping the incomplete export day for totals', () => {
    const spo2 = metric(s, 'spo2')!
    for (const p of spo2.points) expect(p.value).toBeGreaterThanOrEqual(94)
    const bp = metric(s, 'bp')!
    expect(bp.points.length).toBe(sample.counts.bp)
    for (const p of bp.points) expect(p.value2).toBeLessThan(p.value)
    const ex = metric(s, 'exercise')!
    expect(ex.points.every((p) => p.date < '2026-11-14')).toBe(true)
    expect(ex.points.every((p) => p.value >= 0 && p.value <= 300)).toBe(true)
    expect(ex.points.some((p) => p.value === 0)).toBe(true) // worn, no workout -> 0 min
    expect(ex.notes.join(' ')).toMatch(/count as 0 minutes/)
    const water = metric(s, 'water')!
    expect(water.points.every((p) => p.date < '2026-11-14')).toBe(true)
    expect(water.points.every((p) => p.value >= 1 && p.value <= 2.5)).toBe(true)
    expect(water.notes.join(' ')).toMatch(/incomplete/)
  })

  it('reports steps for reference, skips skin temperature and lists unknown files', () => {
    expect(s.steps?.days).toBe(45)
    const byName = (frag: string) => s.files.find((f) => f.path.includes(frag))!
    expect(byName('skin_temperature').status).toBe('skipped')
    expect(byName('skin_temperature').note).toMatch(/not body temperature/)
    expect(byName('step_daily_trend').status).toBe('reference')
    expect(byName('pedometer_day_summary').status).toBe('skipped')
    expect(byName('README_SYNTHETIC').status).toBe('unrecognised')
    expect(byName('tracker.heart_rate').status).toBe('used')
    expect(s.sidecars).toBe(3)
  })

  it('builds import rows for the default range (last 30 days with data)', () => {
    const sel = defaultSelection(s)
    expect(sel.to).toBe('2026-11-14')
    expect(sel.from).toBe('2026-10-16')
    const rows = toImportRows(s, sel)
    expect(rows.every((r) => r.localDate >= sel.from && r.localDate <= sel.to)).toBe(true)
    expect(rows.filter((r) => r.metric === 'sys').length).toBe(rows.filter((r) => r.metric === 'dia').length)
    const days = new Set(rows.filter((r) => r.metric === 'sleep').map((r) => r.localDate))
    expect(days.size).toBe(rows.filter((r) => r.metric === 'sleep').length) // at most one value per metric per day
    expect(toImportRows(s, { ...sel, metrics: ['sleep'] }).every((r) => r.metric === 'sleep')).toBe(true)
  })

  it('reads the same data from a selected folder (loose files) as from the zip', async () => {
    const loose = Object.entries(sample.files).map(([path, text]) => file(path, text))
    const t = await analyzeExport(loose, { now: NOW })
    expect(t.metrics.map((m) => [m.metric, m.points.length])).toEqual(s.metrics.map((m) => [m.metric, m.points.length]))
  })
})

describe('awkward inputs', () => {
  it('identifies a renamed CSV from its metadata line and keeps real-export values', async () => {
    const s = await analyzeExport([file('my heart export.csv', HR_REAL)], { now: NOW })
    const hr = metric(s, 'hr')!
    expect(hr.readings).toBe(2)
    expect(hr.points).toHaveLength(0) // fewer than 3 readings per day -> no daily estimate
    expect(hr.notes.join(' ')).toMatch(/fewer than 3/)
  })

  it('never fails on unknown files and lists them', async () => {
    const s = await analyzeExport([file('holiday.jpg', 'xx'), file('notes.csv', 'a,b\n1,2\n')], { now: NOW })
    expect(s.files.map((f) => f.status)).toEqual(['unrecognised', 'unrecognised'])
    expect(s.metrics).toHaveLength(0)
  })

  it('counts duplicate rows once and overlapping duplicate sleep sessions once', async () => {
    const head = 'com.samsung.health.sleep.start_time,com.samsung.health.sleep.end_time,com.samsung.health.sleep.time_offset,com.samsung.health.sleep.datauuid'
    const csv = `com.samsung.shealth.sleep,7013001,11\n${head}\n2026-11-01 20:00:00.000,2026-11-02 04:00:00.000,UTC+0300,a,\n2026-11-01 20:00:00.000,2026-11-02 04:00:00.000,UTC+0300,a,\n2026-11-01 20:05:00.000,2026-11-02 03:50:00.000,UTC+0300,b,\n`
    const s = await analyzeExport([file('com.samsung.shealth.sleep.20261103080000.csv', csv)], { now: NOW })
    const sleep = metric(s, 'sleep')!
    expect(sleep.points).toEqual([{ date: '2026-11-02', value: 8, at: '2026-11-02T04:00:00.000Z', n: 1 }])
  })

  it('assigns the local day using time_offset, also when sleep ends after UTC midnight', async () => {
    const head = 'start_time,end_time,sleep_duration,time_offset'
    const csv = `${head}\n2026-11-01 19:30:00.000,2026-11-01 23:30:00.000,200,UTC+0300\n`
    const s = await analyzeExport([file('com.samsung.shealth.sleep.csv', csv)], { now: NOW })
    // ends 02:30 local on the 2nd; sleep_duration (minutes) wins over the 4 h span
    expect(metric(s, 'sleep')!.points[0]).toMatchObject({ date: '2026-11-02', value: 3.3 })
  })

  it('falls back to the dominant offset when a table has no time_offset column, with a warning', async () => {
    const water = 'start_time,amount\n2026-11-10 22:30:00.000,500\n2026-11-10 10:00:00.000,250\n'
    const sleep = 'start_time,end_time,time_offset\n2026-11-09 20:00:00.000,2026-11-10 04:00:00.000,UTC+0300\n'
    const s = await analyzeExport([file('com.samsung.health.water_intake.20261112090000.csv', water), file('com.samsung.shealth.sleep.20261112090000.csv', sleep)], { now: NOW })
    // 22:30 UTC + 3 h = 01:30 on the 11th
    expect(metric(s, 'water')!.points).toEqual([
      expect.objectContaining({ date: '2026-11-10', value: 0.25 }),
      expect.objectContaining({ date: '2026-11-11', value: 0.5 }),
    ])
    expect(s.warnings.join(' ')).toMatch(/most common/)
  })

  it('reads semicolon CSVs with decimal commas, epoch times and skips implausible values', async () => {
    const csv = 'com.samsung.shealth.tracker.oxygen_saturation;7013001;5\nstart_time;end_time;spo2;time_offset\n1762300800000;1762304400000;96,0;UTC+0300\n1762300800000;1762304400000;0;UTC+0300\n1762300800000;1762304400000;255;UTC+0300\n'
    const s = await analyzeExport([file('spo2.csv', csv)], { now: NOW })
    expect(metric(s, 'spo2')!.points).toHaveLength(1)
    expect(metric(s, 'spo2')!.points[0].value).toBe(96)
  })

  it('imports blood pressure only from complete, consistent readings', async () => {
    const csv = 'com.samsung.health.blood_pressure.start_time,com.samsung.health.blood_pressure.systolic,com.samsung.health.blood_pressure.diastolic,com.samsung.health.blood_pressure.time_offset\n2026-11-10 05:00:00.000,121.0,79.0,UTC+0300\n2026-11-10 06:00:00.000,125.0,81.0,UTC+0300\n2026-11-10 07:00:00.000,70.0,90.0,UTC+0300\n2026-11-10 07:30:00.000,,80.0,UTC+0300\n'
    const s = await analyzeExport([file('com.samsung.shealth.blood_pressure.20261112090000.csv', csv)], { now: NOW })
    const bp = metric(s, 'bp')!
    expect(bp.points).toEqual([expect.objectContaining({ date: '2026-11-10', value: 123, value2: 80, n: 2 })])
    expect(bp.notes.join(' ')).toMatch(/2 rows/)
  })

  it('reports a table whose expected columns are missing, and handles header-only files', async () => {
    const s = await analyzeExport([file('com.samsung.shealth.exercise.20261112090000.csv', 'foo,bar\n1,2\n'), file('com.samsung.health.water_intake.20261112090000.csv', '﻿com.samsung.health.water_intake,1,6\nstart_time,amount,time_offset\n')], { now: NOW })
    expect(s.files.find((f) => f.path.includes('exercise'))!.status).toBe('error')
    expect(metric(s, 'water')!.points).toHaveLength(0)
  })

  it('treats skin temperature as not importable even when chosen alone', async () => {
    const s = await analyzeExport([file('com.samsung.health.skin_temperature.20261112090000.csv', 'start_time,temperature\n2026-11-10 01:00:00.000,34.1\n')], { now: NOW })
    expect(metric(s, 'temp')).toBeUndefined()
    expect(s.files[0].status).toBe('skipped')
  })

  it('maps a real body-temperature table to temp', async () => {
    const s = await analyzeExport([file('com.samsung.health.body_temperature.20261112090000.csv', 'start_time,temperature,time_offset\n2026-11-10 06:00:00.000,36.8,UTC+0300\n2026-11-10 18:00:00.000,37.0,UTC+0300\n')], { now: NOW })
    expect(metric(s, 'temp')!.points).toEqual([expect.objectContaining({ date: '2026-11-10', value: 36.9 })])
  })
})

describe('demo store import', () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    })
    vi.resetModules()
  })

  it('saves device rows, never duplicates on re-import, keeps the first value and serves days <= 0', async () => {
    const { getBackend } = await import('./api')
    const b = await getBackend()
    expect(b.mode).toBe('demo')
    const created = new Date(Date.now() - 2 * 86400000).toISOString()
    localStorage.setItem(
      'aura.demo.v3',
      JSON.stringify({
        user: { id: 1000, username: 'a@b.c', email: 'a@b.c', role: 'member', name: 'Test', title: 'Home care', crewId: 1000, context: 'home' },
        members: [{ id: 1000, crewId: 1000, email: 'a@b.c', name: 'Test', pass: 'x', context: 'home', createdAt: created, color: '#fff' }],
      }),
    )
    const d = new Date()
    const iso = (n: number) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    }
    const rows = [
      { metric: 'sleep' as const, value: 7.2, localDate: iso(1), at: new Date(Date.now() - 86400000).toISOString() },
      { metric: 'sleep' as const, value: 6.1, localDate: iso(10), at: new Date(Date.now() - 10 * 86400000).toISOString() },
      { metric: 'hr' as const, value: 999, localDate: iso(1), at: new Date().toISOString() },
    ]
    const first = await b.importMeasurements(1000, rows, 'Galaxy Watch · Samsung Health')
    expect(first).toMatchObject({ added: 2, unchanged: 0, conflicts: 0, rejected: 1 })
    const again = await b.importMeasurements(1000, [...rows.slice(0, 1), { ...rows[1], value: 5 }], 'Galaxy Watch · Samsung Health')
    expect(again).toMatchObject({ added: 0, unchanged: 1, conflicts: 1 })
    const all = await b.measurements(1000)
    const sleep = all.filter((m) => m.metric === 'sleep')
    expect(sleep).toHaveLength(2)
    expect(sleep.map((m) => m.day).sort((a, b) => a - b)).toEqual([-7, 2]) // member day 3 today
    expect(sleep.every((m) => m.source === 'device' && m.device === 'Galaxy Watch · Samsung Health')).toBe(true)
    await expect(b.importMeasurements(1, rows, 'Galaxy Watch · Samsung Health')).rejects.toThrow(/own record/)
    await expect(b.importMeasurements(1000, rows, 'Some other watch')).rejects.toThrow(/device/)
  })
})
