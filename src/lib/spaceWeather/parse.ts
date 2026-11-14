// Typed, defensive readers for DONKI / NOAA records (raw upstream JSON or the server's whitelisted copy — same shape).
// Anything malformed is skipped, never guessed: a missing time drops the record, a missing class stays null.
import { safeUrl, SCALES_KEYS } from './sanitize'

export type Flare = { id: string; begin: number; peak: number | null; end: number | null; cls: string | null; region: number | null; location: string | null; link: string | null; instrument: string | null }
export type Sep = { id: string; time: number; instruments: string[]; link: string | null; linked: string[] }
export type EarthImpact = { arrival: number | null; glancing: boolean; minor: boolean; kp: number | null }
export type Cme = { id: string; start: number; location: string | null; region: number | null; speed: number | null; halfAngle: number | null; type: string | null; earth: EarthImpact | null; link: string | null; note: string | null }
export type Gst = { id: string; start: number; maxKp: number | null; kp: { time: number; kp: number }[]; link: string | null }
export type DonkiNotice = { id: string; type: string; issued: number; url: string | null; summary: string }
export type ScaleDay = { date: string; r: number | null; s: number | null; g: number | null; rMinorProb: number | null; rMajorProb: number | null; sProb: number | null }
export type Scales = { observedAt: number | null; yesterday: ScaleDay | null; now: ScaleDay | null; forecast: ScaleDay[] }
export type ProtonPoint = { t: number; flux: number }

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.map(rec).filter(Boolean) as Record<string, unknown>[]) : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** NOAA sends numbers as strings ("0", "35"); null and "" stay null. */
const numStr = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** DONKI times look like "2026-11-07T12:43Z" (no seconds); NOAA uses "2026-11-14T16:25:00Z". Returns epoch ms or null. */
export function parseTime(v: unknown): number | null {
  const s = str(v)
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?$/.exec(s)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  return Number.isFinite(t) ? t : null
}

const instrumentNames = (v: unknown) => list(v).map((i) => str(i.displayName)).filter((x): x is string => !!x)

export function parseFlares(data: unknown): Flare[] {
  const out: Flare[] = []
  for (const r of list(data)) {
    const begin = parseTime(r.beginTime)
    const id = str(r.flrID)
    if (begin == null || !id) continue
    const cls = str(r.classType)
    out.push({
      id,
      begin,
      peak: parseTime(r.peakTime),
      end: parseTime(r.endTime),
      cls: cls && /^[ABCMX]\d+(\.\d+)?$/i.test(cls) ? cls.toUpperCase() : null,
      region: num(r.activeRegionNum),
      location: str(r.sourceLocation),
      link: safeUrl(r.link),
      instrument: instrumentNames(r.instruments)[0] ?? null,
    })
  }
  return out.sort((a, b) => b.begin - a.begin)
}

export function parseSeps(data: unknown): Sep[] {
  const out: Sep[] = []
  for (const r of list(data)) {
    const time = parseTime(r.eventTime)
    const id = str(r.sepID)
    if (time == null || !id) continue
    out.push({ id, time, instruments: instrumentNames(r.instruments), link: safeUrl(r.link), linked: list(r.linkedEvents).map((l) => str(l.activityID)).filter((x): x is string => !!x) })
  }
  return out.sort((a, b) => b.time - a.time)
}

/** The Earth part of the most accurate analysis' newest WSA-ENLIL run, if the model says the CME reaches Earth. */
function earthImpact(analysis: Record<string, unknown> | null): EarthImpact | null {
  if (!analysis) return null
  const runs = list(analysis.enlilList)
  if (!runs.length) return null
  const run = runs.reduce((a, b) => ((parseTime(b.modelCompletionTime) ?? 0) > (parseTime(a.modelCompletionTime) ?? 0) ? b : a))
  const earthRow = list(run.impactList).find((i) => str(i.location)?.toLowerCase() === 'earth')
  const arrival = parseTime(run.estimatedShockArrivalTime) ?? parseTime(earthRow?.arrivalTime)
  const glancing = run.isEarthGB === true || earthRow?.isGlancingBlow === true
  const minor = run.isEarthMinorImpact === true
  if (arrival == null && !glancing && !minor && !earthRow) return null
  const kps = [num(run.kp_90), num(run.kp_135), num(run.kp_180)].filter((x): x is number => x != null)
  return { arrival, glancing, minor, kp: kps.length ? Math.max(...kps) : null }
}

export function parseCmes(data: unknown): Cme[] {
  const out: Cme[] = []
  for (const r of list(data)) {
    const start = parseTime(r.startTime)
    const id = str(r.activityID)
    if (start == null || !id) continue
    const analyses = list(r.cmeAnalyses)
    const best = analyses.find((a) => a.isMostAccurate === true) ?? analyses[0] ?? null
    const type = str(best?.type)
    out.push({
      id,
      start,
      location: str(r.sourceLocation),
      region: num(r.activeRegionNum),
      speed: num(best?.speed),
      halfAngle: num(best?.halfAngle),
      type: type && /^(S|C|O|R|ER)$/i.test(type) ? type.toUpperCase() : null,
      earth: earthImpact(best),
      link: safeUrl(r.link),
      note: str(r.note),
    })
  }
  return out.sort((a, b) => b.start - a.start)
}

export function parseStorms(data: unknown): Gst[] {
  const out: Gst[] = []
  for (const r of list(data)) {
    const start = parseTime(r.startTime)
    const id = str(r.gstID)
    if (start == null || !id) continue
    const kp = list(r.allKpIndex)
      .map((k) => ({ time: parseTime(k.observedTime), kp: num(k.kpIndex) }))
      .filter((k): k is { time: number; kp: number } => k.time != null && k.kp != null && k.kp >= 0 && k.kp <= 9)
      .sort((a, b) => a.time - b.time)
    out.push({ id, start, maxKp: kp.length ? Math.max(...kp.map((k) => k.kp)) : null, kp, link: safeUrl(r.link) })
  }
  return out.sort((a, b) => b.start - a.start)
}

/** The "## Summary:" block of a DONKI message, as plain sentences (links and blank lines removed). */
export function noticeSummary(body: string): string {
  const m = /##\s*Summary:\s*([\s\S]*?)(?:\n##\s|$)/i.exec(body)
  const text = (m ? m[1] : body)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//i.test(l) && !l.startsWith('##'))
    .join(' ')
  return text.length > 600 ? `${text.slice(0, 597)}…` : text
}

export function parseNotices(data: unknown): DonkiNotice[] {
  const out: DonkiNotice[] = []
  for (const r of list(data)) {
    const issued = parseTime(r.messageIssueTime)
    const id = str(r.messageID)
    if (issued == null || !id) continue
    out.push({ id, type: str(r.messageType) ?? 'Notice', issued, url: safeUrl(r.messageURL), summary: noticeSummary(str(r.messageBody) ?? '') })
  }
  return out.sort((a, b) => b.issued - a.issued)
}

function scaleDay(v: unknown): ScaleDay | null {
  const d = rec(v)
  if (!d) return null
  const R = rec(d.R)
  const S = rec(d.S)
  const G = rec(d.G)
  return {
    date: str(d.DateStamp) ?? '',
    r: numStr(R?.Scale),
    s: numStr(S?.Scale),
    g: numStr(G?.Scale),
    rMinorProb: numStr(R?.MinorProb),
    rMajorProb: numStr(R?.MajorProb),
    sProb: numStr(S?.Prob),
  }
}

export function parseScales(data: unknown): Scales | null {
  const d = rec(data)
  if (!d || !SCALES_KEYS.some((k) => k in d)) return null
  const now = rec(d['0'])
  const observedAt = now ? parseTime(`${str(now.DateStamp) ?? ''}T${str(now.TimeStamp) ?? ''}Z`) : null
  return {
    observedAt,
    yesterday: scaleDay(d['-1']),
    now: scaleDay(d['0']),
    forecast: ['1', '2', '3'].map((k) => scaleDay(d[k])).filter((x): x is ScaleDay => !!x),
  }
}

/** ≥10 MeV integral proton flux (pfu). Non-positive or missing values are dropped (a log axis cannot show them). */
export function parseProtons(data: unknown): ProtonPoint[] {
  const out: ProtonPoint[] = []
  for (const r of list(data)) {
    if (r.energy !== undefined && r.energy !== '>=10 MeV') continue
    const t = parseTime(r.time_tag)
    const flux = num(r.flux)
    if (t == null || flux == null || flux <= 0) continue
    out.push({ t, flux })
  }
  return out.sort((a, b) => a.t - b.t)
}
