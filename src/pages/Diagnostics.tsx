import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BodyViewer from '../components/BodyViewer'
import EditVitalModal from '../components/EditVitalModal'
import { Button, Card, ChartTooltip, EmptyState, List, Meter, Metric, Notice, PageHeader, PageTransition, Row, Section, SourceLink, Skeleton, StatusIcon, StatusPill, Tabs, SYSTEM_ICON, chart, cx } from '../components/ui'
import { impactOf, vitalFor } from '../data/contexts'
import { recordsForSystem } from '../data/kb'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, VITAL_BY_KEY, type FieldId, type Status, type VitalKey } from '../data/vitals'
import { baselineOf, timeAgo } from '../lib/health'
import { isImportedDevice } from '../lib/samsungHealth'
import { useCrewData, useSession } from '../lib/session'
import { onUi } from '../lib/uiBus'
import { DATA_CHANGED, takePendingSystem } from '../lib/voice/pending'
import { AXIS_LABEL, BANDS, dateOfDay, fmtLong, fmtShort, niceAxis } from '../lib/trend'
import type { Measurement } from '../lib/types'


const TREND_DAYS = 30


type Point = { day: number; value: number; imported: boolean }



/** One point per tracking day over the last `days` days: the newest reading of that day wins. */
function trendOf(rows: Measurement[], metric: FieldId, today: number, days: number): Point[] {
  const byDay = new Map<number, Measurement>()
  for (const r of rows) {
    if (r.metric !== metric || r.day <= today - days) continue
    const cur = byDay.get(r.day)
    if (!cur || r.at >= cur.at) byDay.set(r.day, r)
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, r]) => ({ day, value: r.value, imported: isImportedDevice(r.device) }))
}

export default function Diagnostics({ crewId }: { crewId: number }) {
  const { user, mission } = useSession()
  const ctx = mission?.context ?? 'space'
  const data = useCrewData(crewId)
  const [sel, setSel] = useState<SystemId>('heart')
  const [editing, setEditing] = useState<VitalKey | null>(null)

  // Voice: "show the heart" selects a system; a value logged by voice refreshes the data.
  const reloadData = data.reload
  useEffect(() => {
    const pending = takePendingSystem()
    if (pending !== undefined && pending !== null) setSel(pending)
    const off = onUi('select-system', (d) => {
      if (d.system) setSel(d.system) // null (whole body) has no meaning here: a system is always selected
    })
    const refresh = () => void reloadData()
    window.addEventListener(DATA_CHANGED, refresh)
    return () => {
      off()
      window.removeEventListener(DATA_CHANGED, refresh)
    }
  }, [reloadData])
  const ev = data.ev
  const sys = SYSTEM_BY_ID[sel]
  const vitals = ev ? sys.vitals.filter((k) => ev.vitalStatus[k]) : []
  const [metric, setMetric] = useState<VitalKey | null>(null)
  const active = metric && vitals.includes(metric) ? metric : vitals[0] ?? null
  const research = useMemo(() => (ctx === 'space' ? recordsForSystem(sel).filter((r) => r.findings.length)[0] : undefined), [sel, ctx])
  const impact = impactOf(sel, ctx)

  if (!ev) {
    return data.error ? (
      <>
        <PageHeader title="Diagnostics" />
        <Notice tone="crit" role="alert" title="Could not load the diagnostics">
          {data.error}
        </Notice>
      </>
    ) : (
      <>
        <PageHeader title="Diagnostics" description="Pick a body system to see its readings, its 30-day trend and the research behind it." />
        <div className="grid gap-6 xl:grid-cols-12">
          <Skeleton className="hidden h-96 xl:col-span-3 xl:block" />
          <Skeleton className="h-[420px] sm:h-[520px] xl:col-span-5 xl:h-[640px]" />
          <Skeleton className="h-96 xl:col-span-4" />
        </div>
      </>
    )
  }

  // A system with no reading at all is "No data", never "Normal" (the rules layer defaults it to ok for the 3D model).
  const hasData = (id: SystemId) => ev.systemMeasured[id]
  const statusOf = (id: SystemId): Status | null => (hasData(id) ? ev.systemStatus[id] : null)
  const summaries = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.vitals.filter((k) => ev.vitalStatus[k]).map((k) => `${ev.defByKey[k]!.display(ev.values)} ${ev.defByKey[k]!.unit}`).join(' · ') || (s.id === 'radiation' ? `${ev.rad.dose.toFixed(0)} mSv` : 'No reading yet')]),
  ) as Record<SystemId, string>

  const def = active ? (ev.defByKey[active] ?? VITAL_BY_KEY[active]) : null
  const today = mission?.day ?? 142
  const trend = def ? trendOf(data.rows, def.primary, today, TREND_DAYS) : []
  const base = def ? baselineOf(data.rows, def.primary) : null
  const band = active ? BANDS[active] : undefined
  const yAxis = niceAxis([...trend.map((p) => p.value), ...(base != null ? [base] : [])])
  const dateMode = ctx !== 'space' || trend.some((p) => p.day <= 0)
  const dayLabel = (d: number) => (dateMode ? fmtShort(dateOfDay(d, today)) : `D${d}`)
  const importedDays = trend.filter((p) => p.imported).length
  const importedByDay = new Map(trend.map((p) => [p.day, p.imported]))
  const metricName = def && def.fields.length > 1 ? def.fields[0].label : def?.label
  const pointStatus = (v: number): Status | null => (def && def.fields.length === 1 ? def.evaluate({ ...ev.values, [def.primary]: v }) : null)
  const outOfRange = trend.some((p) => pointStatus(p.value) && pointStatus(p.value) !== 'ok')
  const sysStatus = statusOf(sel)

  return (
    <div>
      <PageHeader title="Diagnostics" description="Pick a body system to see its readings, its 30-day trend and the research behind it." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-12">
        <nav aria-label="Body systems" className="min-w-0 xl:col-span-3">
          <Tabs<SystemId>
            label="Body systems"
            className="xl:hidden"
            value={sel}
            onChange={setSel}
            options={ev.systems.map((s) => ({ value: s.id, label: s.name, icon: SYSTEM_ICON[s.id], status: statusOf(s.id) ?? undefined }))}
          />
          <List className="hidden xl:block">
            {ev.systems.map((s) => {
              const Icon = SYSTEM_ICON[s.id]
              return <Row key={s.id} title={s.name} description={summaries[s.id]} selected={sel === s.id} onClick={() => setSel(s.id)} leading={<Icon className="h-5 w-5" aria-hidden="true" />} trailing={<StatusIcon status={statusOf(s.id)} />} />
            })}
          </List>
        </nav>

        <Card pad="none" className="relative h-[420px] overflow-hidden sm:h-[520px] xl:sticky xl:top-20 xl:col-span-5 xl:h-[640px] xl:self-start">
          <BodyViewer statuses={ev.systemStatus} measured={ev.systemMeasured} summaries={summaries} selected={sel} onSelect={setSel} heartRate={ev.values.hr} showRadiation={ev.showRad} />
        </Card>

        <div className="min-w-0 xl:col-span-4 xl:min-h-[640px]">
          <PageTransition routeKey={sel}>
            <div className="space-y-8">
              <section aria-labelledby="diag-system">
                <p className="text-sm text-dim">{ctx === 'space' ? `Hazard · ${sys.hazard}` : impact.heading}</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h2 id="diag-system" className="text-title text-ink">
                    {sys.name}
                  </h2>
                  <StatusPill status={sysStatus} />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-soft">{impact.text}</p>

                {vitals.length > 0 && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {vitals.map((k) => {
                      const d = ev.defByKey[k]!
                      const m = ev.meta[d.primary]
                      const on = active === k
                      return (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setMetric(k)}
                          className={cx('rounded-2xl border p-4 text-left transition-colors', on ? 'border-ink bg-panel2' : 'border-line bg-panel hover:bg-panel2')}
                        >
                          <Metric size="md" label={d.label} value={d.display(ev.values)} unit={d.unit} status={ev.vitalStatus[k]} hint={timeAgo(m?.at)} />
                          <p className="meta mt-1.5 break-words">{m?.device}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
                {vitals.length === 0 && sel !== 'radiation' && <EmptyState className="mt-5" title="No readings yet" description="Log a measurement or connect a device to see this system." />}
                {sel === 'radiation' && (
                  <Card className="mt-5">
                    <Metric label="Mission dose so far" value={ev.rad.dose} decimals={0} unit="mSv" size="lg" status={ev.rad.status} />
                    <div className="mt-4">
                      <Meter value={ev.rad.pct} min={0} max={100} marks={[{ at: 50, status: 'warn' }, { at: 80, status: 'crit' }]} status={ev.rad.status === 'ok' ? undefined : ev.rad.status} label="Share of the career dose limit" />
                    </div>
                    <p className="mt-3 text-sm text-dim">{ev.rad.pct.toFixed(0)}% of the career limit. Marks at 50% (attention) and 80% (urgent) are AURA demo thresholds.</p>
                    <p className="mt-1 text-sm text-dim">{ev.rad.mission.doseNote}</p>
                  </Card>
                )}
              </section>

              {def && (
                <Section title={`${def.label} · last ${TREND_DAYS} days`} description={`${metricName} in ${def.unit}${importedDays ? ` · ${importedDays} imported day${importedDays === 1 ? '' : 's'}` : ''}`}>
                  {trend.length > 1 ? (
                    <>
                      <div className="h-64 rounded-xl border border-line bg-deep p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart key={def.key} data={trend} margin={{ ...chart.margin, bottom: 18, left: 4 }}>
                            <CartesianGrid {...chart.grid} />
                            <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} {...chart.xAxis} tickFormatter={dayLabel} label={{ ...{ value: dateMode ? 'Date' : 'Mission day', position: 'insideBottom', offset: -12 }, style: AXIS_LABEL }} />
                            <YAxis domain={yAxis.domain} ticks={yAxis.ticks} {...chart.yAxis} width={52} label={{ value: def.unit, angle: -90, position: 'insideLeft', offset: 4, style: { ...AXIS_LABEL, textAnchor: 'middle' } }} />
                            {band && <ReferenceArea y1={band[0]} y2={band[1]} {...chart.band('ok')} />}
                            {base != null && <ReferenceLine y={base} {...chart.refLine()} />}
                            <Tooltip
                              {...chart.tooltip}
                              content={
                                <ChartTooltip
                                  unit={def.unit}
                                  formatLabel={(d) => (
                                    <>
                                      {dateMode ? fmtLong(dateOfDay(Number(d), today)) : `Mission day ${d} · ${fmtShort(dateOfDay(Number(d), today))}`}
                                      {importedByDay.get(Number(d)) ? ' · Imported from device' : ''}
                                    </>
                                  )}
                                />
                              }
                            />
                            <Line
                              dataKey="value"
                              name={metricName}
                              {...chart.line}
                              dot={(p: { cx?: number; cy?: number; index?: number; payload?: Point }) => {
                                if (p.cx == null || p.cy == null || !p.payload) return <g key={`d${p.index}`} />
                                const st = pointStatus(p.payload.value)
                                const fill = st && st !== 'ok' ? STATUS_COLOR[st] : 'var(--color-ink)'
                                // hollow ring = imported from a device; filled dot = entered or simulated
                                return p.payload.imported ? (
                                  <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={4} fill="var(--color-deep)" stroke={fill} strokeWidth={1.75} />
                                ) : (
                                  <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={st && st !== 'ok' ? 3.5 : 2.5} fill={fill} />
                                )
                              }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-sm text-dim">
                        {band && `Green band: usual reference range, ${band[0]}–${band[1]} ${def.unit}. `}
                        {base != null && 'Dashed grey line: your baseline, the average of your first 14 days with this measurement. '}
                        {outOfRange && 'Amber or red dots: readings outside the normal range. '}
                        {importedDays > 0 && 'Hollow rings: days imported from a device. '}
                        {dateMode ? 'The horizontal axis shows calendar dates.' : 'D is the mission day.'}
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      title={trend.length ? 'Only one day of readings' : `No readings in the last ${TREND_DAYS} days`}
                      description={trend.length ? 'A trend needs at least two different days. Log another reading tomorrow.' : 'Log a measurement and the trend appears here.'}
                    />
                  )}
                </Section>
              )}

              {!research && impact.source && ctx !== 'space' && (
                <Section title="What the research says">
                  <p className="text-sm leading-relaxed text-soft">{impact.text}</p>
                  <div className="mt-3">
                    <SourceLink href={impact.source.url} org={impact.source.org} title={impact.source.title} />
                  </div>
                </Section>
              )}
              {research && (
                <Section title="What NASA research says">
                  <p className="text-sm leading-relaxed text-soft">{research.findings[0].text}</p>
                  <blockquote className="mt-3 border-l-2 border-edge pl-3 text-sm italic leading-snug text-dim">“{research.findings[0].quote}”</blockquote>
                  <div className="mt-3">
                    <SourceLink href={research.url} org={research.organization} title={research.title} />
                  </div>
                </Section>
              )}

              <div className="flex flex-wrap gap-3">
                {user?.role === 'astronaut' && vitals.length > 0 && (
                  <Button variant="primary" className="flex-1" onClick={() => setEditing(active)}>
                    Log a measurement
                  </Button>
                )}
                {user?.role !== 'ground' && (
                  <Button to={`/crew/${crewId}/aura`} className="flex-1">
                    Examine with AURA
                  </Button>
                )}
              </div>
            </div>
          </PageTransition>
        </div>
      </div>

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
