import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import { Panel, Spinner, StatusPill } from '../components/ui'
import { impactOf, vitalFor } from '../data/contexts'
import { recordsForSystem } from '../data/kb'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, VITAL_BY_KEY, type VitalKey } from '../data/vitals'
import { baselineOf, seriesOf, timeAgo } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'

const BANDS: Partial<Record<VitalKey, [number, number]>> = {
  bp: [90, 130], hr: [50, 100], spo2: [95, 100], temp: [36.1, 37.5], glucose: [70, 99], sleep: [7, 9], mood: [4, 5], exercise: [90, 150], vision: [4, 5], water: [2.5, 4],
}

export default function Diagnostics({ crewId }: { crewId: number }) {
  const { user, mission } = useSession()
  const ctx = mission?.context ?? 'space'
  const data = useCrewData(crewId)
  const [sel, setSel] = useState<SystemId>('heart')
  const [editing, setEditing] = useState<VitalKey | null>(null)
  const ev = data.ev
  const sys = SYSTEM_BY_ID[sel]
  const vitals = ev ? sys.vitals.filter((k) => ev.vitalStatus[k]) : []
  const [metric, setMetric] = useState<VitalKey | null>(null)
  const active = metric && vitals.includes(metric) ? metric : vitals[0] ?? null
  const research = useMemo(() => (ctx === 'space' ? recordsForSystem(sel).filter((r) => r.findings.length)[0] : undefined), [sel, ctx])
  const impact = impactOf(sel, ctx)

  if (!ev) return data.error ? <p className="text-crit">{data.error}</p> : <Spinner />
  const summaries = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.vitals.filter((k) => ev.vitalStatus[k]).map((k) => `${ev.defByKey[k]!.display(ev.values)} ${ev.defByKey[k]!.unit}`).join(' · ') || (s.id === 'radiation' ? `${ev.rad.dose.toFixed(0)} mSv` : 'No reading yet')]),
  ) as Record<SystemId, string>

  const def = active ? (ev.defByKey[active] ?? VITAL_BY_KEY[active]) : null
  const trend = def ? seriesOf(data.rows, def.primary, 30, mission?.day ?? 142) : []
  const base = def ? baselineOf(data.rows, def.primary) : null
  const band = active ? BANDS[active] : undefined

  return (
    <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_440px]">
      <Panel title="Body systems" className="h-fit">
        <div className="flex flex-row flex-wrap gap-1.5 xl:flex-col">
          {ev.systems.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sel === s.id}
              onClick={() => setSel(s.id)}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-left text-sm transition ${sel === s.id ? 'bg-panel2 text-ink ring-1 ring-cyan/50' : 'text-soft hover:bg-panel2/60'}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[ev.systemStatus[s.id]] }} />
              {s.name}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="relative h-[620px] overflow-hidden p-2 xl:h-[720px]">
        <BodyViewer statuses={ev.systemStatus} summaries={summaries} selected={sel} onSelect={setSel} heartRate={ev.values.hr} showRadiation={ev.showRad} />
      </Panel>

      <AnimatePresence mode="wait">
        <motion.div
          key={sel}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-5"
        >
          <Panel>
            <p className="label">{ctx === 'space' ? `Hazard · ${sys.hazard}` : impact.heading}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h1 className="font-display text-2xl font-bold">{sys.name}</h1>
              <StatusPill status={ev.systemStatus[sel]} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-soft">{impact.text}</p>

            {vitals.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {vitals.map((k) => {
                  const d = ev.defByKey[k]!
                  const m = ev.meta[d.primary]
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setMetric(k)}
                      className={`rounded-2xl border p-3 text-left transition ${active === k ? 'border-cyan/60 bg-panel2' : 'border-line bg-deep/60 hover:border-cyan/40'}`}
                    >
                      <div className="text-xs text-dim">{d.label}</div>
                      <div className="font-display text-2xl font-bold" style={{ color: STATUS_COLOR[ev.vitalStatus[k]!] }}>
                        {d.display(ev.values)} <span className="text-xs font-normal text-dim">{d.unit}</span>
                      </div>
                      <div className="text-[11px] text-dim">
                        {m?.device} · {timeAgo(m?.at)}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {sel === 'radiation' && (
              <div className="mt-4">
                <div className="font-display text-4xl font-bold" style={{ color: STATUS_COLOR[ev.rad.status] }}>
                  {ev.rad.dose.toFixed(0)} <span className="text-base text-dim">mSv</span>
                </div>
                <p className="mt-1 text-sm text-dim">{ev.rad.mission.doseNote}</p>
              </div>
            )}
          </Panel>

          {def && trend.length > 1 && (
            <Panel title={`${def.label} · last 30 days`}>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="diagFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#53D7FF" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#53D7FF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E3A55" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: '#91A9BD', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(d) => `D${d}`} />
                    <YAxis tick={{ fill: '#91A9BD', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                    {band && <ReferenceArea y1={band[0]} y2={band[1]} fill="#35D399" fillOpacity={0.08} ifOverflow="hidden" />}
                    {base != null && <ReferenceLine y={base} stroke="#91A9BD" strokeDasharray="5 5" />}
                    <Tooltip contentStyle={{ background: '#07111F', border: '1px solid #1E3A55', borderRadius: 12 }} labelFormatter={(d) => `Mission day ${d}`} />
                    <Area type="monotone" dataKey="value" name={def.label} stroke="#53D7FF" strokeWidth={2.5} fill="url(#diagFill)" animationDuration={900} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-dim">
                <span>Green band: population reference</span>
                <span>Dashed: your pre-flight baseline</span>
              </div>
            </Panel>
          )}

          {!research && impact.source && ctx !== 'space' && (
            <Panel title="What the research says">
              <p className="text-sm leading-relaxed">{impact.text}</p>
              <a href={impact.source.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-cyan underline">
                {impact.source.org} — {impact.source.title}
              </a>
            </Panel>
          )}
          {research && (
            <Panel title="What NASA research says">
              <p className="text-sm leading-relaxed">{research.findings[0].text}</p>
              <blockquote className="mt-2 border-l-2 border-cyan/50 pl-3 text-xs italic text-dim">“{research.findings[0].quote}”</blockquote>
              <a href={research.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-cyan underline">
                {research.organization} — {research.title}
              </a>
            </Panel>
          )}

          <div className="flex gap-2.5">
            {user?.role === 'astronaut' && vitals.length > 0 && (
              <button type="button" onClick={() => setEditing(active)} className="flex-1 rounded-2xl bg-cyan py-3 font-semibold text-space transition hover:bg-ice">
                Log a measurement
              </button>
            )}
            {user?.role !== 'ground' && (
              <Link to={`/crew/${crewId}/aura`} className="flex-1 rounded-2xl border border-cyan/60 py-3 text-center font-semibold text-ice transition hover:bg-cyan/10">
                Examine with AURA
              </Link>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {editing && (
        <EditVitalModal
          def={vitalFor(editing, ctx)}
          values={ev.values}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            setEditing(null)
            await data.add(patch, 'manual', 'Manual entry')
          }}
        />
      )}
    </div>
  )
}
