// Shared by Diagnostics and History: reference bands, tracking-day dates, axis helpers. No React, no recharts.
import type { VitalKey } from '../data/vitals'

/** Population reference ranges drawn as the green band on a trend chart (for blood pressure: the upper number only). */
export const BANDS: Partial<Record<VitalKey, [number, number]>> = {
  bp: [90, 130], hr: [50, 100], spo2: [95, 100], temp: [36.1, 37.5], glucose: [70, 99], sleep: [7, 9], mood: [4, 5], exercise: [90, 150], vision: [4, 5], water: [2.5, 4],
}

export const AXIS_LABEL = { fill: 'var(--color-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }

/** Calendar date of a tracking day: today minus the days in between (days can be <= 0 for imported history). */
export function dateOfDay(day: number, today: number) {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - (today - day))
  return d
}
// One formatter each, made once (toLocaleDateString with options builds a new one per call; charts call these per tick)
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
export const fmtShort = (d: Date) => SHORT.format(d)
export const fmtLong = (d: Date) => LONG.format(d)

/** Round y-axis bounds and ticks (about five) so the scale reads 4, 5, 6 instead of 4.25, 5.1, 5.95. */
export function niceAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || Math.abs(hi) * 0.1 || 1
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = min; v <= max + step / 2; v += step) ticks.push(+v.toFixed(6))
  return { domain: [+min.toFixed(6), +max.toFixed(6)], ticks }
}
