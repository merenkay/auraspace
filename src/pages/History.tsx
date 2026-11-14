import { ChartLine, FlaskConical, Upload, Watch } from 'lucide-react'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, ChartTooltip, EmptyState, Notice, PageHeader, Reveal, Section, Skeleton, StatusText, Tabs, chart } from '../components/ui'
import { VITAL_BY_KEY, type FieldId, type VitalKey } from '../data/vitals'
import { baselineOf } from '../lib/health'
import { isImportedDevice, isSyntheticDevice } from '../lib/samsungHealth'
import { useCrewData, useSession } from '../lib/session'
import { AXIS_LABEL, BANDS, dateOfDay, fmtLong, fmtShort, niceAxis } from '../lib/trend'
import type { Measurement } from '../lib/types'

// The wizard (and its parser) loads only when someone opens it.
const SamsungImportWizard = lazy(() => import('../components/import/SamsungImportWizard'))


/** With this many points or fewer every reading gets its own dot (DESIGN.md §9). */
const DOT_LIMIT = 31

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

type Point = { day: number; value: number; value2?: number; imported: boolean }



/** One point per tracking day (the newest reading of that day wins), every day including day <= 0. */
function seriesFor(rows: Measurement[], primary: FieldId, second?: FieldId): Point[] {
  const byDay = new Map<number, { m: Measurement; second?: Measurement }>()
  for (const r of rows) {
    if (r.metric === primary) {
      const cur = byDay.get(r.day)
      if (!cur || r.at >= cur.m.at) byDay.set(r.day, { m: r, second: cur?.second })
    }
  }
  if (second) {
    for (const r of rows) {
      if (r.metric !== second) continue
      const cur = byDay.get(r.day)
      if (cur && (!cur.second || r.at >= cur.second.at)) cur.second = r
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, { m, second: s }]) => ({ day, value: m.value, value2: s?.value, imported: isImportedDevice(m.device) }))
}

function SourceCell({ r }: { r: Measurement }) {
  if (isImportedDevice(r.device)) {
    const synthetic = isSyntheticDevice(r.device)
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge icon={synthetic ? FlaskConical : Watch}>{synthetic ? 'Imported · synthetic sample' : 'Imported · device'}</Badge>
        <span className="hidden text-dim md:inline">{synthetic ? 'Samsung Health sample' : r.device}</span>
      </span>
    )
  }
  return <span className="text-dim">{r.device}</span>
}

export default function History({ crewId }: { crewId: number }) {
  const { mission, user, backend } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const [key, setKey] = useState<VitalKey>('bp')
  const [importOpen, setImportOpen] = useState(false)
  const [importMounted, setImportMounted] = useState(false)
  const canImport = !!backend && !!user && (user.role === 'astronaut' || user.role === 'member') && user.crewId === crewId
  const today = mission?.day ?? 142
  const imported = useMemo(() => data.rows.filter((r) => isImportedDevice(r.device)), [data.rows])

  const openImport = () => {
    setImportMounted(true)
    setImportOpen(true)
  }
  const importButton = canImport ? (
    <Button icon={Upload} onClick={openImport}>
      Import from Samsung Health
    </Button>
  ) : null
  const wizard =
    canImport && importMounted && backend ? (
      <Suspense fallback={null}>
        <SamsungImportWizard open={importOpen} onClose={() => setImportOpen(false)} crewId={crewId} backend={backend} onImported={() => void data.reload()} />
      </Suspense>
    ) : null

  const header = <PageHeader title="History" description="Every measurement in this record, with where it came from." actions={importButton} />

  // The wizard always sits in the same place in the tree, so reloading data behind it never resets it.
  const shell = (body: ReactNode) => (
    <div>
      {body}
      {wizard}
    </div>
  )
  if (data.error && !data.rows.length) {
    return shell(
      <>
        {header}
        <Notice tone="crit" role="alert" title="Could not load the history">
          {data.error}
        </Notice>
      </>,
    )
  }
  if ((data.loading && !data.rows.length) || (data.rows.length && !ev)) {
    return shell(
      <>
        {header}
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-11 w-full max-w-xl" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>,
    )
  }
  if (!data.rows.length || !ev || !ev.vitals.length) {
    return shell(
      <>
        {header}
        <EmptyState
          icon={ChartLine}
          title="No measurements yet"
          description={canImport ? 'Log a reading on the Overview, or bring in your Galaxy Watch history from a Samsung Health export.' : 'Nothing has been recorded for this person yet.'}
        />
      </>,
    )
  }

  const available = ev.vitals
  const def = ev.defByKey[available.some((d) => d.key === key) ? key : available[0].key] ?? VITAL_BY_KEY[key]
  const second = def.fields[1]?.id
  const series = seriesFor(data.rows, def.primary, second)
  const minDay = Math.min(...data.rows.map((r) => r.day))
  // calendar dates instead of "D-12" outside space missions and whenever history predates day 1
  const dateMode = mission?.context !== 'space' || minDay <= 0
  const dayLabel = (d: number) => (dateMode ? fmtShort(dateOfDay(d, today)) : `D${d}`)
  const base = baselineOf(data.rows, def.primary)
  const band = BANDS[def.key]
  const yAxis = niceAxis([...series.flatMap((p) => (p.value2 != null ? [p.value, p.value2] : [p.value])), ...(base != null ? [base] : [])])
  const recent = data.rows.filter((r) => r.metric === def.primary).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)
  const pairOf = (r: Measurement) => (second ? data.rows.find((x) => x.metric === second && x.at === r.at && x.device === r.device) : undefined)
  const importedDays = series.filter((p) => p.imported).length
  const importedByDay = new Map(series.map((p) => [p.day, p.imported]))
  const importedRange = imported.length ? [Math.min(...imported.map((r) => r.day)), Math.max(...imported.map((r) => r.day))] : null
  const syntheticImport = imported.some((r) => isSyntheticDevice(r.device))
  const dotsEverywhere = series.length <= DOT_LIMIT
  const firstName = def.fields[0].label
  const secondName = def.fields[1]?.label
  const spanLabel = mission?.context === 'space' && !dateMode ? 'Whole mission' : 'Since your first reading'

  return shell(
    <>
      {header}
      <div className="space-y-10">
        {importedRange && (
          <Notice
            tone="info"
            title={syntheticImport ? 'Includes a synthetic Samsung Health sample' : 'Includes data imported from Samsung Health'}
            action={
              canImport ? (
                <Button size="sm" variant="quiet" onClick={openImport}>
                  Import again
                </Button>
              ) : undefined
            }
          >
            {imported.length} daily device value{imported.length === 1 ? '' : 's'} from {fmtShort(dateOfDay(importedRange[0], today))} to {fmtShort(dateOfDay(importedRange[1], today))}, tagged “Imported” below.
            {syntheticImport && ' The sample values are invented and are labelled as a synthetic sample.'}
          </Notice>
        )}

        <Tabs<VitalKey> label="Measurement" value={def.key} onChange={setKey} options={available.map((d) => ({ value: d.key, label: d.label, status: ev.vitalStatus[d.key] }))} />

        <Reveal>
          <Section title={def.label} description={`${spanLabel} · ${def.unit}${importedDays ? ` · ${importedDays} imported day${importedDays === 1 ? '' : 's'}` : ''}`}>
            {series.length > 1 ? (
              <>
                <div className="h-72 rounded-xl border border-line bg-deep p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart key={def.key} data={series} margin={{ ...chart.margin, bottom: 18, left: 4 }}>
                      <CartesianGrid {...chart.grid} />
                      <XAxis
                        dataKey="day"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        allowDecimals={false}
                        {...chart.xAxis}
                        tickFormatter={dayLabel}
                        label={{ value: dateMode ? 'Date' : 'Mission day', position: 'insideBottom', offset: -12, style: AXIS_LABEL }}
                      />
                      <YAxis
                        domain={yAxis.domain}
                        ticks={yAxis.ticks}
                        {...chart.yAxis}
                        width={52}
                        label={{ value: def.unit, angle: -90, position: 'insideLeft', offset: 4, style: { ...AXIS_LABEL, textAnchor: 'middle' } }}
                      />
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
                        name={firstName}
                        {...chart.line}
                        dot={(p: { cx?: number; cy?: number; index?: number; payload?: Point }) => {
                          if (p.cx == null || p.cy == null || !p.payload) return <g key={`d${p.index}`} />
                          // hollow ring = imported from a device; filled dot = entered or simulated (shown when there are few points)
                          if (p.payload.imported) return <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={3.5} fill="var(--color-deep)" stroke="var(--color-ink)" strokeWidth={1.75} />
                          return dotsEverywhere ? <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={2.5} fill="var(--color-ink)" /> : <g key={`d${p.index}`} />
                        }}
                      />
                      {second && <Line dataKey="value2" name={secondName} {...chart.line} stroke={chart.series[1]} dot={dotsEverywhere ? { r: 2.5, fill: chart.series[1], stroke: 'none' } : false} activeDot={{ ...chart.line.activeDot, fill: chart.series[1] }} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-sm text-dim">
                  {second ? `Ink line: ${firstName.toLowerCase()}. Grey line: ${secondName?.toLowerCase()}. ` : ''}
                  {band && `Green band: usual reference range${second ? ' for the upper number' : ''}, ${band[0]}–${band[1]} ${def.unit}. `}
                  {base != null && 'Dashed grey line: your baseline, the average of your first 14 days with this measurement. '}
                  {importedDays > 0 && 'Hollow rings: days imported from a device. '}
                  {dateMode ? 'The horizontal axis shows calendar dates.' : 'D is the mission day.'}
                </p>
              </>
            ) : (
              <EmptyState title={series.length ? 'Only one day of readings' : 'No readings for this measurement yet'} description="A line needs at least two different days. Log another reading, or import your device history." />
            )}
          </Section>
        </Reveal>

        <Reveal delay={0.05}>
          <Section title="Records" description="Newest first, up to 12 entries">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[540px] text-sm">
                <caption className="sr-only">Recent {def.label} records, newest first</caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="label px-3 py-2.5 font-medium">
                      When
                    </th>
                    <th scope="col" className="label px-3 py-2.5 font-medium">
                      Value
                    </th>
                    <th scope="col" className="label px-3 py-2.5 font-medium">
                      Source
                    </th>
                    <th scope="col" className="label px-3 py-2.5 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recent.map((r) => {
                    const pair = pairOf(r)
                    const st = def.fields.length === 1 ? def.evaluate({ ...ev.values, [def.primary]: r.value }) : pair ? def.evaluate({ ...ev.values, [def.primary]: r.value, [second!]: pair.value }) : null
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-3 py-3 text-soft">
                          {dateMode ? fmtShort(dateOfDay(r.day, today)) : `Day ${r.day}`} · <span className="font-mono text-xs">{hhmm(r.at)}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                          {pair ? `${Math.round(r.value)}/${Math.round(pair.value)}` : r.value} <span className="font-normal text-dim">{def.unit}</span>
                        </td>
                        <td className="px-3 py-3">
                          <SourceCell r={r} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{st ? <StatusText status={st} /> : <span className="text-dim">No data</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-dim">
              Records are append-only: a correction adds a new entry and never erases the original measurement. Rows tagged “Imported” are daily values from a Samsung Health export (device data; one value per day, see
              the import for how each is derived). For the simulated demo crew, all other values are simulated demo data unless you entered them.
            </p>
          </Section>
        </Reveal>
      </div>
    </>,
  )
}
