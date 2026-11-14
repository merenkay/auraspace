// Small, dependency-free robust statistics used by the early-warning layer. Pure functions, deterministic.
// Sources: NIST/SEMATECH e-Handbook (MAD, modified Z-score), SciPy theilslopes (Theil 1950, Sen 1968),
// R trend::mk.test (Mann–Kendall with tie correction). See src/data/earlyWarning/sources.ts.

export type Pt = { day: number; value: number }

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median absolute deviation from the median: median(|x − median(x)|) (NIST 1.3.5.6). */
export function mad(xs: readonly number[]): number {
  if (!xs.length) return NaN
  const m = median(xs)
  return median(xs.map((x) => Math.abs(x - m)))
}

/** Modified Z-score of x against a sample (NIST 1.3.5.17): 0.6745 (x − median) / MAD. Infinity-safe when MAD = 0. */
export function modifiedZ(x: number, med: number, madValue: number, k = 0.6745): number {
  if (madValue === 0) return x === med ? 0 : x > med ? Infinity : -Infinity
  return (k * (x - med)) / madValue
}

/** Theil–Sen line: slope = median of all pairwise slopes (distinct x only, as in Sen 1968); intercept = median(y) − slope·median(x). */
export function theilSen(pts: readonly Pt[]): { slope: number; intercept: number } | null {
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].day - pts[i].day
      if (dx !== 0) slopes.push((pts[j].value - pts[i].value) / dx)
    }
  if (!slopes.length) return null
  const slope = median(slopes)
  const intercept = median(pts.map((p) => p.value)) - slope * median(pts.map((p) => p.day))
  return { slope, intercept }
}

/**
 * Mann–Kendall trend test on values in time order. S = Σ sgn(x_j − x_k);
 * Var(S) = {n(n−1)(2n+5) − Σ t(t−1)(2t+5)}/18 (tie groups t); z = sgn(S)(|S| − 1)/σ (continuity correction).
 */
export function mannKendall(values: readonly number[]): { s: number; z: number; p: number; n: number } {
  const n = values.length
  let s = 0
  for (let k = 0; k < n - 1; k++) for (let j = k + 1; j < n; j++) s += Math.sign(values[j] - values[k])
  const ties = new Map<number, number>()
  for (const v of values) ties.set(v, (ties.get(v) ?? 0) + 1)
  let tieTerm = 0
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5)
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18
  if (n < 3 || variance <= 0) return { s, z: 0, p: 1, n }
  const z = s === 0 ? 0 : (Math.sign(s) * (Math.abs(s) - 1)) / Math.sqrt(variance)
  return { s, z, p: 2 * (1 - normalCdf(Math.abs(z))), n }
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8). Used only to report a p-value. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const q = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - q : q
}

/** Share of variation explained by a given line: 1 − SSres/SStot (may be negative for a bad line; 0 when the data are flat). */
export function rSquared(pts: readonly Pt[], line: { slope: number; intercept: number }): number {
  if (pts.length < 2) return 0
  const mean = pts.reduce((a, p) => a + p.value, 0) / pts.length
  let ssTot = 0
  let ssRes = 0
  for (const p of pts) {
    ssTot += (p.value - mean) ** 2
    ssRes += (p.value - (line.intercept + line.slope * p.day)) ** 2
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot
}
