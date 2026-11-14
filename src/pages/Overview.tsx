import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import SystemPanel from '../components/SystemPanel'
import VitalCard from '../components/VitalCard'
import { Panel, ScoreRing, Spinner, StatusPill } from '../components/ui'
import { MISSIONS, formatDelay } from '../data/missions'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, VITAL_BY_KEY, type VitalKey } from '../data/vitals'
import { seriesOf, summaryOf, timeAgo } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'
import { actionFor } from '../lib/triage'

const CARDS: VitalKey[] = ['bp', 'hr', 'temp', 'sleep', 'mood', 'exercise']

export default function Overview({ crewId }: { crewId: number }) {
  const { user, mission, crew, backend } = useSession()
  const data = useCrewData(crewId)
  const [selected, setSelected] = useState<SystemId | null>(null)
  const [editing, setEditing] = useState<VitalKey | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const member = crew.find((c) => c.id === crewId)
  const canEdit = user?.role === 'astronaut'
  const prof = MISSIONS.find((m) => m.id === mission?.profileId) ?? MISSIONS[3]
  const ev = data.ev

  const summaries = useMemo(() => {
    if (!ev) return {} as Record<SystemId, string>
    return Object.fromEntries(
      SYSTEMS.map((s) => [
        s.id,
        s.id === 'radiation'
          ? `${ev.rad.dose.toFixed(0)} mSv · ${ev.rad.pct.toFixed(0)}% of limit`
          : s.vitals.filter((k) => ev.vitalStatus[k]).map((k) => `${VITAL_BY_KEY[k].display(ev.values)} ${VITAL_BY_KEY[k].unit}`).join(' · ') || 'Private',
      ]),
    ) as Record<SystemId, string>
  }, [ev])

  if (data.loading && !ev) return <Spinner label="Loading crew data" />
  if (data.error) return <p className="text-crit">Could not load data: {data.error}</p>
  if (!ev) return <p className="text-dim">No measurements yet.</p>

  const doneCount = data.tasks.filter((t) => t.done).length
  const cards = CARDS.filter((k) => ev.vitalStatus[k])
  const reason = ev.alerts[0] ? `Driven by ${ev.alerts.slice(0, 2).map((a) => a.title.split(' ').slice(0, 2).join(' ').toLowerCase()).join(' and ')}.` : 'All systems within range.'

  const sendReport = async () => {
    if (!backend) return
    await backend.sendReport(crewId, summaryOf(ev))
    setSent(`Report queued for the flight surgeon. Earliest arrival in ~${formatDelay(prof.delaySec)}; a reply takes at least ${formatDelay(prof.delaySec * 2)}.`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">{user?.role === 'astronaut' ? 'Good morning' : 'Crew member'}</p>
          <h1 className="font-display text-3xl font-bold">{member?.name ?? 'Crew member'}</h1>
        </div>
        <StatusPill status={ev.overall} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* score */}
        <Panel title="Health score" className="flex flex-col">
          <div className="flex flex-col items-center gap-4 py-2">
            <ScoreRing score={ev.score} status={ev.overall} />
            <p className="text-center text-sm text-soft">{reason}</p>
          </div>
          <div className="mt-4 space-y-3">
            {SYSTEMS.filter((s) => ev.systemStatus[s.id] !== 'ok').slice(0, 4).map((s, i) => (
              <motion.button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.08 }}
                className="flex w-full items-center justify-between rounded-xl bg-panel2/60 px-3 py-2 text-left text-sm transition hover:bg-panel2"
              >
                <span>{s.name}</span>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[ev.systemStatus[s.id]] }} />
              </motion.button>
            ))}
          </div>
          <p className="mt-auto pt-5 text-[11px] leading-relaxed text-dim">100 minus 9 points per reading needing attention and 22 per urgent one. Rule-based, works offline; AURA explains it but never sets it.</p>
        </Panel>

        {/* body */}
        <Panel className="relative h-[560px] overflow-hidden p-2 lg:h-[640px]">
          <BodyViewer statuses={ev.systemStatus} summaries={summaries} selected={selected} onSelect={setSelected} heartRate={ev.values.hr} />
        </Panel>

        {/* right column */}
        <div className="flex flex-col gap-5">
          <Panel title="Alerts" action={<span className="text-xs text-dim">{ev.alerts.length || 'none'}</span>}>
            <div className="space-y-2.5">
              <AnimatePresence initial>
                {ev.alerts.slice(0, 3).map((a, i) => (
                  <motion.button
                    key={a.key}
                    type="button"
                    onClick={() => setSelected(a.system)}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                    className="block w-full rounded-2xl border-l-4 bg-deep/70 p-3 text-left transition hover:bg-deep"
                    style={{ borderColor: STATUS_COLOR[a.level] }}
                  >
                    <div className="text-sm font-semibold">{a.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-dim">{a.detail}</div>
                  </motion.button>
                ))}
              </AnimatePresence>
              {ev.alerts.length === 0 && <p className="text-sm text-ok">Nothing needs attention.</p>}
            </div>
          </Panel>

          <Panel
            title="Today"
            action={
              <span className="flex items-center gap-1.5 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-ice">
                🔥 {data.streak}-day streak
              </span>
            }
          >
            <div className="mb-2 h-1.5 rounded-full bg-line">
              <motion.div className="h-1.5 rounded-full bg-cyan" animate={{ width: `${(doneCount / Math.max(1, data.tasks.length)) * 100}%` }} />
            </div>
            <ul className="space-y-0.5">
              {data.tasks.map((t) => (
                <li key={t.id}>
                  <label className={`flex min-h-10 items-center gap-3 rounded-lg px-2 ${canEdit ? 'cursor-pointer hover:bg-panel2/60' : ''}`}>
                    <input type="checkbox" checked={t.done} disabled={!canEdit} onChange={() => void data.toggleTask(t.id)} className="h-4 w-4 accent-cyan" />
                    <span className={`flex-1 text-sm ${t.done ? 'text-dim line-through' : ''}`}>{t.label}</span>
                    <span className="text-xs text-dim">{t.time}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Panel>

          {canEdit && (
            <div className="grid gap-2.5">
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => void sendReport()}
                className="rounded-2xl bg-cyan py-3.5 font-semibold text-space shadow-[0_0_30px_rgba(83,215,255,0.25)] transition hover:bg-ice"
              >
                Send report to flight surgeon
              </motion.button>
              <AnimatePresence>
                {sent && (
                  <motion.p role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="rounded-xl border border-ok/50 bg-ok/10 p-3 text-xs text-ok">
                    {sent}
                  </motion.p>
                )}
              </AnimatePresence>
              <Link to={`/crew/${crewId}/aura`} className="rounded-2xl border border-cyan/60 py-3.5 text-center font-semibold text-ice transition hover:bg-cyan/10">
                Ask AURA
              </Link>
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="label mb-3">Latest measurements</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {cards.map((k, i) => {
            const d = VITAL_BY_KEY[k]
            const m = ev.meta[d.primary]
            return (
              <VitalCard
                key={k}
                index={i}
                label={d.label}
                value={d.display(ev.values)}
                unit={d.unit}
                status={ev.vitalStatus[k]!}
                source={m?.source ?? 'manual'}
                device={m?.device ?? ''}
                time={timeAgo(m?.at)}
                trend={seriesOf(data.rows, d.primary, 14, mission?.day ?? 142)}
                onClick={canEdit ? () => setEditing(k) : undefined}
              />
            )
          })}
        </div>
        {user?.role === 'ground' && <p className="mt-3 text-xs text-dim">Mood and private check-ins are visible only to the astronaut and the flight surgeon.</p>}
      </div>

      {selected && (
        <SystemPanel
          system={SYSTEM_BY_ID[selected]}
          status={ev.systemStatus[selected]}
          values={ev.values}
          action={actionFor(ev.systemStatus[selected], prof.delaySec)}
          onEdit={(k) => canEdit && setEditing(k)}
          onClose={() => setSelected(null)}
        />
      )}
      {editing && (
        <EditVitalModal
          def={VITAL_BY_KEY[editing]}
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
