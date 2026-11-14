// When a reading still counts for the health score, and when there is enough data for a score at all.
// These are AURA rules (design choices for this app), not clinical guidelines; the UI labels them "AURA rule".
// The default window is the early-warning layer's "no recent data" window, so the two pages never disagree.
import { EW } from './earlyWarning/rules'
import type { VitalKey } from './vitals'

/**
 * A reading is "current" while it is at most this many days old, counted on the mission clock:
 * today's mission day minus the mission day of the reading (0 = logged today).
 * Registered members' mission day is the calendar day since they joined, so for them this is plain calendar age.
 * The simulated crew is a snapshot at its mission day, so its readings stay current for as long as that snapshot is shown.
 */
export const FRESH_DAYS_DEFAULT: number = EW.STALE_DAYS

/** Exceptions to the default window (days). The near-vision check is a weekly self-test. */
export const FRESH_DAYS: Partial<Record<VitalKey, number>> = { vision: 7 }

export const freshDaysFor = (key: VitalKey): number => FRESH_DAYS[key] ?? FRESH_DAYS_DEFAULT

/** Sufficient for a score: at least this share of the measurements AURA tracks in the person's context is current... */
export const SCORE_MIN_SHARE = 0.5
/** ...including these, the readings every context relies on most. */
export const SCORE_REQUIRED: VitalKey[] = ['bp', 'hr']

/** One-line rule texts for the "How the score is calculated" disclosure (all AURA rules). */
export const FRESHNESS_RULES = {
  window: `A reading counts as current for ${FRESH_DAYS_DEFAULT} days (7 for the weekly vision check), counted in mission days — the same window the early-warning page uses for "no recent data".`,
  sufficient: `A score needs at least half of the measurements AURA tracks for you to be current, including blood pressure and heart rate. Otherwise AURA shows "Insufficient data" instead of a number.`,
  missing: 'Missing and old readings are never scored as normal and never as bad health; they simply do not count. Old readings are listed with their time so you can re-measure.',
  news2: 'The NEWS2 card is stricter (24 h) because it scores acute illness, not your overall picture.',
} as const
