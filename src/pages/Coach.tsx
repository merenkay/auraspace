import { Activity, Check, Dumbbell, Pause, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Badge, Button, Card, chart, ChartTooltip, EmptyState, List, Meter, Metric, Notice, PageHeader, Row, Section, Skeleton, SourceLink, Stagger, StaggerItem } from '../components/ui'
import type { HealthProfile } from '../data/conditions/profile'
import { CONTEXTS, THRESHOLD_SOURCES, vitalFor } from '../data/contexts'
import Disclosure from '../components/aura/Disclosure'
import { STATUS_COLOR } from '../data/vitals'
import { latestAssessment, loadProfile, type SavedAssessment } from '../lib/clinic'
import { buildCoachPlan, type Adaptation } from '../lib/coachPlan'
import { seriesOf } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'

const EQUIPMENT = [
  { id: 'ARED', name: 'Advanced Resistive Exercise Device', spec: 'Up to 600 lb resistance' },
  { id: 'T2', name: 'Treadmill 2 (COLBERT)', spec: 'Up to 12.7 mph · harness load up to 70% body mass' },
  { id: 'CEVIS', name: 'Cycle ergometer', spec: 'Peak 200 W · up to 100 RPM' },
]
const SESSION = [
  { eq: 'CEVIS', name: 'Aerobic intervals', min: 30 },
  { eq: 'ARED', name: 'Lower-body resistance', min: 45 },
  { eq: 'T2', name: 'Loaded running', min: 15 },
]
const TONE = { stop: 'crit', caution: 'warn', adjust: 'info' } as const

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
  const { mission, user } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const ctx = ev?.context ?? mission?.context ?? user?.context ?? 'space'
  const space = ctx === 'space'
  const today = mission?.day ?? 142
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [latest, setLatest] = useState<SavedAssessment | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([loadProfile(user, crewId).catch(() => null), latestAssessment(user, crewId)]).then(([p, l]) => {
      if (!alive) return
      setProfile(p)
      setLatest(l)
    })
    return () => {
      alive = false
    }
  }, [user, crewId])

  const week = seriesOf(data.rows, 'exercise', 7, today)
  const sleep = seriesOf(data.rows, 'sleep', 7, today)
  const sleepAvg = sleep.length ? sleep.reduce((s, p) => s + p.value, 0) / sleep.length : null
  const plan = useMemo(() => buildCoachPlan({ context: ctx, ev, profile, latest, sleepAvg }), [ctx, ev, profile, latest, sleepAvg])
  const onHold = plan.items.some((i) => i.level === 'stop')

  if (data.loading && !ev) return <Skeleton className="h-64" />

  const exDef = vitalFor('exercise', ctx)
  const waterDef = vitalFor('water', ctx)
  const sleepDef = vitalFor('sleep', ctx)
  const exTarget = space ? 90 : 21
  const waterTarget = space ? 2.5 : 2
  const water = ev?.meta.water ? ev.values.water : null
  const canEdit = user?.role === 'astronaut' || user?.role === 'member'

  return (
    <div>
      <PageHeader
        eyebrow={space ? 'Coach' : CONTEXTS[ctx].activityTab}
        title="Your programme"
        description={`Built from your health profile, your latest AURA assessment and today’s readings. Restrictions come first. The coach never raises a load on its own — your ${CONTEXTS[ctx].contact} sets them.`}
      />
      <div className="space-y-10">
        <Section title="Before you train" description={plan.basis.length ? `Based on: ${plan.basis.join(', ')}.` : 'No profile, assessment or readings yet — add them to personalise this.'}>
          {plan.items.length ? (
            <div className="max-w-3xl space-y-3">{plan.items.map((a) => <AdaptationNotice key={a.id} a={a} />)}</div>
          ) : (
            <Notice tone="ok" title="No restrictions found">Nothing in your profile, latest assessment or readings changes today’s plan.</Notice>
          )}
          {!profile && (
            <p className="mt-3 text-sm text-dim">
              Tip: fill in your health profile on the AURA tab so the coach can account for conditions such as diabetes, asthma or past falls.
            </p>
          )}
        </Section>

        {space ? (
          <Section title="Today’s approved session" description="Prescription approved by the flight surgeon · AURA never raises loads on its own">
            <div className="mb-3">{onHold ? <Badge tone="crit" icon={Pause}>On hold</Badge> : <Badge tone="ok" icon={Check}>Restrictions checked</Badge>}</div>
            <List className={onHold ? 'opacity-60' : undefined}>
              {SESSION.map((b) => (
                <Row key={b.eq} leading={<Dumbbell className="h-5 w-5" aria-hidden="true" />} title={b.name} description={b.eq} trailing={<span className="meta">{b.min} min</span>} />
              ))}
            </List>
            {onHold && <p className="mt-3 text-sm text-soft">The session is on hold because of a restriction above.</p>}
          </Section>
        ) : (
          <Section title="Your activity goal" description={`${THRESHOLD_SOURCES.activity.source.org} recommendation${onHold ? ' — for after you are cleared' : ''}`}>
            <Metric label="Weekly target" value={150} unit="minutes" />
            <p className="mt-3 max-w-2xl text-soft">
              {THRESHOLD_SOURCES.activity.text} {ctx === 'home' ? THRESHOLD_SOURCES.activityOlderBalance.text : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4">
              <SourceLink href={THRESHOLD_SOURCES.activity.source.url} org={THRESHOLD_SOURCES.activity.source.org} title={THRESHOLD_SOURCES.activity.source.title} />
              {ctx === 'home' && <SourceLink href={THRESHOLD_SOURCES.activityOlderBalance.source.url} org={THRESHOLD_SOURCES.activityOlderBalance.source.org} title={THRESHOLD_SOURCES.activityOlderBalance.source.title} />}
            </div>
          </Section>
        )}

        {plan.focus && (
          <Disclosure title={plan.focus.title} meta={`${plan.focus.items.length} tips`}>
            <p className="mb-2 text-sm text-dim">Prevention and lifestyle advice from the sources behind that assessment.</p>
            <ul className="divide-y divide-line">
              {plan.focus.items.map((p) => (
                <li key={p.q} className="py-3">
                  <p className="text-[15px]">{p.t}</p>
                  <SourceLink className="mt-1" href={p.src.url} org={p.src.org} title={p.src.title} />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <Section title="Your week" description="Last 7 days of your own entries">
          {!ev ? (
            <EmptyState icon={Activity} title="No measurements yet" description="Log exercise, sleep and water on the Overview tab and your weekly picture appears here." />
          ) : (
            <Stagger className="grid gap-4 lg:grid-cols-3 lg:gap-6">
              <StaggerItem>
                <Card className="h-full">
                  <h3 className="label">Exercise · last 7 days</h3>
                  {week.length ? (
                    <div className="mt-3 h-44 rounded-xl border border-line bg-deep p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={week} margin={chart.margin}>
                          <XAxis dataKey="day" tickFormatter={(d) => `D${d}`} {...chart.xAxis} />
                          <Tooltip {...chart.tooltip} content={<ChartTooltip unit="min" formatLabel={(d) => `Day ${d}`} />} />
                          <ReferenceLine y={exTarget} {...chart.refLine()} />
                          <Bar dataKey="value" name="Minutes" {...chart.bar}>
                            {week.map((w) => {
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
                  <p className="mt-3 text-sm text-soft">{space ? 'NASA recommends 7–9 h; astronauts average about 6 h in flight.' : ctx === 'home' ? THRESHOLD_SOURCES.sleepOlder.text : 'Fixed bedtimes helped Concordia crews sleep through the polar night (ESA).'}</p>
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
        </Section>

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
      </div>
    </div>
  )
}
