// "Explain a reading": a heart rate or body temperature measured while the room is hot gets the same environment
// note as in the consultation (a note only — the reading's status comes from the fixed rules in src/lib/health.ts).
import { Thermometer } from 'lucide-react'
import { cabinSource } from '../../data/cabinLink/sources'
import type { VitalKey } from '../../data/vitals'
import { currentCabin } from '../../lib/cabinLink/current'
import { environmentState, vitalNotes } from '../../lib/cabinLink/envDx'
import type { Evaluation } from '../../lib/health'
import { SourceLink } from '../ui'

const PLACE = { space: 'Cabin', polar: 'Station', home: 'Room' } as const

export default function ReadingEnvNote({ vital, ev }: { vital: VitalKey; ev: Evaluation }) {
  if (vital !== 'hr' && vital !== 'temp') return null
  const m = ev.meta[vital]
  if (!m) return null
  const e = environmentState(currentCabin(ev.context))
  const reading = e.t != null ? `${Math.round(e.t * 10) / 10} °C${e.h != null ? ` and ${Math.round(e.h)} % humidity` : ''}` : null
  const notes = vitalNotes({ answers: {}, context: ev.context, readings: { [vital]: { value: ev.values[vital], at: m.at } } }, e, PLACE[ev.context], reading)
  const n = notes[0]
  if (!n) return null
  const s = n.cite ? cabinSource(n.cite.s) : null
  return (
    <p data-testid="reading-env-note" className="flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm text-soft">
      <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <span>
        {n.text} {s && <SourceLink href={s.url} org={s.org} />}
      </span>
    </p>
  )
}
