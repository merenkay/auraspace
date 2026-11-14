import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import EarlyWarningBlock from '../components/early/EarlyWarningBlock'
import ReportActions from '../components/reports/ReportActions'
import HealthScoreCard from '../components/score/HealthScoreCard'
import { BodySection, SaveStatus } from '../components/overview/BodySection'
import { alertAction, describeSave } from '../components/overview/readingLogic'
import SystemPanel from '../components/SystemPanel'
import VitalCard from '../components/VitalCard'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CONTEXT_ICON,
  Dialog,
  Disclosure,
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
  Saved,
  Section,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  VITAL_ICON,
  useFlash,
  cx,
  useMedia,
  useRememberedOpen,
} from '../components/ui'
import { CONTEXTS, vitalFor, vitalsFor, type Context } from '../data/contexts'
import { MISSIONS } from '../data/missions'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { type VitalKey } from '../data/vitals'
import { seriesOf, timeAgo, type Evaluation } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'
import { onUi } from '../lib/uiBus'
import { DATA_CHANGED, takePendingSystem } from '../lib/voice/pending'
import { actionFor } from '../lib/triage'
import { ChevronDown, Flame, Plus, Trash2 } from 'lucide-react'

const CARDS: VitalKey[] = ['bp', 'hr', 'temp', 'sleep', 'mood', 'exercise', 'water', 'spo2', 'glucose']

export default function Overview({ crewId }: { crewId: number }) {
  const { user, mission, crew } = useSession()
  const data = useCrewData(crewId)
  const [selected, setSelectedState] = useState<SystemId | null>(null)
  const [editing, setEditing] = useState<VitalKey | null>(null)
  // Phones: the 3D body is a folded section. The person's choice is remembered; selecting a system opens it
  // for this visit without overwriting that choice.
  const wide = useMedia('(min-width: 1024px)')
  const phone = !useMedia('(min-width: 768px)')
  const [bodyStored, setBodyStored] = useRememberedOpen('overview.body', false)
  const [bodyAuto, setBodyAuto] = useState(false)
  const bodyOpen = !phone || bodyStored || bodyAuto
  const setSelected = (s: SystemId | null) => {
    setSelectedState(s)
    if (s) setBodyAuto(true)
  }
  // After a save: the evaluation before it, compared with the current one.
  const [lastSave, setLastSave] = useState<{ key: VitalKey; before: Evaluation | null } | null>(null)

  // Voice: "show the heart" selects a system; a value logged by voice refreshes the data.
  const reloadData = data.reload
  useEffect(() => {
    const pick = (s: SystemId | null) => {
      setSelectedState(s)
      if (s) setBodyAuto(true)
    }
    const pending = takePendingSystem()
    if (pending !== undefined) pick(pending)
    const off = onUi('select-system', (d) => pick(d.system))
    const refresh = () => void reloadData()
    window.addEventListener(DATA_CHANGED, refresh)
    return () => {
      off()
      window.removeEventListener(DATA_CHANGED, refresh)
    }
  }, [reloadData])
  const [justSaved, flashSaved] = useFlash(2200)
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

  // Sparklines: recomputed only when the readings change, not on every render of the page.
  const day = mission?.day ?? 142
  const trends = useMemo(() => {
    if (!ev) return {} as Partial<Record<VitalKey, ReturnType<typeof seriesOf>>>
    return Object.fromEntries(CARDS.filter((k) => ev.vitalStatus[k]).map((k) => [k, seriesOf(data.rows, ev.defByKey[k]!.primary, 14, day)])) as Partial<Record<VitalKey, ReturnType<typeof seriesOf>>>
  }, [ev, data.rows, day])

  const saveOutcome = useMemo(() => (lastSave && ev && ev !== lastSave.before ? describeSave(lastSave.key, lastSave.before, ev) : null), [lastSave, ev])
  const loggable = useMemo(() => vitalsFor(ctx).map((d) => d.key), [ctx])

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
        // Errors propagate: the dialog stays open and says the reading was not saved.
        const before = ev
        await data.add(patch, 'manual', 'Manual entry')
        setEditing(null)
        setLastSave({ key: editing, before })
        flashSaved()
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
  const shownAlerts = ev.alerts.slice(0, 3)

  // Blocks of the page. Wide screens keep the 3D body as the centrepiece (grid below); narrower screens stack them
  // in the order a person acts on: alerts → latest measurements → score → body (folded on phones) → today.
  const scoreBlock = (
    <div className="space-y-4">
      {/* Health-score card: src/components/score/HealthScoreCard.tsx */}
      <div data-demo="score">
        <HealthScoreCard ev={ev} excludeSystems={shownAlerts.map((a) => a.system)} onSelectSystem={setSelected} onLog={canEdit ? setEditing : undefined} />
      </div>

      {/* Send report + Ask AURA: src/components/reports/ReportActions.tsx */}
      {canEdit && <ReportActions crewId={crewId} ev={ev} ctx={ctx} name={member?.name ?? user?.name ?? ''} day={mission?.day ?? 1} delaySec={prof.delaySec} />}
    </div>
  )

  const viewer = (
    <Card pad="none" className="relative h-[460px] overflow-hidden sm:h-[540px] lg:h-[660px]">
      <BodyViewer statuses={ev.systemStatus} measured={ev.systemMeasured} summaries={summaries} selected={selected} onSelect={setSelected} heartRate={ev.values.hr} showRadiation={ev.showRad} />
    </Card>
  )

  const todayBlock = (
            <Section title="Today" action={<Badge icon={Flame}>{data.streak}-day streak</Badge>}>
              <div className="mb-3 flex items-center gap-3">
                <Meter className="flex-1" value={doneCount} min={0} max={Math.max(1, data.tasks.length)} label="Tasks done today" />
                <span className="meta shrink-0">
                  {doneCount} of {data.tasks.length} done
                </span>
              </div>
              <ul className="divide-y divide-line border-y border-line">
                {data.tasks.filter((t) => !t.done).map((t) => (
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
                {doneCount === data.tasks.length && data.tasks.length > 0 && <li className="px-2 py-3 text-sm text-soft">All of today's tasks are done.</li>}
              </ul>
              {doneCount > 0 && (
                <Disclosure size="row" id="overview.tasks-done" title={`Done today (${doneCount})`} className="mt-1">
                  <ul className="divide-y divide-line">
                    {data.tasks.filter((t) => t.done).map((t) => (
                      <li key={t.id} className="px-2">
                        <Checkbox
                          checked={t.done}
                          disabled={!canEdit}
                          onChange={() => void data.toggleTask(t.id)}
                          label={
                            <>
                              <span className="text-dim line-through">{t.label}</span>
                              <span className="meta ml-2">{t.time}</span>
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </Section>
  )

  const measurementsBlock = (
        <Section
          className={wide ? 'cv-auto' : undefined}
          title="Latest measurements"
          action={
            canEdit ? (
              <>
                <Saved show={justSaved} label="Reading saved" className="hidden sm:inline-flex" />
                {wide && <AddMenu ctx={ctx} onPick={setEditing} />}
              </>
            ) : undefined
          }
        >
          <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
            {cards.map((k) => {
              const d = ev.defByKey[k]!
              const m = ev.meta[d.primary]
              return (
                <StaggerItem key={k} className="h-full">
                  <div className="h-full" data-demo={`vital-${k}`}>
                  <VitalCard
                    label={d.label}
                    value={d.display(ev.values)}
                    unit={d.unit}
                    status={ev.vitalStatus[k]!}
                    source={m?.source ?? 'manual'}
                    device={m?.device ?? ''}
                    time={timeAgo(m?.at)}
                    trend={trends[k] ?? []}
                    onClick={canEdit ? () => setEditing(k) : undefined}
                  />
                  </div>
                </StaggerItem>
              )
            })}
          </Stagger>
          {user?.role === 'ground' && (
            <Notice className="mt-4">Mood and private check-ins are visible only to the astronaut and the flight surgeon.</Notice>
          )}
        </Section>
  )

  return (
    <>
      <PageHeader
        eyebrow={canEdit ? greeting() : 'Crew member'}
        title={member?.name ?? user?.name ?? ''}
        status={<StatusPill status={ev.overallShown} announce />}
        actions={canEdit ? <AddMenu ctx={ctx} onPick={setEditing} /> : undefined}
      />

      <SaveStatus outcome={saveOutcome} onDismiss={() => setLastSave(null)} />

      <div className="space-y-10">
        {shownAlerts.length > 0 && (
          // Alerts render immediately: never inside Stagger/Reveal, never folded.
          <div className="space-y-3" aria-label="Alerts">
            {shownAlerts.map((a) => {
              const act = canEdit ? alertAction(a, loggable) : null
              const buttons = (
                <span className={cx('flex gap-2', !wide && 'mt-3 flex-wrap')}>
                  {act && (
                    <Button size="sm" icon={Plus} onClick={() => setEditing(act.key)}>
                      {act.label}
                      <span className="sr-only"> for {a.title}</span>
                    </Button>
                  )}
                  <Button size="sm" variant={act ? 'quiet' : 'secondary'} onClick={() => setSelected(a.system)}>
                    Details<span className="sr-only"> for {a.title}</span>
                  </Button>
                </span>
              )
              // Wide screens: actions on the right as before; narrow: below the advice so the text keeps its width.
              return (
                <Notice key={a.key} tone={a.level} title={a.title} role={a.level === 'crit' ? 'alert' : undefined} action={wide ? buttons : undefined}>
                  {a.detail}
                  {!wide && buttons}
                </Notice>
              )
            })}
            {ev.alerts.length > shownAlerts.length && <p className="text-sm text-dim">and {ev.alerts.length - shownAlerts.length} more. Open a body system below to see them.</p>}
          </div>
        )}

        <EarlyWarningBlock rows={data.rows} crewId={crewId} />

        {wide ? (
          <>
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-5 col-start-8 row-start-1">{scoreBlock}</div>
              <div className="col-span-7 col-start-1 row-span-2 row-start-1" data-demo="body">
                {viewer}
              </div>
              <div className="col-span-5 col-start-8 row-start-2">{todayBlock}</div>
            </div>
            {measurementsBlock}
          </>
        ) : (
          <>
            {measurementsBlock}
            {scoreBlock}
            {phone ? (
              <BodySection
                open={bodyOpen}
                onToggle={(o) => {
                  setBodyStored(o)
                  if (!o) setBodyAuto(false)
                }}
                ev={ev}
                onSelect={setSelected}
              >
                {viewer}
              </BodySection>
            ) : (
              <div data-demo="body">{viewer}</div>
            )}
            {todayBlock}
          </>
        )}

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
                    className="press flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-ink transition-colors hover:bg-panel"
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
