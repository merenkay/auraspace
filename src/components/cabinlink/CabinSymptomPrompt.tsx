// Environment page side of the cabin-air link:
//   1. when stored readings cross the gas attention/alarm level (or the temperature band), ask
//      "Anyone with symptoms?" with a short sourced checklist that opens the consultation pre-filled
//   2. a small timeline of saved AURA assessments laid over the gas history (privacy rules in lib/cabinLink/overlay.ts)
import { Stethoscope } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Context } from '../../data/contexts'
import { cabinSource, SYMPTOM_CHECKLIST, WHY } from '../../data/cabinLink/sources'
import { factorOf } from '../../lib/cabinLink/context'
import { loadOverlaySource, overlayAssessments, overlayCrewIds, type OverlayItem } from '../../lib/cabinLink/overlay'
import { canWriteClinic, type SavedAssessment } from '../../lib/clinic'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO, rowRatio } from '../../lib/envStation'
import { useSession } from '../../lib/session'
import { clockTime } from '../env/parts'
import { Button, Checkbox, Disclosure, Notice, SourceLink } from '../ui'
import { factorLine } from './CabinAirNotice'
import { setCabinHandoff, useCabinContext } from './useCabinContext'

const WINDOW_MS = 6 * 3_600_000 // the browser keeps 6 h of stored rows (LOCAL_HISTORY_MAX)
const HEAT_CHECKLIST = ['headache', 'lightheaded', 'fatigue']

/** Gas history with assessment markers. Plain SVG so it stays light on phones. */
function Timeline({ rows, items, from, to, skewMs }: { rows: { at: string; ratio: number | null }[]; items: OverlayItem[]; from: number; to: number; skewMs: number }) {
  const W = 600
  const H = 90
  const pts = rows
    .map((r) => ({ x: Date.parse(r.at) + skewMs, y: r.ratio }))
    .filter((p): p is { x: number; y: number } => p.y != null && p.x >= from && p.x <= to)
  const top = Math.max(GAS_ALARM_RATIO * 1.5, ...pts.map((p) => p.y))
  const X = (t: number) => ((t - from) / (to - from)) * W
  const Y = (v: number) => H - 6 - (v / top) * (H - 18)
  // break the line where readings are missing for more than 2 minutes
  let d = ''
  pts.forEach((p, i) => {
    d += `${i === 0 || p.x - pts[i - 1].x > 120_000 ? 'M' : 'L'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`
  })
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`Gas sensor ratio over the last 6 hours with ${items.length} saved assessment(s) marked`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={Y(GAS_WARN_RATIO)} y2={Y(GAS_WARN_RATIO)} className="text-warn" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={Y(GAS_ALARM_RATIO)} y2={Y(GAS_ALARM_RATIO)} className="text-crit" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {d && <path d={d} fill="none" className="text-ink" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        {items.map((it) => (
          <line key={it.id} x1={X(it.at)} x2={X(it.at)} y1="2" y2={H} className={it.elevated.length ? 'text-crit' : 'text-dim'} stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-dim">
        <span>{clockTime(from, false)}</span>
        <span>
          Line: gas × baseline · dashed: {GAS_WARN_RATIO}× / {GAS_ALARM_RATIO}× · bars: saved assessments
        </span>
        <span>{clockTime(to, false)}</span>
      </figcaption>
    </figure>
  )
}

export default function CabinSymptomPrompt({ context }: { context: Context }) {
  const { user, crew } = useSession()
  const navigate = useNavigate()
  const data = useCabinContext(context, WINDOW_MS / 60_000)
  const cabin = data.cabin
  const self = !!user && user.crewId != null && canWriteClinic(user, user.crewId)
  const crewIds = useMemo(() => crew.map((c) => c.id), [crew])
  const allowed = overlayCrewIds(user, crewIds)
  const [ticked, setTicked] = useState<string[]>([])
  const [source, setSource] = useState<{ items: SavedAssessment[]; failed: number } | null>(null)
  const allowedKey = allowed.join(',')

  useEffect(() => {
    let live = true
    if (!allowedKey) return
    void loadOverlaySource(user, crewIds).then((s) => live && setSource(s))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedKey, user])

  const gas = factorOf(cabin, 'gas')
  const heat = factorOf(cabin, 'heat')
  const cold = factorOf(cabin, 'cold')
  const prompt = !!(gas || heat || cold)
  const list = gas ? SYMPTOM_CHECKLIST : heat ? SYMPTOM_CHECKLIST.filter((c) => HEAT_CHECKLIST.includes(c.finding)).map((c) => ({ ...c, cite: WHY.heat[0] })) : []
  const listSources = [...new Map(list.map((c) => [c.cite.s, cabinSource(c.cite.s)])).values()]

  const to = Date.now()
  // the chart spans from the first stored reading or assessment (at least 1 h, at most 6 h) so short histories stay readable
  const firstAt = Math.min(...data.rows.map((r) => Date.parse(r.at) + data.skewMs).filter(Number.isFinite), ...(source?.items ?? []).map((a) => Date.parse(a.createdAt)).filter(Number.isFinite), to)
  const from = Math.max(to - WINDOW_MS, Math.min(to - 3_600_000, firstAt - 5 * 60_000))
  const items = useMemo(
    () => (source ? overlayAssessments(source.items, data.rows, from, to, context, data.skewMs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, data.rows, context, data.skewMs],
  )
  const during = items.filter((i) => i.elevated.length > 0)
  const nameOf = (id: number) => crew.find((c) => c.id === id)?.name ?? `Crew ${id}`

  const open = () => {
    if (!user?.crewId) return
    setCabinHandoff(ticked)
    navigate(`/crew/${user.crewId}/aura`)
  }

  if (!(prompt && cabin) && allowed.length === 0) return null
  return (
    <div className="space-y-4">
      {prompt && cabin && (
        <div data-demo="cabin-prompt">
          <Notice tone={gas?.now && gas.level === 'alarm' ? 'crit' : 'warn'} title="Anyone with symptoms?">
            <ul className="space-y-0.5 text-ink">
              {cabin.factors
                .filter((f) => f.id === 'gas' || f.id === 'heat' || f.id === 'cold')
                .map((f) => (
                  <li key={f.id}>{factorLine(f)}.</li>
                ))}
            </ul>
            {self ? (
              <>
                <p className="mt-2">{list.length ? 'Tick what you feel. AURA opens a consultation with these already filled in.' : 'If you feel unwell, AURA can take you through a consultation that takes these readings into account.'}</p>
                {list.length > 0 && (
                  <div className="mt-1 grid gap-x-6 sm:grid-cols-2" role="group" aria-label="Symptoms">
                    {list.map((c) => (
                      <Checkbox
                        key={c.finding}
                        label={c.label}
                        checked={ticked.includes(c.finding)}
                        onChange={(e) => setTicked((t) => (e.target.checked ? [...t, c.finding] : t.filter((x) => x !== c.finding)))}
                      />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button variant="primary" icon={Stethoscope} onClick={open}>
                    {ticked.length ? `Open consultation (${ticked.length})` : 'Open consultation'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-2">Crew members can tick their symptoms here and open an AURA consultation. {user?.role === 'surgeon' ? 'Their saved assessments appear in the timeline below.' : ''}</p>
            )}
            {listSources.length > 0 && (
              <div className="mt-3 text-sm text-dim">
                <p>Symptom list from:</p>
                <ul className="mt-1 space-y-1">
                  {listSources.map((s) => (
                    <li key={s.url}>
                      <SourceLink href={s.url} org={s.org} title={s.title} />
                    </li>
                  ))}
                </ul>
                <p className="mt-2">The gas sensor reacts to combustible gas and smoke; it cannot measure carbon monoxide or CO₂.</p>
              </div>
            )}
          </Notice>
        </div>
      )}

      {allowed.length > 0 && (
        <Disclosure size="row" id="cabinlink.timeline" title="Symptoms logged while readings were elevated" meta={during.length ? `${during.length} of ${items.length}` : items.length ? `${items.length} saved` : undefined} className="border-t border-line">
          <div className="space-y-3 pb-2">
            <p className="text-sm text-dim">
              {self ? 'Your saved AURA assessments' : 'Saved assessments of the simulated crew'} from the last 6 hours, placed on the stored gas readings. A red bar means a reading was raised in the
              15 minutes before it was saved (AURA rule). {user?.role === 'surgeon' ? 'Registered members’ records are never shown here.' : 'Only you can see your assessments.'}
            </p>
            <Timeline rows={data.rows.map((r) => ({ at: r.at, ratio: rowRatio(r) }))} items={items} from={from} to={to} skewMs={data.skewMs} />
            {items.length === 0 ? (
              <p className="text-sm text-soft">{source == null ? 'Loading saved assessments…' : 'No saved assessments in the last 6 hours.'}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {items.map((it) => (
                  <li key={it.id} className="py-2">
                    <span className="font-medium text-ink">{clockTime(it.at, false)}</span>
                    {!self && <span className="text-soft"> · {nameOf(it.crewId)}</span>}
                    <span className="text-soft"> · {it.symptoms.length ? it.symptoms.join(', ') : 'no symptoms recorded'}</span>
                    <span className="text-dim"> · {it.conditionName}</span>
                    <span className={it.elevated.length ? 'text-crit' : 'text-dim'}> · {it.elevated.length ? `while raised: ${it.elevated.join(', ')}` : it.covered ? 'readings in range' : 'no readings at that time'}</span>
                  </li>
                ))}
              </ul>
            )}
            {source && source.failed > 0 && <p className="text-sm text-warn">Some records could not be loaded.</p>}
          </div>
        </Disclosure>
      )}
    </div>
  )
}
