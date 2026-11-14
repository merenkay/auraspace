import { Activity, ArrowRight, Check, Dumbbell, Moon, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { HowBuilt } from '../components/coach/HowBuilt'
import { LogDialog } from '../components/coach/LogDialog'
import { ProfileEditor } from '../components/coach/ProfileEditor'
import { RuleCite, SessionView } from '../components/coach/SessionView'
import { WeekPlan } from '../components/coach/WeekPlan'
import { shortDate } from '../components/coach/format'
import { Badge, Button, Card, chart, ChartTooltip, Disclosure, EmptyState, List, Meter, Metric, Notice, PageHeader, Row, Section, Skeleton, SourceLink, Stagger, StaggerItem } from '../components/ui'
import { EQUIPMENT_BY_ID, FOCUS_BY_ID, LEVELS, LIMIT_LABEL, WEEKDAY } from '../data/coach/catalog'
import { EXERCISE_BY_ID } from '../data/coach/exercises'
import type { HealthProfile } from '../data/conditions/profile'
import { CONTEXTS, vitalFor } from '../data/contexts'
import { STATUS_COLOR } from '../data/vitals'
import { latestAssessment, loadProfile, type SavedAssessment } from '../lib/clinic'
import { buildCoach, canWriteCoach, isoDate, loadCoach, logSession, saveTrainingProfile } from '../lib/coach'
import { mondayOf } from '../lib/coach/profile'
import type { CoachState } from '../lib/coach/store'
import type { TrainingProfile } from '../lib/coach/types'
import type { Adaptation } from '../lib/coachPlan'
import { seriesOf } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'

const EQUIPMENT = [
  { id: 'ARED', name: 'Advanced Resistive Exercise Device', spec: 'Up to 600 lb resistance' },
  { id: 'T2', name: 'Treadmill 2 (COLBERT)', spec: 'Up to 12.7 mph · harness load up to 70% body mass' },
  { id: 'CEVIS', name: 'Cycle ergometer', spec: 'Peak 200 W · up to 100 RPM' },
]
const TONE = { stop: 'crit', caution: 'warn', adjust: 'info' } as const
const DECISION_TITLE = { start: 'Getting started', progress: 'Stepped up', hold: 'Same as last time', regress: 'One step easier' } as const

function AdaptationNotice({ a }: { a: Adaptation }) {
  return (
    <Notice tone={TONE[a.level]} role={a.level === 'stop' ? 'alert' : undefined} title={a.title}>
      <p className="text-ink">{a.text}</p>
      <p className="mt-1">Why: {a.reason}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {a.source && <SourceLink href={a.source.url} org={a.source.org} title={a.source.title} />}
        {a.rule && <Badge>AURA safety rule</Badge>}
      </div>
    </Notice>
  )
}

export default function Coach({ crewId }: { crewId: number }) {
  const { mission, user, crew } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const ctx = ev?.context ?? mission?.context ?? user?.context ?? 'space'
  const space = ctx === 'space'
  const day = mission?.day ?? 142
  const contact = CONTEXTS[ctx].contact
  const today = useMemo(() => isoDate(), [])
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [latest, setLatest] = useState<SavedAssessment | null>(null)
  const [coach, setCoach] = useState<CoachState | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([
      loadProfile(user, crewId).catch(() => null),
      latestAssessment(user, crewId),
      loadCoach(user, crewId, ctx).catch((e: unknown) => {
        if (alive) setLoadErr(e instanceof Error ? e.message : 'Could not load your saved programme')
        return { profile: null, logs: [] } as CoachState
      }),
    ]).then(([p, l, c]) => {
      if (!alive) return
      setProfile(p)
      setLatest(l)
      setCoach(c)
    })
    return () => {
      alive = false
    }
    // ctx only seeds a missing profile; it is applied again when the programme is built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, crewId])

  const sleep = seriesOf(data.rows, 'sleep', 7, day)
  const sleepAvg = sleep.length ? sleep.reduce((s, p) => s + p.value, 0) / sleep.length : null
  const result = useMemo(
    () => (coach ? buildCoach({ context: ctx, ev, rows: data.rows, profile, latest, sleepAvg, day, today, training: coach.profile, logs: coach.logs }) : null),
    [coach, ctx, ev, data.rows, profile, latest, sleepAvg, day, today],
  )

  if ((data.loading && !data.rows.length && !ev) || !coach || !result) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const { programme: p, safety, training, suggestions } = result
  const canEdit = canWriteCoach(user, crewId)
  const name = crew.find((c) => c.id === crewId)?.name ?? 'this crew member'
  const allSessions = p.weeks.flatMap((w) => w.sessions)
  const defaultDate = p.today?.date ?? p.next?.date ?? allSessions[0]?.date ?? today
  const selDate = selected ?? defaultDate
  const session = allSessions.find((s) => s.date === selDate) ?? null
  const isToday = session?.date === today
  const isNext = !p.today && session?.key === p.next?.key
  const done = !!session && coach.logs.some((l) => l.sessionKey === session.key)
  const viewWeek = week ?? (session ? p.weeks.findIndex((w) => w.sessions.some((s) => s.key === session.key)) + 1 : p.weekIndex)
  const suggested = suggestions.filter((s) => s.score >= 2).slice(0, 3)

  async function saveProfileNow(next: TrainingProfile) {
    setBusy(true)
    setSaveErr(null)
    try {
      const changed = !result!.saved || next.focus.join() !== training.focus.join() || next.level !== training.level
      const saved = await saveTrainingProfile(user, crewId, { ...next, startedAt: changed ? mondayOf(today) : next.startedAt })
      setCoach((c) => (c ? { ...c, profile: saved } : c))
      setSelected(null)
      setWeek(null)
      setEditing(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function saveLogNow(v: { minutes: number; effort: number; pain: boolean }) {
    if (!session) return
    setBusy(true)
    setSaveErr(null)
    try {
      const prev = coach!.logs.find((l) => l.sessionKey === session.key && l.date === session.date)
      const item = await logSession(user, crewId, { date: session.date, sessionKey: session.key, ...v })
      setCoach((c) => (c ? { ...c, logs: [...c.logs.filter((l) => !(l.sessionKey === item.sessionKey && l.date === item.date)), item] } : c))
      // The rest of the app reads exercise minutes as one daily total.
      if (session.date === today) {
        const already = seriesOf(data.rows, 'exercise', 1, day).find((x) => x.day === day)?.value ?? 0
        const delta = v.minutes - (prev?.minutes ?? 0)
        if (delta !== 0) await data.add({ exercise: Math.min(300, Math.max(0, Math.round(already + delta))) }, 'manual', 'Coach session log').catch(() => undefined)
      }
      setLogging(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ---- activity data (unchanged from the previous coach)
  const weekEx = seriesOf(data.rows, 'exercise', 7, day)
  const exDef = vitalFor('exercise', ctx)
  const waterDef = vitalFor('water', ctx)
  const sleepDef = vitalFor('sleep', ctx)
  const exTarget = space ? 90 : 21
  const waterTarget = space ? 2.5 : 2
  const water = ev?.meta.water ? ev.values.water : null

  return (
    <div>
      <PageHeader
        eyebrow={space ? 'Coach' : CONTEXTS[ctx].activityTab}
        title="Your programme"
        description={`A 4-week plan built from your training profile, health profile, latest AURA assessment and readings. Restrictions come first. AURA never raises a load on its own — your ${contact} sets loads.`}
        actions={
          canEdit ? (
            <Button icon={SlidersHorizontal} onClick={() => setEditing(true)}>
              Training profile
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-10">
        {!canEdit && (
          <Notice tone="info" title="Read-only view">
            You are viewing {name}’s programme. Only they can change it or log sessions.
          </Notice>
        )}
        {loadErr && (
          <Notice tone="warn" title="Saved programme not available">
            {loadErr} The plan below uses AURA’s defaults.
          </Notice>
        )}

        <Section title="Before you train" description={safety.plan.basis.length ? `Based on: ${safety.plan.basis.join(', ')}.` : 'No health profile, assessment or readings yet — the checks below say what is missing.'}>
          <div className="max-w-3xl space-y-3">
            {safety.plan.items.length ? (
              safety.plan.items.map((a) => <AdaptationNotice key={a.id} a={a} />)
            ) : (
              <Notice tone="ok" title="No restrictions found">
                Nothing in your profile, latest assessment or readings changes today’s plan.
              </Notice>
            )}
            {safety.notChecked.length > 0 && (
              <Notice tone="info" title="Not checked yet">
                <ul className="list-disc space-y-1 pl-5">
                  {safety.notChecked.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>

          {(p.substitutions.length > 0 || safety.effortCap) && (
            <div className="mt-6 max-w-3xl">
              <h3 className="text-[15px] font-semibold text-ink">Changed for your safety</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {safety.effortCap && (
                  <li className="py-3">
                    <p className="text-[15px] text-ink">Effort capped at {safety.effortCap.max} of 10</p>
                    <p className="text-sm text-dim">{safety.effortCap.reason}</p>
                    <RuleCite ruleId={safety.effortCap.ruleId} rule={safety.effortCap.rule} />
                  </li>
                )}
                {p.substitutions.map((s) => (
                  <li key={`${s.from}-${s.to}`} className="py-3">
                    <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-ink">
                      {EXERCISE_BY_ID[s.from]?.name}
                      <ArrowRight className="h-4 w-4 text-dim" aria-label="replaced by" />
                      {s.to ? EXERCISE_BY_ID[s.to]?.name : <span className="text-soft">left out</span>}
                    </p>
                    <p className="text-sm text-dim">{s.reason}</p>
                    <RuleCite ruleId={s.ruleId} rule={s.rule} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="mt-6 max-w-3xl space-y-2 text-sm text-soft">
            {safety.notes.map((n) => (
              <li key={n.id}>
                {n.text}
                <RuleCite ruleId={n.ruleId} rule={n.rule} />
              </li>
            ))}
          </ul>
        </Section>

        {!training.confirmed && (
          <Notice
            tone="info"
            title={suggested.length ? `Suggested focus: ${suggested.map((s) => FOCUS_BY_ID[s.id].label.toLowerCase()).join(', ')}` : 'Starting with general fitness'}
          >
            {suggested.length ? (
              <ul className="mt-1 space-y-1">
                {suggested.map((s) => (
                  <li key={s.id}>
                    <span className="text-ink">{FOCUS_BY_ID[s.id].label}:</span> {s.reasons[0]}
                  </li>
                ))}
              </ul>
            ) : (
              <p>AURA found nothing specific in your data yet. Pick focus areas such as muscle loss or balance and the programme changes to match.</p>
            )}
            {canEdit && (
              <div className="mt-3">
                <Button size="sm" onClick={() => setEditing(true)}>
                  Review and confirm
                </Button>
              </div>
            )}
          </Notice>
        )}

        <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
          <Section className="lg:col-span-7" title={isToday ? 'Today’s session' : isNext ? 'Next session' : 'Session'} description={p.onHold ? 'On hold because of a restriction above.' : `${p.focus.map((f) => FOCUS_BY_ID[f].short).join(' · ')} programme`}>
            {!p.today && !selected && p.next && (
              <p className="mb-4 flex items-center gap-2 text-sm text-soft">
                <Moon className="h-4 w-4 text-dim" aria-hidden="true" />
                Today is a rest day. Next: {WEEKDAY[p.next.weekday]}.
              </p>
            )}
            {session ? (
              <SessionView
                session={session}
                subs={p.substitutions}
                isToday={isToday}
                done={done}
                onHold={p.onHold}
                footer={
                  <div className="mt-6 space-y-4">
                    {(isToday || isNext) && (
                      <Notice tone="info" title={p.adapt.suggestedOnly ? 'Ready for the next step?' : DECISION_TITLE[p.adapt.decision]}>
                        {p.adapt.reason}
                        <span className="mt-2 flex">
                          <Badge>AURA rule</Badge>
                        </span>
                      </Notice>
                    )}
                    {canEdit && isToday && !p.onHold && (
                      <Button variant="primary" icon={Check} onClick={() => setLogging(true)}>
                        {done ? 'Update today’s log' : 'Log this session'}
                      </Button>
                    )}
                    {canEdit && !isToday && session.date > today && <p className="text-sm text-dim">You can log this session on {shortDate(session.date)}.</p>}
                  </div>
                }
              />
            ) : (
              <EmptyState icon={Dumbbell} title="No session planned" description="Open your training profile to choose training days." />
            )}
          </Section>

          <div className="space-y-10 lg:col-span-5">
            <Section title="This week">
              <WeekPlan
                p={p}
                week={viewWeek}
                onWeek={setWeek}
                selected={selDate}
                onSelect={(d) => {
                  setSelected(d)
                }}
                today={today}
              />
              {!space && (
                <p className="mt-4 text-sm text-dim">
                  Planned aerobic time this week: {p.targets.aerobicMinutes} min. Guidelines suggest about 150 min a week — walks and active chores on other days count too.
                </p>
              )}
            </Section>

            <Section
              title="Your training profile"
              description={training.confirmed ? (training.updatedAt ? `Saved ${new Date(training.updatedAt).toLocaleDateString()}` : 'Saved') : 'Suggested by AURA — not confirmed yet'}
              action={
                canEdit ? (
                  <Button size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ) : undefined
              }
            >
              <List>
                <Row title="Focus" description={p.focus.map((f) => FOCUS_BY_ID[f].label).join(', ')} />
                <Row title="Level" description={LEVELS.find((l) => l.id === training.level)?.label} />
                <Row title="Schedule" description={`${p.targets.days} days a week · ${training.minutes} min per session`} />
                <Row title="Equipment" description={training.equipment.length ? training.equipment.map((e) => EQUIPMENT_BY_ID[e]?.label).filter(Boolean).join(', ') : 'Body weight only'} />
                <Row title="Limitations" description={training.limits.length ? training.limits.map((l) => LIMIT_LABEL[l]).join(', ') : 'None entered'} />
              </List>
              {p.adjustments.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-soft">
                  {p.adjustments.map((a) => (
                    <li key={a.text}>
                      {a.text}
                      <RuleCite ruleId={a.ruleId} rule={a.rule} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        {p.notes.length > 0 && (
          <Section title="For your focus areas">
            <ul className="max-w-3xl divide-y divide-line border-y border-line">
              {p.notes.map((n) => (
                <li key={n.text} className="py-3">
                  <p className="text-[15px] text-ink">{n.text}</p>
                  <RuleCite ruleId={n.ruleId} rule={n.rule} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {safety.plan.focus && (
          <Disclosure title={safety.plan.focus.title} meta={`${safety.plan.focus.items.length} tips`}>
            <p className="mb-2 text-sm text-dim">Prevention and lifestyle advice from the sources behind that assessment.</p>
            <ul className="divide-y divide-line">
              {safety.plan.focus.items.map((x) => (
                <li key={x.q} className="py-3">
                  <p className="text-[15px]">{x.t}</p>
                  <SourceLink className="mt-1" href={x.src.url} org={x.src.org} title={x.src.title} />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <Disclosure title="Your activity data" meta="Last 7 days">
          {!ev ? (
            <EmptyState icon={Activity} title="No measurements yet" description="Logged sessions, sleep and water appear here once you add them." />
          ) : (
            <Stagger className="grid gap-4 lg:grid-cols-3 lg:gap-6">
              <StaggerItem>
                <Card className="h-full">
                  <h3 className="label">Exercise · last 7 days</h3>
                  {weekEx.length ? (
                    <div className="mt-3 h-44 rounded-xl border border-line bg-deep p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weekEx} margin={chart.margin}>
                          <XAxis dataKey="day" tickFormatter={(d) => `D${d}`} {...chart.xAxis} />
                          <Tooltip {...chart.tooltip} content={<ChartTooltip unit="min" formatLabel={(d) => `Day ${d}`} />} />
                          <ReferenceLine y={exTarget} {...chart.refLine()} />
                          <Bar dataKey="value" name="Minutes" {...chart.bar}>
                            {weekEx.map((w) => {
                              const st = exDef.evaluate({ ...ev.values, exercise: w.value })
                              return <Cell key={w.day} fill={st === 'ok' ? 'var(--color-soft)' : STATUS_COLOR[st]} />
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-dim">No exercise logged this week.</p>
                  )}
                  <p className="mt-2 text-sm text-dim">{space ? 'Dashed line: 90 min/day target. Coloured bars need attention. NASA reports ISS crews training 1.5–2 h a day.' : `Dashed line: about ${exTarget} min/day (≈ 150 min per week, WHO). Coloured bars need attention.`}</p>
                </Card>
              </StaggerItem>
              <StaggerItem>
                <Card className="h-full">
                  <Metric label="Sleep · 7-night average" value={sleepAvg} decimals={1} unit="h / night" status={sleepAvg == null ? null : sleepDef.evaluate({ ...ev.values, sleep: sleepAvg })} />
                  <p className="mt-3 text-sm text-soft">Short sleep lowers today’s intensity cap (see “Before you train”).</p>
                </Card>
              </StaggerItem>
              <StaggerItem>
                <Card className="h-full">
                  <Metric label="Water today" value={water} decimals={1} unit={`of ${waterTarget} L`} status={water == null ? null : waterDef.evaluate(ev.values)} />
                  {water != null && <Meter className="mt-4" value={water} max={waterTarget} label="Water against today's target" />}
                  {canEdit && (
                    <Button className="mt-4" full icon={Plus} onClick={() => void data.add({ water: Math.round(((water ?? 0) + 0.25) * 10) / 10 }, 'manual', 'Drink log')}>
                      250 mL
                    </Button>
                  )}
                  <p className="mt-3 text-sm text-dim">{space ? 'Minimum 2.5 L/day per crew member (NASA OCHMO TB-027).' : waterDef.source}</p>
                </Card>
              </StaggerItem>
            </Stagger>
          )}
        </Disclosure>

        {space && (
          <Disclosure title="Onboard equipment" meta="3 devices">
            <List>
              {EQUIPMENT.map((q) => (
                <Row key={q.id} title={`${q.id} · ${q.name}`} description={q.spec} />
              ))}
            </List>
            <SourceLink className="mt-3" href="https://www.nasa.gov/ochmo-tb-031-exercise-overview-2/" org="NASA OCHMO" title="TB-031 Exercise overview" />
          </Disclosure>
        )}

        <HowBuilt rules={p.rules} />
      </div>

      {canEdit && (
        <>
          <ProfileEditor open={editing} onClose={() => setEditing(false)} context={ctx} initial={training} suggestions={suggestions} onSave={(x) => void saveProfileNow(x)} saving={busy} error={saveErr} />
          <LogDialog open={logging} onClose={() => setLogging(false)} session={session} onSave={(v) => void saveLogNow(v)} saving={busy} error={saveErr} />
        </>
      )}
    </div>
  )
}
