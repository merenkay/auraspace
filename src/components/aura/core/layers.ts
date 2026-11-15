// The four layers of the AURA core and what each one shows. Pure: no DOM, no three.js. The WebGL scene, the flat
// fallback, the labels and the tests all read from here.
//
// Outside to inside: 0 mission shell (mission day, signal delay, cabin readings) · 1 vitals orbit (one arc per
// vital) · 2 body-systems lattice (named nodes) · 3 voice nucleus (state and recent sound level).
// Every mark comes from the app's own data. A layer with nothing to show says so; nothing is invented.
import { CABIN_LIMITS, formatDelay } from '../../../data/missions'
import { STATUS_LABEL, type Status } from '../../../data/vitals'
import type { Evaluation } from '../../../lib/health'
import type { CabinContext } from '../../../lib/cabinLink/context'

export type LayerId = 'shell' | 'vitals' | 'systems' | 'voice'

export type LayerDef = { id: LayerId; label: string; title: string; /** outer radius in scene units */ radius: number; /** scale that brings the layer to fill the view */ zoom: number }

export const LAYERS: LayerDef[] = [
  { id: 'shell', label: 'Shell', title: 'Mission shell', radius: 1.5, zoom: 1 },
  { id: 'vitals', label: 'Vitals', title: 'Vitals orbit', radius: 1.1, zoom: 1.3 },
  { id: 'systems', label: 'Systems', title: 'Body systems', radius: 0.58, zoom: 2.35 },
  { id: 'voice', label: 'Voice', title: 'Voice nucleus', radius: 0.42, zoom: 3 },
]
export const MAX_DEPTH = LAYERS.length - 1
/** the rings, lattice and nucleus of the voice posture are drawn at this scale inside the data layers */
export const INNER_SCALE = 0.62

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function clampDepth(d: number): number {
  return Number.isFinite(d) ? clamp(d, 0, MAX_DEPTH) : 0
}

/** Scale of the whole instrument at a (fractional) depth: geometric between two layers, so a dive feels even. */
export function zoomForDepth(depth: number): number {
  const d = clampDepth(depth)
  const i = Math.min(MAX_DEPTH - 1, Math.floor(d))
  const f = d - i
  return LAYERS[i].zoom * Math.pow(LAYERS[i + 1].zoom / LAYERS[i].zoom, f)
}

/** Inverse of zoomForDepth (pinch and hand-spread arrive as zoom factors). */
export function depthForZoom(zoom: number): number {
  if (!(zoom > 0)) return 0
  if (zoom <= LAYERS[0].zoom) return 0
  for (let i = 0; i < MAX_DEPTH; i++) {
    const a = LAYERS[i].zoom
    const b = LAYERS[i + 1].zoom
    if (zoom <= b) return i + Math.log(zoom / a) / Math.log(b / a)
  }
  return MAX_DEPTH
}

/** A dive factor as the viewers use it: below 1 comes closer (deeper). */
export function diveByFactor(depth: number, factor: number): number {
  if (!(factor > 0) || !Number.isFinite(factor)) return clampDepth(depth)
  return depthForZoom(zoomForDepth(depth) / factor)
}

export function nearestLayer(depth: number): number {
  return Math.round(clampDepth(depth))
}

/** 0 at a layer, 1 half-way between two: the shell being passed lights up as you cross it. */
export function passFlash(depth: number): number {
  const d = clampDepth(depth)
  const s = Math.sin(Math.PI * (d - Math.floor(d)))
  return s * s
}

/** Opacity of something of this radius at this zoom: it fades as it grows past the edge of the view (passed). */
export function passFade(radius: number, zoom: number): number {
  return 1 - smooth(1.72, 2.7, radius * zoom)
}

// ---------------------------------------------------------------------------------------------------------
// Data

/** `none` = no reading: drawn dotted, said in words, never treated as normal. */
export type ItemStatus = Status | 'none'

export type CoreItem = {
  id: string
  layer: LayerId
  kind: 'mission' | 'cabin' | 'vital' | 'system'
  /** the key in its own domain (vital key, system id, cabin factor) */
  key: string
  short: string
  label: string
  /** value as text, without the unit ('' when there is none) */
  value: string
  unit: string
  status: ItemStatus
  /** where the value sits on its own scale, 0..1; null when there is no honest scale to show */
  fraction: number | null
  /** when it was measured / where it comes from */
  note: string
}

export type MissionInfo = { name: string; day: number; totalDays: number | null; /** null outside space profiles */ delaySec: number | null }

export type CoreData = {
  mission: CoreItem | null
  /** days flown / planned days; null when the profile has no planned length */
  missionFraction: number | null
  cabin: CoreItem[]
  /** said when `cabin` is empty */
  cabinEmpty: string
  vitals: CoreItem[]
  vitalsEmpty: string
  systems: CoreItem[]
}

export const EMPTY_DATA: CoreData = { mission: null, missionFraction: null, cabin: [], cabinEmpty: 'No cabin readings', vitals: [], vitalsEmpty: 'No measurements yet', systems: [] }

export const STATUS_WORD: Record<ItemStatus, string> = { ...STATUS_LABEL, none: 'No data' }

export function missionItem(m: MissionInfo | null): { item: CoreItem | null; fraction: number | null } {
  if (!m) return { item: null, fraction: null }
  const planned = m.totalDays && m.totalDays > 0 ? m.totalDays : null
  const fraction = planned ? clamp(m.day / planned, 0, 1) : null
  const delay = m.delaySec == null ? '' : `Signal delay: ${formatDelay(m.delaySec)}`
  return {
    item: { id: 'mission', layer: 'shell', kind: 'mission', key: 'mission', short: 'Mission', label: m.name, value: planned ? `Day ${m.day} of ${planned}` : `Day ${m.day}`, unit: '', status: 'ok', fraction, note: delay },
    fraction,
  }
}

function ago(ms: number | null): string {
  if (ms == null) return ''
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

/** Scales the cabin dials are drawn on (our display choice); the limits themselves are CABIN_LIMITS and the gas ratios. */
export const CABIN_SCALE = { t: [10, 35] as const, h: [0, 100] as const, ratio: [1, 2.5] as const }

/** Cabin readings as the consultation reads them (stored rows plus the live sensor kit). `live` = the kit is connected now. */
export function cabinItems(c: CabinContext | null, live: boolean): { items: CoreItem[]; empty: string } {
  if (!c || c.quality === 'none' || !c.latest) return { items: [], empty: 'No cabin readings' }
  const source = `${live ? 'Live sensor kit' : c.quality === 'fresh' ? 'Stored reading' : 'Old stored reading'}${live ? '' : ` · ${ago(c.ageMs)}`}`
  const now = (id: string) => c.factors.find((f) => f.id === id && f.now)
  const frac = (v: number, [lo, hi]: readonly [number, number]) => clamp((v - lo) / (hi - lo), 0, 1)
  const items: CoreItem[] = []
  const { t, h, ratio } = c.latest
  if (t != null) {
    const st: ItemStatus = now('heat') || now('cold') ? 'warn' : 'ok'
    items.push({ id: 'cabin-t', layer: 'shell', kind: 'cabin', key: 't', short: 'Cabin temp', label: 'Cabin temperature', value: t.toFixed(1), unit: '°C', status: st, fraction: frac(t, CABIN_SCALE.t), note: `${source} · comfort band ${CABIN_LIMITS.tempMin}–${CABIN_LIMITS.tempMax} °C` })
  }
  if (h != null) {
    const st: ItemStatus = now('humid') || now('dry') ? 'warn' : 'ok'
    items.push({ id: 'cabin-h', layer: 'shell', kind: 'cabin', key: 'h', short: 'Humidity', label: 'Cabin humidity', value: h.toFixed(0), unit: '%', status: st, fraction: frac(h, CABIN_SCALE.h), note: `${source} · band ${CABIN_LIMITS.rhMin}–${CABIN_LIMITS.rhMax} %` })
  }
  if (ratio != null) {
    const g = now('gas')
    const st: ItemStatus = g ? (g.level === 'alarm' ? 'crit' : 'warn') : 'ok'
    items.push({ id: 'cabin-gas', layer: 'shell', kind: 'cabin', key: 'gas', short: 'Air', label: 'Cabin air (gas sensor)', value: `${ratio.toFixed(1)}×`, unit: 'clean-air baseline', status: st, fraction: frac(ratio, CABIN_SCALE.ratio), note: source })
  }
  return { items, empty: items.length ? '' : 'No cabin readings' }
}

/** One item per vital this profile tracks: measured ones with value and status, the rest as "no reading". */
export function vitalItems(ev: Evaluation | null): CoreItem[] {
  if (!ev) return []
  const out: CoreItem[] = []
  for (const q of ev.quality.items) {
    const def = ev.defByKey[q.key]
    if (!def) continue
    const measured = q.state !== 'missing'
    const field = def.fields.find((f) => f.id === def.primary)
    const v = ev.values[def.primary]
    const fraction = measured && field && typeof v === 'number' && field.max > field.min ? clamp((v - field.min) / (field.max - field.min), 0, 1) : null
    const note = !measured ? 'Not measured yet' : q.state === 'old' ? `Last known reading, ${q.ageDays ?? '?'} days old` : q.ageDays ? `Measured ${q.ageDays} day${q.ageDays === 1 ? '' : 's'} ago` : 'Measured today'
    out.push({ id: `vital-${q.key}`, layer: 'vitals', kind: 'vital', key: q.key, short: def.short, label: def.label, value: measured ? def.display(ev.values) : '', unit: measured ? def.unit : '', status: measured ? (ev.vitalStatus[q.key] ?? 'none') : 'none', fraction, note })
  }
  return out
}

/** The body systems of this profile. A system without a current reading is `none`, not normal. */
export function systemItems(ev: Evaluation | null): CoreItem[] {
  if (!ev) return []
  return ev.systems.map((s) => {
    const measured = ev.systemMeasured[s.id]
    const alerts = ev.alerts.filter((a) => a.system === s.id)
    const note = !measured ? (ev.systemStale[s.id] ? 'Only old readings: measure again' : 'No current readings behind this system') : alerts.length ? alerts.map((a) => a.title).join(' · ') : 'All current readings in range'
    const status: ItemStatus = measured ? ev.systemStatus[s.id] : 'none'
    return { id: `system-${s.id}`, layer: 'systems', kind: 'system', key: s.id, short: s.name.split(/ [&,] | and /)[0], label: s.name, value: STATUS_WORD[status], unit: '', status, fraction: null, note }
  })
}

export function buildCoreData(input: { ev: Evaluation | null; mission: MissionInfo | null; cabin: CabinContext | null; live: boolean }): CoreData {
  const m = missionItem(input.mission)
  const c = cabinItems(input.cabin, input.live)
  return { mission: m.item, missionFraction: m.fraction, cabin: c.items, cabinEmpty: c.empty, vitals: vitalItems(input.ev), vitalsEmpty: 'No measurements yet', systems: systemItems(input.ev) }
}

export function itemsOf(data: CoreData, layer: LayerId): CoreItem[] {
  if (layer === 'shell') return [...(data.mission ? [data.mission] : []), ...data.cabin]
  if (layer === 'vitals') return data.vitals
  if (layer === 'systems') return data.systems
  return []
}

export function findItem(data: CoreData, id: string | null): CoreItem | null {
  if (!id) return null
  return [...itemsOf(data, 'shell'), ...data.vitals, ...data.systems].find((i) => i.id === id) ?? null
}

// ---------------------------------------------------------------------------------------------------------
// Where things sit. Angles in degrees, clockwise from the top; radii in scene units.

export const GEO = {
  dial: { r0: 1.365, r1: 1.415, segments: 60, gap: 1.6 },
  rail: 1.3,
  cabinAt: [292, 248, 112],
  cabinSpan: 30,
  missionAt: 62,
  vitals: { r0: 1.04, r1: 1.095, track: 1.068, gap: 6, marker: 1.16 },
  bars: { r: 0.3, rest: 0.012, max: 0.08, count: 72 },
} as const

export type ArcSlot = { id: string; /** degrees, clockwise from the top */ from: number; to: number; mid: number }

/** Each vital gets an equal share of the orbit, in the order the profile lists them. */
export function vitalSlots(items: CoreItem[]): ArcSlot[] {
  const n = items.length
  if (!n) return []
  const share = 360 / n
  const gap = n === 1 ? 0 : GEO.vitals.gap
  return items.map((it, i) => ({ id: it.id, from: i * share + gap / 2, to: (i + 1) * share - gap / 2, mid: (i + 0.5) * share }))
}

export function cabinSlots(items: CoreItem[]): ArcSlot[] {
  return items.slice(0, GEO.cabinAt.length).map((it, i) => ({ id: it.id, from: GEO.cabinAt[i] - GEO.cabinSpan / 2, to: GEO.cabinAt[i] + GEO.cabinSpan / 2, mid: GEO.cabinAt[i] }))
}

/** Point on a circle: degrees clockwise from the top, y up. */
export function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [Math.sin(a) * r, Math.cos(a) * r]
}
