import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import SystemPanel from '../components/SystemPanel'
import VitalCard from '../components/VitalCard'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CONTEXT_ICON,
  Dialog,
  DUR,
  EASE,
  EmptyState,
  Field,
  List,
  Meter,
  Notice,
  PageHeader,
  PasswordInput,
  Row,
  ScoreRing,
  Section,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  StatusText,
  SYSTEM_ICON,
  VITAL_ICON,
} from '../components/ui'
import { CONTEXTS, vitalFor, vitalsFor, type Context } from '../data/contexts'
import { MISSIONS, formatDelay } from '../data/missions'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { type VitalKey } from '../data/vitals'
import type { Evaluation } from '../lib/health'
import { seriesOf, summaryOf, timeAgo } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'
import { onUi } from '../lib/uiBus'
import { DATA_CHANGED, takePendingSystem } from '../lib/voice/pending'
import { actionFor } from '../lib/triage'
import { Check, ChevronDown, Copy, Flame, FileText, Mail, MessageCircle, Plus, Printer, Trash2 } from 'lucide-react'

const CARDS: VitalKey[] = ['bp', 'hr', 'temp', 'sleep', 'mood', 'exercise', 'water', 'spo2', 'glucose']

export default function Overview({ crewId }: { crewId: number }) {
  const { user, mission, crew, backend } = useSession()
  const data = useCrewData(crewId)
  const [selected, setSelected] = useState<SystemId | null>(null)
  const [editing, setEditing] = useState<VitalKey | null>(null)

  // Voice: "show the heart" selects a system; a value logged by voice refreshes the data.
  const reloadData = data.reload
  useEffect(() => {
    const pending = takePendingSystem()
    if (pending !== undefined) setSelected(pending)
    const off = onUi('select-system', (d) => setSelected(d.system))
    const refresh = () => void reloadData()
    window.addEventListener(DATA_CHANGED, refresh)
    return () => {
      off()
      window.removeEventListener(DATA_CHANGED, refresh)
    }
  }, [reloadData])
  const [sent, setSent] = useState<string | null>(null)
  const [sendError, setSendError] = useState(false)
  const [sending, setSending] = useState(false)
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

  if (data.loading && !data.rows.length) return <OverviewSkeleton />
  if (data.error)
    return (
      <Notice tone="crit" title="Could not load data" role="alert">
        {data.error}
      </Notice>
    )

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

  if (!ev || !ev.hasData) {
    return (
      <>
        <Welcome name={user?.name ?? ''} ctx={ctx} onLog={canEdit ? setEditing : undefined} />
        {user?.role === 'member' && (
          <div className="mt-10">
            <DeleteAccount />
          </div>
        )}
        {editModal}
      </>
    )
  }

  const doneCount = data.tasks.filter((t) => t.done).length
  const cards = CARDS.filter((k) => ev.vitalStatus[k]).slice(0, 6)
  const reason = ev.alerts[0] ? `Driven by ${ev.alerts.slice(0, 2).map((a) => a.title.split(' ').slice(0, 2).join(' ').toLowerCase()).join(' and ')}.` : 'Everything is within range.'
  const shownAlerts = ev.alerts.slice(0, 3)
  const shownSystems = new Set(shownAlerts.map((a) => a.system))
  // Systems that need a look but are not already covered by one of the alerts above.
  const otherSystems = ev.systems.filter((s) => ev.systemMeasured[s.id] && ev.systemStatus[s.id] !== 'ok' && !shownSystems.has(s.id)).slice(0, 4)

  const sendReport = async () => {
    if (!backend) return
    setSending(true)
    setSendError(false)
    try {
      await backend.sendReport(crewId, summaryOf(ev))
      if (ctx === 'space') {
        setSent(`Report queued for the flight surgeon. Earliest arrival in ~${formatDelay(prof.delaySec)}; a reply takes at least ${formatDelay(prof.delaySec * 2)}.`)
      } else {
        setPrintable(true)
      }
    } catch {
      setSendError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow={canEdit ? greeting() : 'Crew member'} title={member?.name ?? user?.name ?? ''} status={<StatusPill status={ev.overall} announce />} />

      <div className="space-y-10">
        {shownAlerts.length > 0 && (
          // Alerts render immediately: never inside Stagger/Reveal.
          <div className="space-y-3" aria-label="Alerts">
            {shownAlerts.map((a) => (
              <Notice
                key={a.key}
                tone={a.level}
                title={a.title}
                role={a.level === 'crit' ? 'alert' : undefined}
                action={
                  <Button size="sm" onClick={() => setSelected(a.system)}>
                    Details<span className="sr-only"> for {a.title}</span>
                  </Button>
                }
              >
                {a.detail}
              </Notice>
            ))}
            {ev.alerts.length > shownAlerts.length && <p className="text-sm text-dim">and {ev.alerts.length - shownAlerts.length} more. Open a body system below to see them.</p>}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-4 lg:col-span-5 lg:col-start-8 lg:row-start-1">
            <Card>
              <div className="flex items-center gap-5">
                <div className="shrink-0">
                  <ScoreRing score={ev.score} status={ev.overall} size={120} />
                </div>
                <div className="min-w-0">
                  <p className="label">Health score</p>
                  <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{reason}</p>
                </div>
              </div>
              {otherSystems.length > 0 && (
                <div className="mt-5">
                  <p className="label mb-1">Also worth a look</p>
                  <List>
                    {otherSystems.map((s) => {
                      const Icon = SYSTEM_ICON[s.id]
                      return <Row key={s.id} title={s.name} leading={<Icon className="h-5 w-5" aria-hidden="true" />} trailing={<StatusText status={ev.systemStatus[s.id]} />} onClick={() => setSelected(s.id)} />
                    })}
                  </List>
                </div>
              )}
              <p className="mt-5 border-t border-line pt-4 text-sm text-dim">100 minus 9 points per reading needing attention and 22 per urgent one. Rule-based, works offline; AURA explains it but never sets it.</p>
            </Card>

            {canEdit && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <Button variant="primary" size="lg" icon={FileText} loading={sending} onClick={() => void sendReport()} full>
                    {CONTEXTS[ctx].reportButton}
                  </Button>
                  <Button size="lg" icon={MessageCircle} to={`/crew/${crewId}/aura`} full>
                    Ask AURA
                  </Button>
                </div>
                {sent && (
                  <Notice tone="ok" role="status">
                    {sent}
                  </Notice>
                )}
                {sendError && (
                  <Notice tone="warn" role="alert" title="The report was not sent">
                    Check your connection and try again.
                  </Notice>
                )}
              </div>
            )}
          </div>

          <Card pad="none" className="relative h-[460px] overflow-hidden sm:h-[540px] lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[660px]">
            <BodyViewer statuses={ev.systemStatus} measured={ev.systemMeasured} summaries={summaries} selected={selected} onSelect={setSelected} heartRate={ev.values.hr} showRadiation={ev.showRad} />
          </Card>

          <div className="lg:col-span-5 lg:col-start-8 lg:row-start-2">
            <Section title="Today" action={<Badge icon={Flame}>{data.streak}-day streak</Badge>}>
              <div className="mb-3 flex items-center gap-3">
                <Meter className="flex-1" value={doneCount} min={0} max={Math.max(1, data.tasks.length)} label="Tasks done today" />
                <span className="meta shrink-0">
                  {doneCount} of {data.tasks.length} done
                </span>
              </div>
              <ul className="divide-y divide-line border-y border-line">
                {data.tasks.map((t) => (
                  <li key={t.id} className="px-2">
                    <Checkbox
                      checked={t.done}
                      disabled={!canEdit}
                      onChange={() => void data.toggleTask(t.id)}
                      label={
                        <>
                          <span className={t.done ? 'text-dim line-through' : 'text-ink'}>{t.label}</span>
                          <span className="meta ml-2">{t.time}</span>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>

        <Section title="Latest measurements" action={canEdit ? <AddMenu ctx={ctx} onPick={setEditing} /> : undefined}>
          <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
            {cards.map((k) => {
              const d = ev.defByKey[k]!
              const m = ev.meta[d.primary]
              return (
                <StaggerItem key={k}>
                  <VitalCard
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
                </StaggerItem>
              )
            })}
          </Stagger>
          {user?.role === 'ground' && (
            <Notice className="mt-4">Mood and private check-ins are visible only to the astronaut and the flight surgeon.</Notice>
          )}
        </Section>

        {user?.role === 'member' && <DeleteAccount />}
      </div>

      {selected && (
        <SystemPanel
          open={!editing}
          system={SYSTEM_BY_ID[selected]}
          status={ev.systemMeasured[selected] ? ev.systemStatus[selected] : null}
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
    </>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading health data">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        <Skeleton className="h-64 rounded-2xl lg:col-span-5 lg:col-start-8" />
        <Skeleton className="h-[460px] rounded-2xl lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[660px]" />
        <Skeleton className="h-48 rounded-2xl lg:col-span-5 lg:col-start-8 lg:row-start-2" />
      </div>
      <span className="sr-only">Loading health data…</span>
    </div>
  )
}

/** "Log a measurement": a small menu of the measurements this profile tracks. */
function AddMenu({ ctx, onPick }: { ctx: Context; onPick: (k: VitalKey) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative" ref={root}>
      <Button icon={Plus} iconRight={ChevronDown} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={menuId}>
        Log a measurement
      </Button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={menuId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE.in } }}
            className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-line bg-panel2 p-1.5 shadow-overlay"
          >
            {vitalsFor(ctx).map((d) => {
              const Icon = VITAL_ICON[d.key]
              return (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onPick(d.key)
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-ink transition-colors hover:bg-panel"
                  >
                    <Icon className="h-4 w-4 text-dim" aria-hidden="true" />
                    {d.label}
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/** First run: nothing logged yet. One clear next step per measurement. */
function Welcome({ name, ctx, onLog }: { name: string; ctx: Context; onLog?: (k: VitalKey) => void }) {
  const c = CONTEXTS[ctx]
  const CtxIcon = CONTEXT_ICON[ctx]
  const first: VitalKey[] = ctx === 'home' ? ['bp', 'hr', 'sleep', 'mood', 'water', 'exercise'] : ['bp', 'hr', 'spo2', 'sleep', 'mood', 'exercise']
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CtxIcon className="h-4 w-4" aria-hidden="true" />
            {c.label}
          </span>
        }
        title={`Welcome, ${name.split(' ')[0]}`}
        description={`Your ${c.label.toLowerCase()} profile is ready. Log a few first readings and AURA will build your personal baseline, colour your body map and tell you when to involve your ${c.contact}.`}
      />
      {onLog ? (
        <Section title="Start with a reading" description="Pick any measurement. You can add the others later.">
          <List className="max-w-2xl">
            {first.map((k) => {
              const d = vitalFor(k, ctx)
              const Icon = VITAL_ICON[k]
              return (
                <Row
                  key={k}
                  title={d.label}
                  description={d.unit}
                  leading={<Icon className="h-5 w-5" aria-hidden="true" />}
                  trailing={
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add first reading
                    </span>
                  }
                  onClick={() => onLog(k)}
                />
              )
            })}
          </List>
        </Section>
      ) : (
        <EmptyState title="No measurements yet" description="Nothing has been logged for this person." />
      )}
    </>
  )
}

function PrintableReport({ ev, name, ctx, day, onClose }: { ev: Evaluation; name: string; ctx: Context; day: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
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
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Report for your ${CONTEXTS[ctx].contact}`}
      description="Copy it, email it or print it. AURA does not send this anywhere by itself."
      footer={
        <>
          <Button
            icon={copied ? Check : Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(text)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button icon={Mail} onClick={() => window.location.assign(`mailto:?subject=${encodeURIComponent('My AURA health summary')}&body=${encodeURIComponent(text)}`)}>
            Email it
          </Button>
          <Button icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" onClick={onClose} data-autofocus>
            Done
          </Button>
        </>
      }
    >
      <pre data-print-report className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-deep p-4 font-mono text-[13px] leading-relaxed text-soft">{text}</pre>
    </Dialog>
  )
}

function DeleteAccount() {
  const { backend } = useSession()
  const nav = useNavigate()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const close = () => {
    setOpen(false)
    setPw('')
    setErr(null)
  }
  return (
    <div className="border-t border-line pt-6">
      <Button variant="quiet" icon={Trash2} onClick={() => setOpen(true)}>
        Delete my account and data
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Delete your account?"
        description="This permanently deletes your account and all readings."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" form={formId} variant="danger" loading={busy}>
              Delete
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await backend?.deleteAccount(pw)
              window.location.assign('/login')
              nav('/login', { replace: true })
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Could not delete')
              setBusy(false)
            }
          }}
        >
          <Field label="Your password" error={err}>
            <PasswordInput autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}
