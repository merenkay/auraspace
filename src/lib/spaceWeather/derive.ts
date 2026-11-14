// Deterministic rules that turn the feeds into what the crew sees. No dose is computed here: these are event
// reports and NOAA scale levels, nothing more. Thresholds that are AURA's own choices are marked "demo choice".
import type { Status } from '../../data/vitals'
import { CME_TYPE, flareInfo, flareRank, gFromKp, scaleName, sFromFlux } from './explain'
import { parseCmes, parseFlares, parseNotices, parseProtons, parseScales, parseSeps, parseStorms, type Cme, type DonkiNotice, type Flare, type Gst, type ProtonPoint, type Scales, type Sep } from './parse'
import { SOURCE_KEYS, type SourceKey } from './sanitize'
import type { Snapshot } from './types'

const HOUR = 3600000
/** Start of the UTC day: DONKI windows are whole UTC days (startDate=yyyy-MM-dd). */
const dayStart = (t: number) => t - (((t % 86400000) + 86400000) % 86400000)
const DAY = 24 * HOUR

/** A copy older than this is shown as "out of date" and never as a current "normal" (demo choice). */
export const STALE_MS = 3 * HOUR
/** A proton reading older than this does not count as "now" (GOES 5-minute data; demo choice). */
export const FLUX_FRESH_MS = 30 * 60000
/** A DONKI SEP event this recent keeps the radiation status at "attention" (demo choice). */
export const SEP_RECENT_MS = DAY
/** NOAA's forecast chance of S1 or greater at or above this shows a "watch" note (demo choice). */
export const FORECAST_WATCH_PCT = 25

export type Model = {
  flares: Flare[]
  seps: Sep[]
  cmes: Cme[]
  storms: Gst[]
  notices: DonkiNotice[]
  scales: Scales | null
  protons: ProtonPoint[]
  /** Fetch time per feed (epoch ms) — null when the feed never arrived. */
  fetched: Partial<Record<SourceKey, number | null>>
  errors: Partial<Record<SourceKey, string>>
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

export function buildModel(s: Snapshot): Model {
  const src = s.sources
  const fetched: Model['fetched'] = {}
  const errors: Model['errors'] = {}
  for (const k of SOURCE_KEYS) {
    const st = src[k]
    fetched[k] = st && st.data != null ? ms(st.fetchedAt) : null
    if (st?.error) errors[k] = st.error
  }
  return {
    flares: parseFlares(src.flr?.data),
    seps: parseSeps(src.sep?.data),
    cmes: parseCmes(src.cme?.data),
    storms: parseStorms(src.gst?.data),
    notices: parseNotices(src.notifications?.data),
    scales: parseScales(src.scales?.data),
    protons: parseProtons(src.protons?.data),
    fetched,
    errors,
  }
}

/* ------------------------------------------------------------- freshness */

export type Freshness = {
  /** Newest fetch time over all feeds (epoch ms), null when nothing arrived. */
  newest: number | null
  /** Oldest fetch time over the feeds that did arrive. */
  oldest: number | null
  ageMs: number | null
  stale: boolean
  /** Feeds that never arrived. */
  missing: SourceKey[]
  /**
   * The moment the data describes. Live and fresh: now. Otherwise the newest fetch time, so a saved copy still
   * shows "its" last 7 days instead of an empty window.
   */
  asOf: number
}

export function freshness(m: Model, now: number): Freshness {
  const times = SOURCE_KEYS.map((k) => m.fetched[k]).filter((t): t is number => t != null)
  const newest = times.length ? Math.max(...times) : null
  const oldest = times.length ? Math.min(...times) : null
  const ageMs = newest == null ? null : Math.max(0, now - newest)
  const stale = ageMs == null || ageMs > STALE_MS
  return { newest, oldest, ageMs, stale, missing: SOURCE_KEYS.filter((k) => m.fetched[k] == null), asOf: stale && newest != null ? newest : now }
}

/* ------------------------------------------------------------- radiation storm */

export type Advisory = 'none' | 'watch' | 'storm' | 'severe'

export type RadiationStorm = {
  /** NOAA S level that applies now (0 = none), null when unknown or out of date. */
  level: number | null
  /** Where `level` came from. */
  basis: 'noaa-scale' | 'goes-flux' | 'drill' | null
  /** Last known level even if out of date (for "last known: S0 · 6 h ago"). */
  lastKnown: number | null
  latestFlux: ProtonPoint | null
  /** A DONKI SEP event in the last 24 h before `asOf`. */
  recentSep: Sep | null
  /** NOAA's chance (%) of S1 or greater, per forecast day. */
  forecast: { date: string; prob: number }[]
  maxForecastProb: number | null
  status: Status | null
  advisory: Advisory
  drill: boolean
}

export function radiationStorm(m: Model, now: number, opts: { drill?: boolean } = {}): RadiationStorm {
  const f = freshness(m, now)
  const scalesFresh = m.fetched.scales != null && now - m.fetched.scales <= STALE_MS
  const noaaNow = m.scales?.now?.s ?? null
  const latestFlux = m.protons.length ? m.protons[m.protons.length - 1] : null
  const fluxFresh = latestFlux != null && now - latestFlux.t <= FLUX_FRESH_MS
  const fluxLevel = fluxFresh ? sFromFlux(latestFlux!.flux) : null

  let level: number | null = null
  let basis: RadiationStorm['basis'] = null
  if (scalesFresh && noaaNow != null) {
    level = noaaNow
    basis = 'noaa-scale'
  }
  if (fluxLevel != null && (level == null || fluxLevel > level)) {
    level = fluxLevel
    basis = 'goes-flux'
  }
  const lastKnown = level ?? noaaNow ?? (latestFlux ? sFromFlux(latestFlux.flux) : null)

  const recentSep = m.seps.find((s) => s.time <= f.asOf + HOUR && f.asOf - s.time <= SEP_RECENT_MS) ?? null
  const forecast = (m.scales?.forecast ?? []).filter((d) => d.sProb != null).map((d) => ({ date: d.date, prob: d.sProb! }))
  const maxForecastProb = forecast.length ? Math.max(...forecast.map((d) => d.prob)) : null

  if (opts.drill) {
    return { level: 3, basis: 'drill', lastKnown, latestFlux, recentSep, forecast, maxForecastProb, status: 'crit', advisory: 'severe', drill: true }
  }

  let status: Status | null
  let advisory: Advisory
  if (level == null) {
    // Out of date or missing: never "normal". A recent SEP in the saved data still deserves attention.
    status = recentSep && !f.stale ? 'warn' : null
    advisory = recentSep && !f.stale ? 'watch' : 'none'
  } else if (level >= 3) {
    status = 'crit'
    advisory = 'severe'
  } else if (level >= 1) {
    status = 'warn'
    advisory = 'storm'
  } else if (recentSep) {
    status = 'warn'
    advisory = 'watch'
  } else {
    status = 'ok'
    advisory = scalesFresh && maxForecastProb != null && maxForecastProb >= FORECAST_WATCH_PCT ? 'watch' : 'none'
  }
  return { level, basis, lastKnown, latestFlux, recentSep, forecast, maxForecastProb, status, advisory, drill: false }
}

/* ------------------------------------------------------------- condition level */

export type Condition = {
  /** quiet: nothing notable; active: M/X flare, fast CME, SEP or Earth-directed CME in the last 24 h; storm: S or G ≥ 1 now. */
  level: 'quiet' | 'active' | 'storm' | 'unknown'
  label: string
  /** Strongest flare in the 7-day window before `asOf`. */
  topFlare: Flare | null
  /** Geomagnetic level now (NOAA scale when fresh, else the strongest DONKI storm of the last 24 h). */
  g: number | null
  r: number | null
  reasons: string[]
}

export function condition(m: Model, now: number, storm: RadiationStorm): Condition {
  const f = freshness(m, now)
  const from = dayStart(f.asOf - 7 * DAY)
  const day = f.asOf - DAY
  const flares7 = m.flares.filter((x) => x.begin >= from && x.begin <= f.asOf + HOUR)
  const topFlare = flares7.reduce<Flare | null>((a, b) => (flareRank(b.cls) > flareRank(a?.cls) ? b : a), null)
  const scalesFresh = m.fetched.scales != null && now - m.fetched.scales <= STALE_MS
  const recentStorm = m.storms.filter((s) => s.start >= day)
  const gDonki = recentStorm.length ? Math.max(...recentStorm.map((s) => gFromKp(s.maxKp) ?? 0)) : null
  const g = scalesFresh ? (m.scales?.now?.g ?? gDonki) : null
  const r = scalesFresh ? (m.scales?.now?.r ?? null) : null

  const reasons: string[] = []
  const bigFlares = flares7.filter((x) => x.begin >= day && (flareInfo(x.cls)?.r ?? 0) >= 1)
  if (bigFlares.length) reasons.push(`${bigFlares.length} M- or X-class flare${bigFlares.length > 1 ? 's' : ''} in the last 24 h`)
  const earthCmes = m.cmes.filter((c) => c.earth && c.start >= f.asOf - 5 * DAY && (c.earth.arrival == null || c.earth.arrival >= f.asOf - 12 * HOUR))
  if (earthCmes.length) reasons.push(`${earthCmes.length} CME${earthCmes.length > 1 ? 's' : ''} modelled to reach Earth`)
  if (storm.recentSep) reasons.push('solar energetic particle event in the last 24 h')

  let level: Condition['level']
  if (storm.drill) level = 'storm'
  else if (f.newest == null) level = 'unknown'
  else if ((storm.level ?? 0) >= 1 || (g ?? 0) >= 1) level = 'storm'
  else if (reasons.length) level = 'active'
  else level = 'quiet'
  if (storm.drill) reasons.unshift('simulated radiation storm S3 (drill, not real data)')
  else if ((storm.level ?? 0) >= 1) reasons.unshift(`radiation storm ${scaleName('S', storm.level)}`)
  if ((g ?? 0) >= 1) reasons.unshift(`geomagnetic storm ${scaleName('G', g)}`)

  const label = { quiet: 'Quiet', active: 'Active', storm: 'Storm', unknown: 'No data' }[level]
  return { level, label, topFlare, g, r, reasons }
}

/* ------------------------------------------------------------- timeline */

export type TimelineKind = 'flare' | 'sep' | 'cme' | 'gst' | 'arrival' | 'drill'
export type TimelineEvent = {
  id: string
  kind: TimelineKind
  time: number
  title: string
  detail: string
  link: string | null
  /** M/X flares, SEPs, storms, fast or Earth-directed CMEs. */
  notable: boolean
  forecast?: boolean
  simulated?: boolean
}

const utc = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}
export const formatUtc = utc

const region = (n: number | null, loc: string | null) => [n ? `region AR ${n}` : null, loc ? `at ${loc}` : null].filter(Boolean).join(' ')

/** Events of the `days` before `asOf`, newest first, plus modelled CME arrivals still ahead. Slow CMEs that miss Earth are counted, not listed. */
export function recentEvents(m: Model, now: number, days = 7, opts: { drill?: boolean } = {}): { events: TimelineEvent[]; hiddenCmes: number } {
  const f = freshness(m, now)
  const from = dayStart(f.asOf - days * DAY)
  const until = f.asOf + HOUR
  const inWindow = (t: number) => t >= from && t <= until
  const out: TimelineEvent[] = []

  for (const x of m.flares) {
    if (!inWindow(x.begin)) continue
    const info = flareInfo(x.cls)
    const where = region(x.region, x.location)
    out.push({
      id: x.id,
      kind: 'flare',
      time: x.peak ?? x.begin,
      title: `Solar flare ${x.cls ?? '(class not given)'}`,
      detail: [`Peak ${utc(x.peak ?? x.begin)}`, where, info && info.r >= 1 ? `radio blackout level R${info.r}` : null].filter(Boolean).join(' · '),
      link: x.link,
      notable: (info?.r ?? 0) >= 1,
    })
  }
  for (const s of m.seps) {
    if (!inWindow(s.time)) continue
    out.push({ id: s.id, kind: 'sep', time: s.time, title: 'Solar energetic particle event', detail: [`Detected ${utc(s.time)}`, s.instruments.slice(0, 2).join(', ')].filter(Boolean).join(' · '), link: s.link, notable: true })
  }
  let hiddenCmes = 0
  for (const c of m.cmes) {
    if (!inWindow(c.start)) continue
    const fast = c.type != null && c.type !== 'S'
    if (!fast && !c.earth) {
      hiddenCmes++
      continue
    }
    const earth = c.earth
      ? `model: ${c.earth.glancing ? 'glancing blow at Earth' : c.earth.minor ? 'minor impact at Earth' : 'reaches Earth'}${c.earth.arrival ? ` about ${utc(c.earth.arrival)}` : ''}`
      : 'not modelled to reach Earth'
    out.push({
      id: c.id,
      kind: 'cme',
      time: c.start,
      title: `Coronal mass ejection${c.speed != null ? ` · ${Math.round(c.speed)} km/s` : ''}`,
      detail: [`Start ${utc(c.start)}`, c.type ? CME_TYPE[c.type] : null, region(c.region, c.location), earth].filter(Boolean).join(' · '),
      link: c.link,
      notable: fast || !!c.earth,
    })
    if (c.earth?.arrival != null && c.earth.arrival > f.asOf) {
      out.push({ id: `${c.id}-arrival`, kind: 'arrival', time: c.earth.arrival, title: 'Modelled CME arrival at Earth', detail: `${c.earth.glancing ? 'Glancing blow' : 'Arrival'} about ${utc(c.earth.arrival)} (WSA-ENLIL model, ± hours)`, link: c.link, notable: true, forecast: true })
    }
  }
  for (const g of m.storms) {
    if (!inWindow(g.start)) continue
    const lvl = gFromKp(g.maxKp)
    out.push({ id: g.id, kind: 'gst', time: g.start, title: `Geomagnetic storm${lvl ? ` ${scaleName('G', lvl)}` : ''}`, detail: [`Start ${utc(g.start)}`, g.maxKp != null ? `highest Kp ${g.maxKp}` : null].filter(Boolean).join(' · '), link: g.link, notable: true })
  }
  if (opts.drill) {
    out.push({ id: 'drill', kind: 'drill', time: now, title: 'Simulated radiation storm S3 (drill)', detail: 'Not real data. Shows what AURA displays during a strong solar particle event.', link: null, notable: true, simulated: true })
  }
  out.sort((a, b) => b.time - a.time)
  return { events: out, hiddenCmes }
}
