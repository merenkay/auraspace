// Samsung Health "Download personal data" export -> AURA daily values.
//
// Pure, framework-free code: it runs in a Web Worker (src/components/import/analyze.worker.ts), on the main
// thread as a fallback, and in vitest. Nothing here talks to the network.
//
// What we rely on (checked against real exports, see the import report for sources):
//  * The export is a folder `samsunghealth_<user>_<YYYYMMDDHHmmss>` (often zipped) with one CSV per data table,
//    named `<table>.<timestamp>.csv`, plus a `jsons/` folder of per-record detail files we never need.
//  * Each CSV starts with a UTF-8 BOM and a metadata line `<table>,<version>,<n>`; the real header is line 2.
//    Most data rows end with a trailing comma (one more field than the header).
//  * Columns are often namespaced (`com.samsung.health.heart_rate.start_time`), so columns are looked up by suffix.
//  * Times are UTC strings `YYYY-MM-DD HH:mm:ss.SSS` (some tables use epoch milliseconds) and `time_offset`
//    (`UTC+0300`) gives the phone's time zone; local days are computed with that offset.
// Everything else is tolerated: missing columns, extra columns, quoted fields, `;` or tab delimiters,
// decimal commas, renamed files (identified by their metadata line) and unknown files (listed, never fatal).

import { inflateSync } from 'fflate'
import type { FieldId } from '../data/vitals'
import type { ImportRow } from './types'

/* ------------------------------------------------------------------ labels */

export const DEVICE_LABEL = 'Galaxy Watch · Samsung Health'
export const SYNTHETIC_DEVICE_LABEL = 'SYNTHETIC sample · Galaxy Watch · Samsung Health'
export const IMPORT_DEVICES = [DEVICE_LABEL, SYNTHETIC_DEVICE_LABEL] as const
/** True for rows created by this importer (real or synthetic). */
export const isImportedDevice = (device: string | null | undefined) => !!device && device.includes('Samsung Health')
export const isSyntheticDevice = (device: string | null | undefined) => !!device && device.includes('SYNTHETIC')

export type ImportMetric = 'hr' | 'sleep' | 'spo2' | 'bp' | 'exercise' | 'water' | 'temp'
export const IMPORT_METRICS: ImportMetric[] = ['hr', 'sleep', 'spo2', 'bp', 'exercise', 'water', 'temp']

export type MetricInfo = { label: string; unit: string; digits: number; fields: FieldId[]; table: string; method: string }

export const METRIC_INFO: Record<ImportMetric, MetricInfo> = {
  hr: {
    label: 'Heart rate',
    unit: 'bpm',
    digits: 0,
    fields: ['hr'],
    table: 'com.samsung.shealth.tracker.heart_rate',
    method:
      'Estimated resting value: the lower quartile (25th percentile) of the watch’s heart-rate readings taken while you were awake and not in a workout. Days with fewer than 3 such readings are left out. This is an estimate, not a clinical resting measurement.',
  },
  sleep: {
    label: 'Sleep',
    unit: 'h',
    digits: 1,
    fields: ['sleep'],
    table: 'com.samsung.shealth.sleep',
    method:
      'Hours asleep per night, counted on the day you woke up. Uses Samsung’s own sleep duration when present, otherwise the end minus start of each sleep session. Split nights are added up; overlapping sessions count once.',
  },
  spo2: {
    label: 'Blood oxygen',
    unit: '%',
    digits: 0,
    fields: ['spo2'],
    table: 'com.samsung.shealth.tracker.oxygen_saturation',
    method: 'Average of the day’s SpO₂ readings (the watch takes most of them during sleep), counted on the day each measurement ended.',
  },
  bp: {
    label: 'Blood pressure',
    unit: 'mmHg',
    digits: 0,
    fields: ['sys', 'dia'],
    table: 'com.samsung.shealth.blood_pressure',
    method: 'Average of the day’s blood-pressure readings (systolic and diastolic). Watch calibration readings are not used.',
  },
  exercise: {
    label: 'Exercise',
    unit: 'min',
    digits: 0,
    fields: ['exercise'],
    table: 'com.samsung.shealth.exercise',
    method:
      'Total minutes of all recorded workouts that started that day (auto-detected walks included). A day when the watch was worn (12 or more hours of heart-rate data) but no workout was recorded counts as 0 minutes. The export day itself is left out because it is incomplete.',
  },
  water: {
    label: 'Water intake',
    unit: 'L',
    digits: 2,
    fields: ['water'],
    table: 'com.samsung.health.water_intake',
    method: 'Sum of the water you logged in Samsung Health that day (stored in millilitres). The export day itself is left out because it is incomplete.',
  },
  temp: {
    label: 'Body temperature',
    unit: '°C',
    digits: 1,
    fields: ['temp'],
    table: 'com.samsung.health.body_temperature',
    method: 'Average of body-temperature records entered in Samsung Health. Wrist skin temperature is never used for this.',
  },
}

/** Table name (without timestamp) -> metric. Accepts both the `shealth` and `health` namespaces. */
const TABLE_METRIC: { re: RegExp; metric: ImportMetric }[] = [
  { re: /^com\.samsung\.s?health\.tracker\.heart_rate$/, metric: 'hr' },
  { re: /^com\.samsung\.s?health\.sleep$/, metric: 'sleep' },
  { re: /^com\.samsung\.s?health\.tracker\.oxygen_saturation$/, metric: 'spo2' },
  { re: /^com\.samsung\.s?health\.blood_pressure$/, metric: 'bp' },
  { re: /^com\.samsung\.s?health\.exercise$/, metric: 'exercise' },
  { re: /^com\.samsung\.s?health\.water_intake$/, metric: 'water' },
  { re: /^com\.samsung\.s?health\.body_temperature$/, metric: 'temp' },
]

/** Step tables, in order of preference. Shown for reference only — steps are not an AURA measurement. */
const STEP_TABLES = ['com.samsung.shealth.step_daily_trend', 'com.samsung.shealth.tracker.pedometer_day_summary', 'com.samsung.shealth.activity.day_summary']

export function metricForTable(table: string | null): ImportMetric | null {
  if (!table) return null
  const t = table.toLowerCase()
  return TABLE_METRIC.find((x) => x.re.test(t))?.metric ?? null
}

/** Why a recognised Samsung table is not imported. */
export function skipReason(table: string): string {
  const t = table.toLowerCase()
  if (/skin_temperature|daily_temperature/.test(t)) return 'Wrist skin temperature is not body temperature, so AURA does not import it.'
  if (/calibration_blood_pressure/.test(t)) return 'Cuff readings used to calibrate the watch — not imported.'
  if (/mean_arterial_pressure/.test(t)) return 'Derived blood-pressure value — not imported.'
  if (STEP_TABLES.includes(t) || /pedometer|step_count|step_daily|floors/.test(t)) return 'Steps and activity — found but not imported (steps are not an AURA measurement).'
  if (/oxygen_saturation\.raw/.test(t)) return 'Raw optical signal, not SpO₂ percentages — not imported.'
  if (/sleep_stage|sleep_combined|sleep_raw|sleep_snoring|sleep_goal|sleep_data/.test(t)) return 'Sleep detail — AURA uses the main sleep table instead.'
  if (/exercise\./.test(t)) return 'Workout detail — AURA uses the main exercise table instead.'
  if (/stress/.test(t)) return 'Samsung stress score — no matching AURA measurement.'
  return 'Samsung Health data that AURA does not use.'
}

/* -------------------------------------------------------------- file names */

export type NameInfo = { table: string | null; stamp: string | null }

/** `com.samsung.shealth.tracker.heart_rate.20251024090645.csv` -> table + export timestamp. */
export function tableFromName(path: string): NameInfo {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!/\.csv$/i.test(base)) return { table: null, stamp: null }
  // tolerate copies such as "com.samsung.shealth.sleep.20251024090645 (1).csv" or "... - Copy.csv"
  const clean = base
    .replace(/\.csv$/i, '')
    .replace(/\s*(\(\d+\)|-\s*copy(\s*\(\d+\))?|copy)\s*$/i, '')
    .trim()
  const m = /^(com\.samsung\.[a-z0-9_.]+?)(?:\.(\d{8,14}))?$/i.exec(clean)
  if (m) return { table: m[1].toLowerCase(), stamp: m[2] ?? null }
  return { table: null, stamp: null }
}

/** 20251024090645 / 202008021218 -> 2025-10-24. */
export function stampDate(stamp: string | null): string | null {
  if (!stamp || stamp.length < 8) return null
  const y = +stamp.slice(0, 4)
  const mo = +stamp.slice(4, 6)
  const d = +stamp.slice(6, 8)
  if (y < 2010 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
}

/* --------------------------------------------------------------------- CSV */

export type CsvTable = {
  table: string | null // from the metadata line, if present
  header: string[]
  delimiter: string
  rows: () => Generator<string[]>
}

function detectDelimiter(line: string): string {
  let best = ','
  let bestN = -1
  for (const d of [',', ';', '\t']) {
    let n = 0
    let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (!q && ch === d) n++
    }
    if (n > bestN) {
      best = d
      bestN = n
    }
  }
  return best
}

/** Streams CSV records from `text` starting at `pos`. Handles quotes, doubled quotes, CRLF and newlines in quotes. */
export function* csvRecords(text: string, delimiter = ',', pos = 0): Generator<string[]> {
  const n = text.length
  while (pos < n) {
    let nl = text.indexOf('\n', pos)
    if (nl < 0) nl = n
    let line = text.slice(pos, nl)
    if (!line.includes('"')) {
      pos = nl + 1
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length) yield line.split(delimiter)
      continue
    }
    // slow path: quoted fields, possibly spanning lines
    const out: string[] = []
    let field = ''
    let q = false
    let i = pos
    for (; i < n; i++) {
      const ch = text[i]
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i++
          } else q = false
        } else field += ch
      } else if (ch === '"') q = true
      else if (ch === delimiter) {
        out.push(field)
        field = ''
      } else if (ch === '\n') break
      else if (ch !== '\r') field += ch
    }
    out.push(field)
    pos = i + 1
    if (out.length > 1 || out[0] !== '') yield out
  }
}

/** Parses the Samsung CSV layout: optional metadata line, then header, then rows. */
export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const firstEnd = text.indexOf('\n')
  const first = (firstEnd < 0 ? text : text.slice(0, firstEnd)).replace(/\r$/, '')
  const firstDelim = detectDelimiter(first)
  const firstFields = first.split(firstDelim).map((s) => s.trim().replace(/^"|"$/g, ''))
  const isMeta = firstFields.length <= 4 && /^com\.samsung\.[a-z0-9_.]+$/i.test(firstFields[0] ?? '') && (firstFields.length === 1 || /^\d*$/.test(firstFields[1] ?? ''))
  const headerStart = isMeta ? (firstEnd < 0 ? text.length : firstEnd + 1) : 0
  let headerEnd = text.indexOf('\n', headerStart)
  if (headerEnd < 0) headerEnd = text.length
  const headerLine = text.slice(headerStart, headerEnd).replace(/\r$/, '')
  const delimiter = detectDelimiter(headerLine)
  const headRec = csvRecords(headerLine, delimiter).next()
  const header: string[] = (headRec.done ? [] : headRec.value).map((h: string) => h.trim().replace(/^﻿/, '').toLowerCase())
  while (header.length && header[header.length - 1] === '') header.pop()
  return {
    table: isMeta ? firstFields[0].toLowerCase() : null,
    header,
    delimiter,
    rows: () => csvRecords(text, delimiter, headerEnd + 1),
  }
}

/** Column index by exact name or by namespaced suffix (`*.start_time`). -1 when absent. */
export function findCol(header: string[], ...keys: string[]): number {
  for (const k of keys) {
    const i = header.indexOf(k)
    if (i >= 0) return i
  }
  for (const k of keys) {
    const i = header.findIndex((h) => h.endsWith('.' + k))
    if (i >= 0) return i
  }
  return -1
}

/** Number from a CSV cell; accepts a decimal comma. NaN when empty or invalid. */
export function num(cell: string | undefined): number {
  if (cell == null) return NaN
  let s = cell.trim()
  if (!s) return NaN
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  const v = Number(s)
  return Number.isFinite(v) ? v : NaN
}

/* -------------------------------------------------------------------- time */

/** UTC epoch ms from a Samsung time cell (UTC string or epoch seconds/ms). null when unreadable. */
export function parseTime(cell: string | undefined): number | null {
  if (cell == null) return null
  const s = cell.trim()
  if (!s) return null
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const v = Number(s)
    if (v > 1e11) return Math.round(v) // ms
    if (v > 1e9) return Math.round(v * 1000) // s
    return null
  }
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i.exec(s)
  let y: number, mo: number, d: number
  if (m) {
    y = +m[1]
    mo = +m[2]
    d = +m[3]
  } else {
    // 24.10.2025 21:00[:00] (re-saved by a spreadsheet in a European locale)
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i.exec(s)
    if (!m) return null
    d = +m[1]
    mo = +m[2]
    y = +m[3]
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0
  let t = Date.UTC(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms)
  const z = m[8]
  if (z && /^[+-]/.test(z)) {
    const sign = z[0] === '-' ? -1 : 1
    const digits = z.slice(1).replace(':', '')
    t -= sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4)) * 60000
  }
  return Number.isFinite(t) ? t : null
}

/** Time-zone offset in minutes from `UTC+0300`, `GMT+05:30`, `+0200`, `UTC` or milliseconds (SDK style). */
export function parseOffset(cell: string | undefined): number | null {
  if (cell == null) return null
  const s = cell.trim()
  if (!s) return null
  if (/^(utc|gmt|z)$/i.test(s)) return 0
  const m = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(s)
  if (m) {
    const v = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] ?? 0))
    return Math.abs(v) <= 14 * 60 ? v : null
  }
  if (/^-?\d+$/.test(s)) {
    const v = Number(s)
    if (Math.abs(v) >= 60000 && v % 60000 === 0) return Math.abs(v / 60000) <= 14 * 60 ? v / 60000 : null
    if (v === 0) return 0
  }
  return null
}

/** Local calendar day (YYYY-MM-DD) of a UTC instant at a given offset. */
export const localDate = (utcMs: number, offsetMin: number) => new Date(utcMs + offsetMin * 60000).toISOString().slice(0, 10)

/** Today's date in this device's time zone. */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Whole days from `a` to `b` (YYYY-MM-DD), b - a. */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

export function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

/* --------------------------------------------------------------------- zip */

export type ZipEntry = { path: string; method: number; flags: number; compSize: number; size: number; offset: number }

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const u64 = (b: Uint8Array, i: number) => u32(b, i) + u32(b, i + 4) * 2 ** 32

async function bytes(blob: Blob, start: number, end: number) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

/**
 * Lists a zip without reading it whole: only the end record and the central directory are read
 * (Blob.slice), so a several-hundred-MB export costs a few MB of memory until we open an entry.
 */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size
  const tailLen = Math.min(size, 22 + 0xffff + 20)
  const tail = await bytes(blob, size - tailLen, size)
  let p = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      p = i
      break
    }
  }
  if (p < 0) throw new Error('This file is not a readable .zip archive.')
  let count = u16(tail, p + 10)
  let cdSize = u32(tail, p + 12)
  let cdOffset = u32(tail, p + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const l = p - 20
    if (l >= 0 && u32(tail, l) === 0x07064b50) {
      const recOff = u64(tail, l + 8)
      const rec = await bytes(blob, recOff, recOff + 56)
      if (u32(rec, 0) === 0x06064b50) {
        count = u64(rec, 32)
        cdSize = u64(rec, 40)
        cdOffset = u64(rec, 48)
      }
    }
  }
  if (cdOffset + cdSize > size) throw new Error('The .zip archive looks truncated (was the download finished?).')
  const cd = await bytes(blob, cdOffset, cdOffset + cdSize)
  const utf8 = new TextDecoder('utf-8')
  const out: ZipEntry[] = []
  let i = 0
  for (let k = 0; k < count && i + 46 <= cd.length; k++) {
    if (u32(cd, i) !== 0x02014b50) break
    const flags = u16(cd, i + 8)
    const method = u16(cd, i + 10)
    let compSize = u32(cd, i + 20)
    let usize = u32(cd, i + 24)
    const nameLen = u16(cd, i + 28)
    const extraLen = u16(cd, i + 30)
    const commentLen = u16(cd, i + 32)
    let offset = u32(cd, i + 42)
    const path = utf8.decode(cd.subarray(i + 46, i + 46 + nameLen)).replace(/\\/g, '/')
    // ZIP64 extra field
    let e = i + 46 + nameLen
    const eEnd = e + extraLen
    while (e + 4 <= eEnd) {
      const id = u16(cd, e)
      const len = u16(cd, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (usize === 0xffffffff) (usize = u64(cd, q)), (q += 8)
        if (compSize === 0xffffffff) (compSize = u64(cd, q)), (q += 8)
        if (offset === 0xffffffff) offset = u64(cd, q)
      }
      e += 4 + len
    }
    if (!path.endsWith('/')) out.push({ path, method, flags, compSize, size: usize, offset })
    i += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Reads and inflates one zip entry (stored or deflate). */
export async function readZipEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  if (e.flags & 1) throw new Error('Password-protected .zip files are not supported.')
  const head = await bytes(blob, e.offset, e.offset + 30)
  if (u32(head, 0) !== 0x04034b50) throw new Error(`Damaged .zip entry: ${e.path}`)
  const start = e.offset + 30 + u16(head, 26) + u16(head, 28)
  const data = await bytes(blob, start, start + e.compSize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateSync(data)
  throw new Error(`Unsupported compression in ${e.path}`)
}

/* ---------------------------------------------------------------- analysis */

export type InputFile = { path: string; blob: Blob }

export type FileStatus = 'used' | 'reference' | 'skipped' | 'unrecognised' | 'error'
export type FileReport = { path: string; table: string | null; size: number; status: FileStatus; note: string; rows?: number }

export type DailyPoint = { date: string; value: number; value2?: number; at: string; n: number }

export type MetricSummary = {
  metric: ImportMetric
  points: DailyPoint[]
  files: string[]
  readings: number
  notes: string[]
}

export type StepSummary = { days: number; from: string; to: string; average: number; file: string }

export type ExportSummary = {
  metrics: MetricSummary[] // every importable table that was found, even if it yielded no days
  steps: StepSummary | null
  files: FileReport[]
  sidecars: number // jsons/ detail files that were skipped without opening
  warnings: string[]
  exportDate: string | null
  synthetic: boolean
  today: string
}

type Rec = { t: number; end: number; off: number | null; v: number; v2?: number }

type Entry = { path: string; size: number; table: string | null; stamp: string | null; inZip: boolean; read: () => Promise<Uint8Array> }

export type AnalyzeOptions = { now?: Date; onProgress?: (label: string, fraction: number) => void }

const MAX_ENTRY_BYTES = 700 * 1024 * 1024
const isSidecar = (p: string) => /(^|\/)jsons\//i.test(p) || /\.json$/i.test(p)
const isJunk = (p: string) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i.test(p)

async function expandInputs(inputs: InputFile[], warnings: string[]) {
  const entries: Entry[] = []
  const reports: FileReport[] = []
  let sidecars = 0
  for (const f of inputs) {
    const path = f.path.replace(/\\/g, '/')
    if (/\.zip$/i.test(path)) {
      let list: ZipEntry[]
      try {
        list = await listZip(f.blob)
      } catch (err) {
        reports.push({ path, table: null, size: f.blob.size, status: 'error', note: err instanceof Error ? err.message : 'Could not open this .zip file.' })
        continue
      }
      for (const z of list) {
        const p = `${path}/${z.path}`
        if (isJunk(z.path)) continue
        if (isSidecar(z.path)) {
          sidecars++
          continue
        }
        if (/\.zip$/i.test(z.path)) {
          reports.push({ path: p, table: null, size: z.size, status: 'unrecognised', note: 'A .zip inside the .zip — unzip it first, or choose the inner file directly.' })
          continue
        }
        const { table, stamp } = tableFromName(z.path)
        entries.push({ path: p, size: z.size, table, stamp, inZip: true, read: () => readZipEntry(f.blob, z) })
      }
    } else if (!isJunk(path)) {
      if (isSidecar(path)) {
        sidecars++
        continue
      }
      const { table, stamp } = tableFromName(path)
      entries.push({ path, size: f.blob.size, table, stamp, inZip: false, read: async () => new Uint8Array(await f.blob.arrayBuffer()) })
      // individually chosen CSV with an unusual name: identify it from its metadata line
      if (!table && /\.csv$/i.test(path)) {
        try {
          const head = new TextDecoder('utf-8').decode(await bytes(f.blob, 0, Math.min(f.blob.size, 4096)))
          const t = parseCsv(head).table
          if (t) entries[entries.length - 1].table = t
        } catch {
          /* keep it unrecognised */
        }
      }
    }
  }
  if (!inputs.length) warnings.push('No files were selected.')
  return { entries, reports, sidecars }
}

/** Dominant time offset across records, used where a table has no time_offset column. */
function dominantOffset(all: Rec[][]): number | null {
  const counts = new Map<number, number>()
  for (const recs of all) for (const r of recs) if (r.off != null) counts.set(r.off, (counts.get(r.off) ?? 0) + 1)
  let best: number | null = null
  let bestN = 0
  for (const [k, n] of counts) if (n > bestN) (best = k), (bestN = n)
  return best
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

const round = (v: number, digits: number) => {
  const p = 10 ** digits
  return Math.round(v * p) / p
}

type Extracted = { recs: Rec[]; rows: number; bad: number }

/** Reads the columns one table needs into compact records. */
function extract(metric: ImportMetric, csv: CsvTable): Extracted {
  const h = csv.header
  const cStart = findCol(h, 'start_time')
  const cEnd = findCol(h, 'end_time')
  const cOff = findCol(h, 'time_offset')
  const cId = findCol(h, 'datauuid')
  const seen = new Set<string>()
  const recs: Rec[] = []
  let rows = 0
  let bad = 0
  const col: Record<ImportMetric, number[]> = {
    hr: [findCol(h, 'heart_rate')],
    sleep: [findCol(h, 'sleep_duration')],
    spo2: [findCol(h, 'spo2')],
    bp: [findCol(h, 'systolic'), findCol(h, 'diastolic')],
    exercise: [findCol(h, 'duration')],
    water: [findCol(h, 'amount')],
    temp: [findCol(h, 'temperature')],
  }
  const [c1, c2] = col[metric]
  if (cStart < 0 || (c1 < 0 && metric !== 'sleep')) return { recs, rows, bad: -1 }
  for (const row of csv.rows()) {
    rows++
    if (cId >= 0) {
      const id = row[cId]?.trim()
      if (id) {
        if (seen.has(id)) continue
        seen.add(id)
      }
    }
    const t = parseTime(row[cStart])
    if (t == null) {
      bad++
      continue
    }
    const endRaw = cEnd >= 0 ? parseTime(row[cEnd]) : null
    const end = endRaw != null && endRaw >= t ? endRaw : t
    const off = cOff >= 0 ? parseOffset(row[cOff]) : null
    if (metric === 'hr') {
      const v = num(row[c1])
      if (!(v >= 25 && v <= 230)) continue
      recs.push({ t, end, off, v })
    } else if (metric === 'sleep') {
      const span = (end - t) / 60000
      if (!(span > 0 && span <= 20 * 60)) {
        bad++
        continue
      }
      const sd = c1 >= 0 ? num(row[c1]) : NaN
      recs.push({ t, end, off, v: sd > 0 && sd <= span + 1 ? sd : span })
    } else if (metric === 'spo2') {
      const v = num(row[c1])
      if (!(v >= 50 && v <= 100)) continue
      recs.push({ t, end, off, v })
    } else if (metric === 'bp') {
      const s = num(row[c1])
      const d = num(row[c2])
      if (!(s >= 60 && s <= 250 && d >= 30 && d <= 150 && s > d)) {
        bad++
        continue
      }
      recs.push({ t, end: t, off, v: s, v2: d })
    } else if (metric === 'exercise') {
      const ms = num(row[c1])
      const minutes = ms > 0 && ms <= 86400000 ? ms / 60000 : (end - t) / 60000
      if (!(minutes > 0 && minutes <= 24 * 60)) {
        bad++
        continue
      }
      recs.push({ t, end: Math.max(end, t + minutes * 60000), off, v: minutes })
    } else if (metric === 'water') {
      const v = num(row[c1])
      if (!(v > 0 && v <= 5000)) continue
      recs.push({ t, end: t, off, v })
    } else if (metric === 'temp') {
      const v = num(row[c1])
      if (!(v >= 30 && v <= 43)) {
        bad++
        continue
      }
      recs.push({ t, end: t, off, v })
    }
  }
  return { recs, rows, bad }
}

/** Merged, sorted [start, end] intervals. */
function mergeIntervals(list: [number, number][]) {
  const s = [...list].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const iv of s) {
    const last = out[out.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else out.push([iv[0], iv[1]])
  }
  return out
}

function overlaps(ivs: [number, number][], a: number, b: number) {
  let lo = 0
  let hi = ivs.length - 1
  let k = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ivs[mid][0] <= b) (k = mid), (lo = mid + 1)
    else hi = mid - 1
  }
  return k >= 0 && ivs[k][1] >= a
}

const iso = (ms: number) => new Date(ms).toISOString()

function groupByDay(recs: Rec[], key: (r: Rec) => number, off: number) {
  const days = new Map<string, Rec[]>()
  for (const r of recs) {
    const d = localDate(key(r), r.off ?? off)
    const list = days.get(d)
    if (list) list.push(r)
    else days.set(d, [r])
  }
  return days
}

function aggregate(metric: ImportMetric, recs: Rec[], off: number, busy: [number, number][] | null, notes: string[]): DailyPoint[] {
  const pts: DailyPoint[] = []
  const info = METRIC_INFO[metric]
  if (metric === 'hr') {
    const eligible = busy ? recs.filter((r) => !overlaps(busy, r.t, r.end)) : recs
    if (!busy) notes.push('Sleep and workout times were not in the export, so all heart-rate readings were used.')
    let thin = 0
    for (const [date, list] of groupByDay(eligible, (r) => r.t, off)) {
      if (list.length < 3) {
        thin++
        continue
      }
      const vals = list.map((r) => r.v).sort((a, b) => a - b)
      pts.push({ date, value: Math.round(percentile(vals, 0.25)), at: iso(Math.max(...list.map((r) => r.end))), n: list.length })
    }
    if (thin) notes.push(`${thin} day${thin === 1 ? '' : 's'} had fewer than 3 readings while awake and not exercising, and ${thin === 1 ? 'was' : 'were'} left out.`)
  } else if (metric === 'sleep') {
    for (const [date, list] of groupByDay(recs, (r) => r.end, off)) {
      list.sort((a, b) => a.t - b.t)
      const kept: Rec[] = []
      for (const r of list) {
        const prev = kept[kept.length - 1]
        if (prev && r.t < prev.end) {
          if (r.v > prev.v) kept[kept.length - 1] = r // duplicate/overlapping session: keep the longer one
          continue
        }
        kept.push(r)
      }
      const hours = kept.reduce((s, r) => s + r.v, 0) / 60
      if (hours > 16) {
        notes.push(`${date}: ${hours.toFixed(1)} h of sleep looks implausible and was left out.`)
        continue
      }
      pts.push({ date, value: round(hours, 1), at: iso(Math.max(...kept.map((r) => r.end))), n: kept.length })
    }
  } else if (metric === 'spo2' || metric === 'temp') {
    for (const [date, list] of groupByDay(recs, (r) => r.end, off)) {
      const mean = list.reduce((s, r) => s + r.v, 0) / list.length
      pts.push({ date, value: round(mean, info.digits), at: iso(Math.max(...list.map((r) => r.end))), n: list.length })
    }
  } else if (metric === 'bp') {
    for (const [date, list] of groupByDay(recs, (r) => r.t, off)) {
      const s = list.reduce((a, r) => a + r.v, 0) / list.length
      const d = list.reduce((a, r) => a + (r.v2 ?? 0), 0) / list.length
      pts.push({ date, value: Math.round(s), value2: Math.round(d), at: iso(Math.max(...list.map((r) => r.t))), n: list.length })
    }
  } else if (metric === 'exercise' || metric === 'water') {
    let capped = 0
    for (const [date, list] of groupByDay(recs, (r) => r.t, off)) {
      let total = list.reduce((s, r) => s + r.v, 0)
      total = metric === 'water' ? total / 1000 : total
      const max = metric === 'water' ? 8 : 300
      if (total > max) {
        capped++
        total = max
      }
      pts.push({ date, value: round(total, info.digits), at: iso(Math.max(...list.map((r) => r.end))), n: list.length })
    }
    if (capped) notes.push(`${capped} day${capped === 1 ? ' was' : 's were'} above ${metric === 'water' ? '8 L' : '300 min'} and ${capped === 1 ? 'was' : 'were'} capped at that value.`)
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date))
}

function stepSummary(csv: CsvTable, file: string, off: number): StepSummary | null {
  const h = csv.header
  const cDay = findCol(h, 'day_time')
  const cCount = findCol(h, 'count', 'step_count')
  const cStart = findCol(h, 'start_time', 'create_time')
  if (cCount < 0 || (cDay < 0 && cStart < 0)) return null
  const byDay = new Map<string, number>()
  for (const row of csv.rows()) {
    const c = num(row[cCount])
    if (!(c >= 0 && c < 200000)) continue
    // day_time is "UTC 00:00 of the local day", so its UTC date is the local date
    const dt = cDay >= 0 ? parseTime(row[cDay]) : null
    const date = dt != null ? new Date(dt).toISOString().slice(0, 10) : (() => {
      const t = parseTime(row[cStart])
      return t == null ? null : localDate(t, off)
    })()
    if (!date) continue
    byDay.set(date, Math.max(byDay.get(date) ?? 0, c))
  }
  if (!byDay.size) return null
  const dates = [...byDay.keys()].sort()
  const total = [...byDay.values()].reduce((a, b) => a + b, 0)
  return { days: byDay.size, from: dates[0], to: dates[dates.length - 1], average: Math.round(total / byDay.size), file }
}

/**
 * Reads the chosen files (a .zip, the files of a selected folder, or single CSVs) and returns per-metric daily
 * values plus a report of every file. Only the few summary CSVs AURA needs are ever decompressed or read.
 */
export async function analyzeExport(inputs: InputFile[], opts: AnalyzeOptions = {}): Promise<ExportSummary> {
  const now = opts.now ?? new Date()
  const today = todayLocal(now)
  const progress = opts.onProgress ?? (() => {})
  const warnings: string[] = []
  progress('Listing files', 0.02)
  const { entries, reports, sidecars } = await expandInputs(inputs, warnings)
  const synthetic = inputs.some((f) => /SYNTHETIC/.test(f.path)) || entries.some((e) => /SYNTHETIC/.test(e.path))

  // pick what to read
  const byMetric = new Map<ImportMetric, Entry[]>()
  const stepCandidates: Entry[] = []
  const stamps: string[] = []
  for (const e of entries) {
    if (e.stamp) stamps.push(e.stamp)
    const metric = metricForTable(e.table)
    if (metric && /\.csv$/i.test(e.path)) {
      byMetric.set(metric, [...(byMetric.get(metric) ?? []), e])
    } else if (e.table && STEP_TABLES.includes(e.table) && /\.csv$/i.test(e.path)) {
      stepCandidates.push(e)
    } else if (e.table) {
      reports.push({ path: e.path, table: e.table, size: e.size, status: 'skipped', note: skipReason(e.table) })
    } else {
      reports.push({ path: e.path, table: null, size: e.size, status: 'unrecognised', note: /\.csv$/i.test(e.path) ? 'Not a Samsung Health table AURA knows.' : 'Not part of a Samsung Health export.' })
    }
  }
  stepCandidates.sort((a, b) => STEP_TABLES.indexOf(a.table!) - STEP_TABLES.indexOf(b.table!))
  const stepEntry = stepCandidates[0] ?? null
  for (const e of stepCandidates.slice(1)) reports.push({ path: e.path, table: e.table, size: e.size, status: 'skipped', note: skipReason(e.table!) })

  const exportDate = stamps.map(stampDate).filter((d): d is string => !!d).sort().pop() ?? null

  // read in dependency order: sleep and exercise first (heart rate needs their time windows)
  const order: ImportMetric[] = ['sleep', 'exercise', 'hr', 'spo2', 'bp', 'water', 'temp']
  const total = order.reduce((s, m) => s + (byMetric.get(m)?.length ?? 0), 0) + (stepEntry ? 1 : 0)
  let done = 0
  const extracted = new Map<ImportMetric, { recs: Rec[]; files: string[]; readings: number; notes: string[] }>()
  const decoder = new TextDecoder('utf-8')
  for (const metric of order) {
    for (const e of byMetric.get(metric) ?? []) {
      progress(`Reading ${METRIC_INFO[metric].label.toLowerCase()}`, 0.05 + (0.85 * done) / Math.max(1, total))
      done++
      if (e.size > MAX_ENTRY_BYTES) {
        reports.push({ path: e.path, table: e.table, size: e.size, status: 'error', note: 'Too large to read in the browser.' })
        continue
      }
      try {
        const csv = parseCsv(decoder.decode(await e.read()))
        const x = extract(metric, csv)
        if (x.bad < 0) {
          reports.push({ path: e.path, table: e.table, size: e.size, status: 'error', note: 'Expected columns were not found (time or value).' })
          continue
        }
        const cur = extracted.get(metric) ?? { recs: [], files: [], readings: 0, notes: [] }
        for (const r of x.recs) cur.recs.push(r) // no spread: tables can hold hundreds of thousands of rows
        cur.files.push(e.path)
        cur.readings += x.recs.length
        if (x.bad) cur.notes.push(`${x.bad} row${x.bad === 1 ? '' : 's'} in ${e.path.split('/').pop()} had unreadable times or values and ${x.bad === 1 ? 'was' : 'were'} skipped.`)
        extracted.set(metric, cur)
        reports.push({ path: e.path, table: e.table, size: e.size, status: 'used', note: `${METRIC_INFO[metric].label}: ${x.recs.length} readings`, rows: x.rows })
      } catch (err) {
        reports.push({ path: e.path, table: e.table, size: e.size, status: 'error', note: err instanceof Error ? err.message : 'Could not read this file.' })
      }
    }
  }

  // time zone fallback
  let off = dominantOffset([...extracted.values()].map((x) => x.recs))
  if (off == null) {
    off = -now.getTimezoneOffset()
    if (extracted.size) warnings.push('No time-zone column was found; this device’s time zone was assumed for local days.')
  } else if ([...extracted.values()].some((x) => x.recs.some((r) => r.off == null))) {
    warnings.push(`Some rows had no time zone; UTC${off >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')} (the most common one in this export) was used.`)
  }

  // windows when heart rate is not "at rest"
  const sleepRecs = extracted.get('sleep')?.recs ?? []
  const exRecs = extracted.get('exercise')?.recs ?? []
  const busy = sleepRecs.length || exRecs.length ? mergeIntervals([...sleepRecs.map((r): [number, number] => [r.t, r.end]), ...exRecs.map((r): [number, number] => [r.t, r.end + 15 * 60000])]) : null

  const metrics: MetricSummary[] = []
  for (const metric of IMPORT_METRICS) {
    const x = extracted.get(metric)
    if (!x) continue
    const notes = [...x.notes]
    let points = aggregate(metric, x.recs, off, busy, notes)
    if (metric === 'exercise') {
      // no workout on a day the watch was clearly worn = 0 recorded minutes (not "missing")
      const worn = new Map<string, { hours: Set<number>; last: number }>()
      for (const r of extracted.get('hr')?.recs ?? []) {
        const o = r.off ?? off
        const d = localDate(r.t, o)
        const w = worn.get(d) ?? { hours: new Set<number>(), last: 0 }
        w.hours.add(Math.floor((r.t + o * 60000) / 3600000))
        w.last = Math.max(w.last, r.end)
        worn.set(d, w)
      }
      const have = new Set(points.map((p) => p.date))
      const zero: DailyPoint[] = []
      for (const [date, w] of worn) if (w.hours.size >= 12 && !have.has(date)) zero.push({ date, value: 0, at: iso(w.last), n: 0 })
      if (zero.length) {
        points = [...points, ...zero].sort((a, b) => a.date.localeCompare(b.date))
        notes.push(`${zero.length} day${zero.length === 1 ? '' : 's'} with the watch worn but no recorded workout count as 0 minutes.`)
      }
    }
    const future = points.filter((p) => p.date > addDays(today, 1)).length
    if (future) {
      points = points.filter((p) => p.date <= addDays(today, 1))
      notes.push(`${future} day${future === 1 ? '' : 's'} dated in the future ${future === 1 ? 'was' : 'were'} left out.`)
    }
    if (metric === 'exercise' || metric === 'water') {
      // a day's total is only complete once the day is over: drop the export day (or today, if the date is unknown)
      const cutoff = exportDate ?? today
      const partial = points.filter((p) => p.date >= cutoff).length
      if (partial) {
        points = points.filter((p) => p.date < cutoff)
        notes.push(`${exportDate ? `The export day (${exportDate})` : 'Today'} is incomplete, so its total was left out.`)
      }
    }
    metrics.push({ metric, points, files: x.files, readings: x.readings, notes })
  }

  let steps: StepSummary | null = null
  if (stepEntry) {
    progress('Reading steps (reference only)', 0.92)
    try {
      steps = stepEntry.size <= MAX_ENTRY_BYTES ? stepSummary(parseCsv(decoder.decode(await stepEntry.read())), stepEntry.path, off) : null
      reports.push({ path: stepEntry.path, table: stepEntry.table, size: stepEntry.size, status: 'reference', note: skipReason(stepEntry.table!) })
    } catch {
      reports.push({ path: stepEntry.path, table: stepEntry.table, size: stepEntry.size, status: 'error', note: 'Could not read this file.' })
    }
  }

  if (!metrics.length) {
    warnings.push(
      entries.length || reports.length
        ? 'No heart-rate, sleep, blood-oxygen, blood-pressure, exercise, water or body-temperature tables were found. Choose the whole export folder or its .zip file.'
        : 'Nothing readable was found in the selection.',
    )
  }
  const statusOrder: Record<FileStatus, number> = { used: 0, reference: 1, error: 2, skipped: 3, unrecognised: 4 }
  reports.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.path.localeCompare(b.path))
  progress('Done', 1)
  return { metrics, steps, files: reports, sidecars, warnings, exportDate, synthetic, today }
}

/* ------------------------------------------------------------- selection */

export type Selection = { from: string; to: string; metrics: ImportMetric[] }

/** Latest date with data across metrics (or null). */
export function lastDataDate(s: ExportSummary): string | null {
  return s.metrics.flatMap((m) => m.points.map((p) => p.date)).sort().pop() ?? null
}
export function firstDataDate(s: ExportSummary): string | null {
  return s.metrics.flatMap((m) => m.points.map((p) => p.date)).sort()[0] ?? null
}

/** Default selection: the last 30 days that have data, every metric that has points. */
export function defaultSelection(s: ExportSummary, days = 30): Selection {
  const last = lastDataDate(s)
  const to = last && last < s.today ? last : s.today
  return { from: addDays(to, -(days - 1)), to, metrics: s.metrics.filter((m) => m.points.length).map((m) => m.metric) }
}

export const pointsIn = (m: MetricSummary, sel: Pick<Selection, 'from' | 'to'>) => m.points.filter((p) => p.date >= sel.from && p.date <= sel.to)

/** Rows to save: one per field per local day. */
export function toImportRows(s: ExportSummary, sel: Selection): ImportRow[] {
  const rows: ImportRow[] = []
  for (const m of s.metrics) {
    if (!sel.metrics.includes(m.metric)) continue
    const fields = METRIC_INFO[m.metric].fields
    for (const p of pointsIn(m, sel)) {
      rows.push({ metric: fields[0], value: p.value, localDate: p.date, at: p.at })
      if (fields[1] && p.value2 != null) rows.push({ metric: fields[1], value: p.value2, localDate: p.date, at: p.at })
    }
  }
  return rows
}

/** AURA tracking day for a calendar date: today's day minus whole days ago (may be <= 0). */
export function trackingDay(currentDay: number, today: string, date: string) {
  return currentDay - daysBetween(date, today)
}
