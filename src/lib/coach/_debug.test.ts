import { it } from 'vitest'
import { EXERCISE_BY_ID } from '../../data/coach/exercises'
import { emptyProfile } from '../../data/conditions/profile'
import { buildCoach, todaySummary } from './index'
import type { TrainingProfile } from './types'

const show = (label: string, r: ReturnType<typeof buildCoach>) => {
  const p = r.programme
  const lines = [`== ${label}: focus ${p.focus.join(',')} days ${p.targets.days} S${p.targets.strength} A${p.targets.aerobic} B${p.targets.balance} aerMin ${p.targets.aerobicMinutes} wk${p.weekIndex}`]
  for (const s of p.weeks[0].sessions) {
    lines.push(`  ${s.key} ${s.title} (${s.minutes}m) — ${s.why}`)
    for (const part of [s.warmup, ...s.main, s.cooldown]) lines.push(`     ${part.title} ${part.minutes}m: ` + part.items.map((i) => `${EXERCISE_BY_ID[i.exerciseId].name} [${i.dose.sets}x${i.dose.reps ?? ''}${i.dose.seconds ? '@' + i.dose.seconds + 's' : ''}${i.dose.minutes ? i.dose.minutes + 'min' : ''} e${i.dose.effort.join('-')}]`).join('; '))
  }
  lines.push('  subs: ' + p.substitutions.map((s) => `${s.from}->${s.to}`).join(', '))
  lines.push('  adj: ' + p.adjustments.map((a) => a.text).join(' | '))
  lines.push('  summary: ' + todaySummary(r))
  console.log(lines.join('\n'))
}

it('debug', () => {
  const base = { ev: null, rows: [], latest: null, sleepAvg: null, day: 142, today: '2026-11-16', logs: [] }
  show('space default', buildCoach({ ...base, context: 'space', profile: null, training: null }))
  show('home default', buildCoach({ ...base, context: 'home', profile: null, training: null, day: 20 }))
  const home: TrainingProfile = { focus: ['muscle'], confirmed: true, level: 'starting', daysPerWeek: 3, minutes: 30, equipment: ['chair', 'wall', 'band', 'light-weights'], limits: [], startedAt: '2026-11-16', updatedAt: null, context: 'home' }
  show('home muscle', buildCoach({ ...base, context: 'home', profile: { ...emptyProfile(), ageBand: '80+' }, training: home }))
  show('home balance', buildCoach({ ...base, context: 'home', profile: { ...emptyProfile(), conditions: ['falls-history', 'osteoporosis'] }, training: { ...home, focus: ['balance'], equipment: ['chair', 'wall', 'step'] } }))
  show('home bp', buildCoach({ ...base, context: 'home', profile: { ...emptyProfile(), medicines: ['blood-pressure'] }, training: { ...home, focus: ['bp'], minutes: 45 } }))
  show('polar default', buildCoach({ ...base, context: 'polar', profile: null, training: null }))
  show('polar regular fitness', buildCoach({ ...base, context: 'polar', profile: null, training: { ...home, context: 'polar', focus: ['fitness', 'mood'], level: 'regular', minutes: 45, equipment: ['dumbbells', 'band', 'bike', 'bench', 'chair', 'wall'] } }))
})
