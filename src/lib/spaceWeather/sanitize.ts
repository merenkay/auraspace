// Field whitelist for the seven upstream feeds. It mirrors public/api/routes/spaceweather.php exactly:
// the server stores only these fields, and the browser applies the same filter when it reads NASA/NOAA directly
// (demo mode) or loads the bundled sample. Unknown fields are dropped, strings are length-bounded, links must be
// https on a nasa.gov / noaa.gov host, lists are capped. Self-contained (no imports) so a plain Node script can use it.

export type SourceKey = 'flr' | 'sep' | 'cme' | 'gst' | 'notifications' | 'scales' | 'protons'
export const SOURCE_KEYS: SourceKey[] = ['flr', 'sep', 'cme', 'gst', 'notifications', 'scales', 'protons']

type Spec =
  | { t: 's'; max: number }
  | { t: 'n' }
  | { t: 'i' }
  | { t: 'b' }
  | { t: 'u' }
  | { t: 'l'; max: number; of: Spec }
  | { t: 'o'; keys: Record<string, Spec> }

const S = (max: number): Spec => ({ t: 's', max })
const N: Spec = { t: 'n' }
const I: Spec = { t: 'i' }
const B: Spec = { t: 'b' }
const U: Spec = { t: 'u' }
const L = (max: number, of: Spec): Spec => ({ t: 'l', max, of })
const O = (keys: Record<string, Spec>): Spec => ({ t: 'o', keys })

const T = S(25) // ISO-like timestamps such as 2026-11-07T12:43Z
const ID = S(80)
const INSTRUMENTS = L(8, O({ displayName: S(80) }))
const LINKED = L(30, O({ activityID: ID }))

export const SPECS: Record<Exclude<SourceKey, 'scales' | 'protons'>, Spec> = {
  flr: L(200, O({ flrID: ID, beginTime: T, peakTime: T, endTime: T, classType: S(8), sourceLocation: S(12), activeRegionNum: I, link: U, instruments: INSTRUMENTS, linkedEvents: LINKED })),
  sep: L(200, O({ sepID: ID, eventTime: T, link: U, instruments: INSTRUMENTS, linkedEvents: LINKED })),
  cme: L(
    200,
    O({
      activityID: ID,
      startTime: T,
      sourceLocation: S(12),
      activeRegionNum: I,
      note: S(600),
      link: U,
      linkedEvents: LINKED,
      cmeAnalyses: L(
        10,
        O({
          isMostAccurate: B,
          time21_5: T,
          latitude: N,
          longitude: N,
          halfAngle: N,
          speed: N,
          type: S(4),
          link: U,
          enlilList: L(
            10,
            O({
              modelCompletionTime: T,
              estimatedShockArrivalTime: T,
              isEarthGB: B,
              isEarthMinorImpact: B,
              kp_90: I,
              kp_135: I,
              kp_180: I,
              link: U,
              impactList: L(30, O({ location: S(40), arrivalTime: T, isGlancingBlow: B })),
            }),
          ),
        }),
      ),
    }),
  ),
  gst: L(100, O({ gstID: ID, startTime: T, link: U, allKpIndex: L(60, O({ observedTime: T, kpIndex: N, source: S(16) })), linkedEvents: LINKED })),
  notifications: L(100, O({ messageType: S(16), messageID: S(40), messageURL: U, messageIssueTime: T, messageBody: S(3000) })),
}

const SCALES_DAY = O({
  DateStamp: S(12),
  TimeStamp: S(10),
  R: O({ Scale: S(2), Text: S(20), MinorProb: S(4), MajorProb: S(4) }),
  S: O({ Scale: S(2), Text: S(20), Prob: S(4) }),
  G: O({ Scale: S(2), Text: S(20) }),
})
/** NOAA scales object keys: -1 = yesterday, 0 = now, 1..3 = forecast days. */
export const SCALES_KEYS = ['-1', '0', '1', '2', '3']
const PROTON = O({ time_tag: T, satellite: I, flux: N, energy: S(12) })
export const PROTON_ENERGY = '>=10 MeV'
export const PROTON_MAX = 1500

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const ALLOWED_HOST = /(^|\.)(nasa|noaa)\.gov$/i

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 300 || /[\s"<>\\]/.test(v)) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname) ? v : null
  } catch {
    return null
  }
}

function pick(v: unknown, spec: Spec): unknown {
  switch (spec.t) {
    case 's':
      return typeof v === 'string' ? [...v.replace(CONTROL, '')].slice(0, spec.max).join('') : null
    case 'n':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'i':
      return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 2147483647 ? v : null
    case 'b':
      return typeof v === 'boolean' ? v : null
    case 'u':
      return safeUrl(v)
    case 'l':
      return Array.isArray(v) ? v.slice(0, spec.max).map((x) => pick(x, spec.of)) : []
    case 'o': {
      if (!isObj(v)) return null
      const out: Record<string, unknown> = {}
      for (const [k, s] of Object.entries(spec.keys)) if (k in v) out[k] = pick(v[k], s)
      return out
    }
  }
}

/** Whitelists one feed. Returns null when the payload does not have the expected top-level shape. */
export function sanitizeSource(key: SourceKey, raw: unknown): unknown {
  if (key === 'scales') {
    if (!isObj(raw)) return null
    const out: Record<string, unknown> = {}
    for (const k of SCALES_KEYS) if (k in raw) out[k] = pick(raw[k], SCALES_DAY)
    return Object.keys(out).length ? out : null
  }
  if (key === 'protons') {
    if (!Array.isArray(raw)) return null
    const rows = raw.filter((r) => isObj(r) && r.energy === PROTON_ENERGY)
    return rows.slice(-PROTON_MAX).map((r) => pick(r, PROTON))
  }
  if (!Array.isArray(raw)) return null
  return pick(raw, SPECS[key])
}
