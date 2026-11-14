// Upstream feeds (all key-less, CORS-enabled, public). Kept in sync with public/api/routes/spaceweather.php.
//   NASA CCMC DONKI web API  https://ccmc.gsfc.nasa.gov/DONKI-API/get/<type>  (OpenAPI: /DONKI-API/v3/api-docs)
//     max 60-day window per request; no API key; the old host kauai.ccmc.gsfc.nasa.gov moved here on 30 Sep 2026.
//   NOAA SWPC JSON products  https://services.swpc.noaa.gov/...                (U.S. Government public data)
// Self-contained (no imports) so a plain Node script can use it.
import type { SourceKey } from './sanitize'

export const DONKI_API = 'https://ccmc.gsfc.nasa.gov/DONKI-API/get/'
export const NOAA_SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json'
export const NOAA_PROTONS_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json'
export const WINDOW_DAYS = 7

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Date window in UTC days, as DONKI expects it (yyyy-MM-dd). */
export function windowFor(nowMs: number): { start: string; end: string } {
  return { start: ymd(nowMs - WINDOW_DAYS * 86400000), end: ymd(nowMs) }
}

export function upstreamUrls(nowMs: number): Record<SourceKey, string> {
  const { start, end } = windowFor(nowMs)
  const w = `startDate=${start}&endDate=${end}`
  return {
    flr: `${DONKI_API}FLR?${w}`,
    sep: `${DONKI_API}SEP?${w}`,
    cme: `${DONKI_API}CME?${w}&mostAccurateOnly=true`,
    gst: `${DONKI_API}GST?${w}`,
    notifications: `${DONKI_API}notifications?${w}&type=all`,
    scales: NOAA_SCALES_URL,
    protons: NOAA_PROTONS_URL,
  }
}
