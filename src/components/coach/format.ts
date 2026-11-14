// Plain-language text for doses and dates in the Coach UI.
import { EXERCISE_BY_ID } from '../../data/coach/exercises'
import type { Dose, PlannedExercise } from '../../lib/coach/types'

export function effortText(e: [number, number]) {
  const word = e[1] <= 4 ? 'light' : e[1] <= 6 ? 'moderate' : 'hard'
  return `effort ${e[0]}–${e[1]} of 10 (${word})`
}

export function doseText(item: PlannedExercise): string {
  const ex = EXERCISE_BY_ID[item.exerciseId]
  const d: Dose = item.dose
  const bits: string[] = []
  if (d.minutes) bits.push(`${d.minutes} min`)
  else if (d.reps) {
    const unit = ex?.dose.unit ? ` ${ex.dose.unit}` : ''
    const hold = d.seconds ? `, hold ${d.seconds} s` : ''
    const each = d.perSide ? ' each side' : ''
    bits.push(d.sets > 1 ? `${d.sets} sets × ${d.reps}${unit}${each}${hold}` : `${d.reps}${unit}${each}${hold}`)
  }
  if (ex?.protocol) bits.push(ex.protocol.text)
  else if (ex && ex.kind !== 'mobility') bits.push(effortText(d.effort))
  if (d.restSec && d.sets > 1) bits.push('rest 1–2 min between sets')
  if (d.loadBy === 'specialist') bits.push('load as prescribed')
  return bits.join(' · ')
}

export function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
export const dayNumber = (iso: string) => Number(iso.slice(8, 10))
