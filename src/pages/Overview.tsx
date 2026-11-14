import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import SystemPanel from '../components/SystemPanel'
import VitalCard from '../components/VitalCard'
import { Panel, ScoreRing, Spinner, StatusPill } from '../components/ui'
import { CONTEXTS, vitalFor, vitalsFor, type Context } from '../data/contexts'
import { MISSIONS, formatDelay } from '../data/missions'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, type VitalKey } from '../data/vitals'
import type { Evaluation } from '../lib/health'
import { seriesOf, summaryOf, timeAgo } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'
import { actionFor } from '../lib/triage'

const CARDS: VitalKey[] = ['bp', 'hr', 'temp', 'sleep', 'mood', 'exercise', 'water', 'spo2', 'glucose']

export default function Overview({ crewId }: { crewId: number }) {
  const { user, mission, crew, backend } = useSession()
  const data = useCrewData(crewId)
  const [selected, setSelected] = useState<SystemId | null>(null)
  const [editing, setEditing] = useState<VitalKey | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [printable, setPrintable] = useState(false)
  const member = crew.find((c) => c.id === crewId)
  const canEdit = user?.role === 'astronaut' || user?.role === 'member'
  const ctx: Context = mission?.context ?? 'space'
  const prof = MISSIONS.find((m) => m.id === mission?.profileId) ?? MISSIONS[3]
  const ev = data.ev

  const summaries = useMemo(() => {
    if (!ev) return {} as Record<SystemId, string>
    return Object.fromEntries(
      SYSTEMS.map((s) => [
        s.id,
        s.id === 'radiation'
          ? `${ev.rad.dose.toFixed(0)} mSv · ${ev.rad.pct.toFixed(0)}% of limit`
          : s.vitals
              .filter((k) => ev.vitalStatus[k])
              .map((k) => `${ev.defByKey[k]!.display(ev.values)} ${ev.defByKey[k]!.unit}`)
              .join(' · ') || 'No reading yet',
      ]),
    ) as Record<SystemId, string>
  }, [ev])

  if (data.loading && !data.rows.length) return <Spinner label="Loading health data" />
  if (data.error) return <p className="text-crit">Could not load data: {data.error}</p>

  const editModal = editing && (
    <EditVitalModal
      def={vitalFor(editing, ctx)}
      values={ev?.values ?? { sys: 120, dia: 78, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7, mood: 4, exercise: 30, vision: 5, water: 2 }}
      onClose={() => setEditing(null)}
      onSave={async (patch) => {
        setEditing(null)
        await data.add(patch, 'manual', 'Manual entry')
      }}
    />
  )

  if (!ev || ev.vitals.length === 0) {
    return (
      <>
        <Welcome name={user?.name ?? ''} ctx={ctx} onLog={canEdit ? setEditing : undefined} />
        {editModal}
      </>
    )
  }

  const doneCount = data.tasks.filter((t) => t.done).length
  const cards = CARDS.filter((k) => ev.vitalStatus[k]).slice(0, 6)
  const reason = ev.alerts[0] ? `Driven by ${ev.alerts.slice(0, 2).map((a) => a.title.split(' ').slice(0, 2).join(' ').toLowerCase()).join(' and ')}.` : 'Everything is within range.'

  const sendReport = async () => {
    if (!backend) return
    await backend.sendReport(crewId, summaryOf(ev))
    if (ctx === 'space') {
      setSent(`Report queued for the flight surgeon. Earliest arrival in ~${formatDelay(prof.delaySec)}; a reply takes at least ${formatDelay(prof.delaySec * 2)}.`)
    } else {
      setPrintable(true)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">{canEdit ? greeting() : 'Crew member'}</p>
          <h1 className="font-display text-3xl font-bold">{member?.name ?? user?.name}</h1>
        </div>
        <StatusPill status={ev.overall} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <Panel title="Health score" className="flex flex-col">
          <div className="flex flex-col items-center gap-4 py-2">
            <ScoreRing score={ev.score} status={ev.overall} />
            <p className="text-center text-sm text-soft">{reason}</p>
          </div>
          <div className="mt-4 space-y-2">
            {ev.systems
              .filter((s) => ev.systemStatus[s.id] !== 'ok')
              .slice(0, 4)
              .map((s, i) => (
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

        <Panel className="relative h-[560px] overflow-hidden p-2 lg:h-[640px]">
          <BodyViewer statuses={ev.systemStatus} summaries={summaries} selected={selected} onSelect={setSelected} heartRate={ev.values.hr} showRadiation={ev.showRad} />
        </Panel>

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
            action={<span className="flex items-center gap-1.5 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-ice">🔥 {data.streak}-day streak</span>}
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
                {CONTEXTS[ctx].reportButton}
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label">Latest measurements</h2>
          {canEdit && (
            <AddMenu ctx={ctx} onPick={setEditing} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {cards.map((k, i) => {
            const d = ev.defByKey[k]!
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

      {user?.role === 'member' && <DeleteAccount />}

      {selected && (
        <SystemPanel
          system={SYSTEM_BY_ID[selected]}
          status={ev.systemStatus[selected]}
          values={ev.values}
          available={ev.vitals.map((d) => d.key)}
          context={ctx}
          canEdit={canEdit}
          action={actionFor(ev.systemStatus[selected], prof.delaySec, ctx)}
          onEdit={(k) => canEdit && setEditing(k)}
          onClose={() => setSelected(null)}
        />
      )}
      {editModal}
      {printable && <PrintableReport ev={ev} name={member?.name ?? user?.name ?? ''} ctx={ctx} day={mission?.day ?? 1} onClose={() => setPrintable(false)} />}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function AddMenu({ ctx, onPick }: { ctx: Context; onPick: (k: VitalKey) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-full border border-cyan/60 px-4 py-1.5 text-sm font-semibold text-ice transition hover:bg-cyan/10">
        + Log a measurement
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl"
          >
            {vitalsFor(ctx).map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPick(d.key)
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-panel2"
              >
                {d.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Welcome({ name, ctx, onLog }: { name: string; ctx: Context; onLog?: (k: VitalKey) => void }) {
  const c = CONTEXTS[ctx]
  const first: VitalKey[] = ctx === 'home' ? ['bp', 'hr', 'sleep', 'mood', 'water', 'exercise'] : ['bp', 'hr', 'spo2', 'sleep', 'mood', 'exercise']
  return (
    <div className="mx-auto max-w-3xl py-6 text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 14 }} className="text-6xl" aria-hidden="true">
        {c.icon}
      </motion.div>
      <h1 className="mt-4 font-display text-3xl font-bold">Welcome, {name.split(' ')[0]}</h1>
      <p className="mx-auto mt-2 max-w-xl text-soft">
        Your {c.label.toLowerCase()} profile is ready. Log a few first readings and AURA will build your personal baseline, colour your body map and tell you when to involve your {c.contact}.
      </p>
      {onLog && (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {first.map((k, i) => {
            const d = vitalFor(k, ctx)
            return (
              <motion.button
                key={k}
                type="button"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
                whileHover={{ y: -4 }}
                onClick={() => onLog(k)}
                className="glass rounded-3xl p-5 text-left"
              >
                <div className="font-semibold">{d.label}</div>
                <div className="mt-1 text-xs text-dim">{d.unit}</div>
                <div className="mt-4 text-sm font-semibold text-cyan">+ Add first reading</div>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PrintableReport({ ev, name, ctx, day, onClose }: { ev: Evaluation; name: string; ctx: Context; day: number; onClose: () => void }) {
  const s = summaryOf(ev)
  const text = [
    `AURA health summary — ${name}`,
    `${new Date().toLocaleString()} · day ${day} of tracking · ${CONTEXTS[ctx].label}`,
    `Overall: ${s.overall.toUpperCase()} · score ${s.score}/100`,
    '',
    'Readings:',
    ...s.vitals.map((v) => `- ${v.label}: ${v.value} (${v.status})`),
    '',
    s.alerts.length ? 'Needs attention:' : 'No alerts.',
    ...s.alerts.map((a) => `- ${a.title}`),
    '',
    'Self-reported and device readings; AURA does not diagnose.',
  ].join('\n')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-3xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl font-bold">Report for your {CONTEXTS[ctx].contact}</h2>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-deep p-4 text-sm text-soft">{text}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="rounded-xl border border-cyan/60 px-4 py-2.5 text-sm font-semibold text-ice">
            Copy text
          </button>
          <a href={`mailto:?subject=${encodeURIComponent('My AURA health summary')}&body=${encodeURIComponent(text)}`} className="rounded-xl border border-cyan/60 px-4 py-2.5 text-sm font-semibold text-ice">
            Email it
          </a>
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-cyan/60 px-4 py-2.5 text-sm font-semibold text-ice">
            Print
          </button>
          <button type="button" onClick={onClose} className="ml-auto rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-space">
            Done
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function DeleteAccount() {
  const { backend } = useSession()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="pt-4 text-center">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-dim underline hover:text-crit">
          Delete my account and data
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await backend?.deleteAccount(pw)
              window.location.assign('/login')
              nav('/login', { replace: true })
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Could not delete')
            }
          }}
          className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2"
        >
          <span className="text-sm text-soft">This permanently deletes your account and all readings.</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" className="rounded-xl border border-line bg-space/70 px-3 py-2 text-sm outline-none focus:border-crit" />
          <button type="submit" className="rounded-xl bg-crit px-4 py-2 text-sm font-semibold text-space">
            Delete
          </button>
          {err && <span className="w-full text-xs text-crit">{err}</span>}
        </form>
      )}
    </div>
  )
}
