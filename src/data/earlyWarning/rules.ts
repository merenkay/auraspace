// Constants of the early-warning layer. Each one is either taken from a published source (`source`)
// or is an AURA design choice (`source: null`), which the UI labels "AURA rule". Nothing here is a clinical guideline.
import type { EwSourceId } from './sources'

export type EwRule = { id: string; name: string; text: string; source: EwSourceId | null }

/** Window sizes and gates (AURA rules unless stated). */
export const EW = {
  /** Recent window for trends, run rules and sleep debt (days, including today). */
  RECENT_DAYS: 14,
  /** Personal baseline: the 28 days before the recent window. */
  BASELINE_DAYS: 28,
  /** Fewest baseline readings before AURA compares anything with the baseline. */
  MIN_BASELINE: 7,
  /** Fewest readings in the recent window for a trend test. */
  MIN_TREND: 8,
  /** Fewest readings in the recent window before a projection is drawn. */
  MIN_PROJECTION: 10,
  /** Two-sided significance level for the Mann–Kendall trend test (a conventional choice, applied here as an AURA rule). */
  ALPHA_Z: 1.96,
  /** Share of day-to-day variation the trend line must explain before AURA projects it forward. */
  MIN_R2: 0.5,
  /** Never project further ahead than twice the recent window. */
  MAX_PROJECTION_DAYS: 28,
  /** A measurement whose newest reading is older than this is "no recent data", never "stable". */
  STALE_DAYS: 3,
  /** Below-target streak length (matches the existing "three short nights" rule in health.ts). */
  STREAK_DAYS: 3,
  /** Sleep debt: nights needed in the last 14 before AURA adds it up. */
  MIN_SLEEP_NIGHTS: 10,
  /** Sleep debt flagged when the 14-night shortfall reaches one recommended night (hours). Applied with the context's sleep target. */
  SLEEP_DEBT_HOURS: 7,
  /** Van Dongen et al. 2003 restricted time in bed to 6 h for 14 days. */
  SLEEP_RESTRICTED_H: 6,
  /** NEWS2 partial score: a device reading counts if it is no older than this (hours). */
  NEWS2_READING_MAX_AGE_H: 24,
  /** A full NEWS2 check (all seven parameters entered together) stays current for this long (hours). */
  NEWS2_FULLCHECK_MAX_AGE_H: 1,
  /** Western Electric rules (NIST/SEMATECH 6.3.2). */
  WE_RUN: 8,
  WE_4OF5: [4, 5, 1] as const,
  WE_2OF3: [2, 3, 2] as const,
  WE_EXTREME_SIGMA: 3,
  WE_TREND_RUN: 6,
  /** Modified Z-score constant and outlier cut-off (NIST/SEMATECH 1.3.5.17, Iglewicz & Hoaglin). */
  MZ_CONST: 0.6745,
  MZ_OUTLIER: 3.5,
} as const

export const RULES: EwRule[] = [
  { id: 'baseline', name: 'Personal baseline', text: `Your baseline is the median of your readings in the ${EW.BASELINE_DAYS} days before the last ${EW.RECENT_DAYS} days (at least ${EW.MIN_BASELINE} readings, one per day).`, source: null },
  { id: 'outliers', name: 'Baseline outliers', text: `Baseline readings with a modified Z-score above ${EW.MZ_OUTLIER} are set aside as potential outliers before the baseline is computed.`, source: 'nistOutliers' },
  { id: 'spread', name: 'Your usual spread', text: `Day-to-day spread is the median absolute deviation (MAD) of the baseline divided by ${EW.MZ_CONST}, so it reads like a standard deviation. It is never taken as smaller than the measurement's recording step.`, source: 'nistOutliers' },
  { id: 'trend', name: 'Trend test', text: `Mann–Kendall test on the last ${EW.RECENT_DAYS} days (at least ${EW.MIN_TREND} readings); a trend counts when |z| ≥ ${EW.ALPHA_Z} (5% level, an AURA choice).`, source: 'mannKendall' },
  { id: 'slope', name: 'Rate of change', text: 'Theil–Sen slope: the median of the slopes between every pair of readings, so one odd reading cannot bend the line.', source: 'theilSen' },
  { id: 'runs', name: 'Run rules', text: `Western Electric rules on your own baseline: ${EW.WE_RUN} readings in a row on the worse side of your median; 4 of the last 5 beyond 1 spread; 2 of the last 3 beyond 2 spreads; a reading beyond ${EW.WE_EXTREME_SIGMA} spreads; ${EW.WE_TREND_RUN} readings in a row each worse than the one before.`, source: 'nistControl' },
  { id: 'level', name: 'Early warning vs. worth watching', text: 'An early warning needs two independent signs to agree (a significant trend plus a run rule, or a projection); one sign alone is listed as "worth watching".', source: null },
  { id: 'projection', name: 'Projection', text: `Only drawn when there are at least ${EW.MIN_PROJECTION} readings, the trend test is significant and the line explains at least ${EW.MIN_R2 * 100}% of the variation; never more than ${EW.MAX_PROJECTION_DAYS} days ahead. It is an estimate from a straight line, not a forecast. The limits it projects to are the same attention and urgent lines AURA uses everywhere.`, source: null },
  { id: 'stale', name: 'Missing data', text: `A measurement with no reading in the last ${EW.STALE_DAYS} days is reported as "no recent data", never as stable.`, source: null },
  { id: 'streak', name: 'Below-target streak', text: `${EW.STREAK_DAYS} or more days in a row below the daily target (water, exercise, sleep).`, source: null },
  { id: 'sleepDebt', name: 'Sleep debt', text: `Hours below the sleep target added up over the last ${EW.RECENT_DAYS} nights (at least ${EW.MIN_SLEEP_NIGHTS} nights logged). Flagged at ${EW.SLEEP_DEBT_HOURS} h (one recommended night, an AURA rule); an early warning when the average is ${EW.SLEEP_RESTRICTED_H} h or less, the restriction studied by Van Dongen et al.`, source: 'vanDongen2003' },
  { id: 'news2Recency', name: 'NEWS2 timing', text: `For the partial NEWS2, a device reading counts if it is under ${EW.NEWS2_READING_MAX_AGE_H} h old. A full check stays current for ${EW.NEWS2_FULLCHECK_MAX_AGE_H} h.`, source: null },
]
