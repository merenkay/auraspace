// Session log → next-session adjustment, by fixed rules (all "AURA rule"; the basis is cited in the UI):
//   pain reported, or effort 9–10 of 10   → step down (regress)
//   effort 7–8                           → hold
//   effort 6 or less, no pain, twice in a row → step up (progress), never beyond the block plan
// With an active caution a "progress" is only a suggestion for the care contact; the step does not change.
import type { Adapt, SessionLog } from './types'

export const MIN_STEP = -2
export const MAX_STEP = 6
const BLOCK_PLAN = [0, 1, 2, 2]

/** Planned step for a block week (1–4): adds volume in weeks 2–3, consolidates in week 4, and carries on in the next block. */
export function plannedStep(block: number, week: number): number {
  return Math.min(MAX_STEP, (Math.max(1, block) - 1) * 2 + BLOCK_PLAN[Math.min(4, Math.max(1, week)) - 1])
}

export function classify(log: Pick<SessionLog, 'effort' | 'pain'>): 'regress' | 'hold' | 'progress' {
  if (log.pain || log.effort >= 9) return 'regress'
  if (log.effort >= 7) return 'hold'
  return 'progress'
}

let dayFmt: Intl.DateTimeFormat | null = null
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  dayFmt ??= new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d)))
}

export type AdaptResult = Adapt & { painStreak: number; logged: number }

export function adaptFromLogs(logs: SessionLog[], opts: { caution: boolean; cap: number; contact: string; since?: string }): AdaptResult {
  const list = [...logs].filter((l) => !opts.since || l.date >= opts.since).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  if (!list.length) return { decision: 'start', step: 0, reason: 'No sessions logged yet. Log each session with how hard it felt, and AURA adjusts the next one.', suggestedOnly: false, painStreak: 0, logged: 0 }
  let step = 0
  let easyRun = 0
  let painStreak = 0
  let out: Adapt = { decision: 'start', step: 0, reason: '', suggestedOnly: false }
  for (const log of list) {
    const c = classify(log)
    painStreak = log.pain ? painStreak + 1 : 0
    const when = fmt(log.date)
    if (c === 'regress') {
      easyRun = 0
      step = Math.max(MIN_STEP, step - 1)
      out = { decision: 'regress', step, suggestedOnly: false, reason: log.pain ? `You reported pain on ${when}, so the next session is one step easier.` : `${when} felt very hard (${log.effort} of 10), so the next session is one step easier.` }
    } else if (c === 'hold') {
      easyRun = 0
      out = { decision: 'hold', step, suggestedOnly: false, reason: `${when} felt hard but manageable (${log.effort} of 10), so the next session stays the same.` }
    } else {
      easyRun += 1
      if (easyRun < 2) {
        out = { decision: 'hold', step, suggestedOnly: false, reason: `${when} felt moderate (${log.effort} of 10). One more session like this and AURA suggests the next step.` }
      } else if (opts.caution) {
        out = { decision: 'progress', step, suggestedOnly: true, reason: `Your last two sessions felt moderate with no pain. You may be ready for the next step — ask your ${opts.contact} first, because a caution is active.` }
      } else if (step >= opts.cap) {
        out = { decision: 'hold', step, suggestedOnly: false, reason: `Your last two sessions felt moderate. You have reached this week’s planned level, so the dose stays the same.` }
      } else {
        step = Math.min(opts.cap, step + 1)
        easyRun = 0
        out = { decision: 'progress', step, suggestedOnly: false, reason: `Your last two sessions felt moderate (6 or less of 10) with no pain, so AURA added repetitions or a set. Loads are never raised automatically.` }
      }
    }
  }
  if (painStreak >= 2) out = { ...out, reason: `${out.reason} Pain in two sessions in a row: talk to your ${opts.contact} before you continue.` }
  return { ...out, painStreak, logged: list.length }
}
