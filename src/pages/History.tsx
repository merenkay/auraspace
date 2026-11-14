import { ChartLine, FlaskConical, Upload, Watch } from 'lucide-react'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, ChartTooltip, EmptyState, Notice, PageHeader, Reveal, Section, Spinner, StatusText, Tabs, chart, cx } from '../components/ui'
import { VITAL_BY_KEY, type FieldId, type VitalKey } from '../data/vitals'
import { baselineOf } from '../lib/health'
import { isImportedDevice, isSyntheticDevice } from '../lib/samsungHealth'
import { useCrewData, useSession } from '../lib/session'
import type { Measurement } from '../lib/types'

// The wizard (and its parser) loads only when someone opens it.
const SamsungImportWizard = lazy(() => import('../components/import/SamsungImportWizard'))

/** Calendar date of a tracking day: today minus the days in between (days can be <= 0 for imported history). */
function dateOfDay(day: number, today: number) {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - (today - day))
  return d
}
const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtLong = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
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
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone={isSyntheticDevice(r.device) ? 'warn' : 'accent'} icon={isSyntheticDevice(r.device) ? FlaskConical : Watch}>
          {isSyntheticDevice(r.device) ? 'Imported · SYNTHETIC' : 'Imported · device'}
        </Badge>
        <span className="hidden text-dim sm:inline">{isSyntheticDevice(r.device) ? 'Samsung Health sample' : r.device}</span>
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

  const header = <PageHeader title="History" description="Every measurement in this record, with where it came from." actions={importButton} className="mb-6" />

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
  if ((data.loading && !data.rows.length) || (data.rows.length && !ev)) return shell(<Spinner />)
  if (!data.rows.length || !ev || !ev.vitals.length) {
    return shell(
      <>
        {header}
        <EmptyState
          icon={ChartLine}
          title="No measurements yet"
          description={canImport ? 'Log a reading on the Overview, or bring in your Galaxy Watch history from a Samsung Health export.' : 'Nothing has been recorded for this person yet.'}
          action={importButton}
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
  const recent = data.rows.filter((r) => r.metric === def.primary).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)
  const pairOf = (r: Measurement) => (second ? data.rows.find((x) => x.metric === second && x.at === r.at && x.device === r.device) : undefined)
  const importedDays = series.filter((p) => p.imported).length
  const importedRange = imported.length ? [Math.min(...imported.map((r) => r.day)), Math.max(...imported.map((r) => r.day))] : null
  const syntheticImport = imported.some((r) => isSyntheticDevice(r.device))

  return shell(
    <div className="space-y-8">
      {header}

      {importedRange && (
        <Notice
          tone="info"
          title={syntheticImport ? 'Includes a SYNTHETIC Samsung Health sample' : 'Includes data imported from Samsung Health'}
          action={
            canImport ? (
              <Button size="sm" variant="quiet" onClick={openImport}>
                Import again
              </Button>
            ) : undefined
          }
        >
          {imported.length} daily device value{imported.length === 1 ? '' : 's'} from {fmtShort(dateOfDay(importedRange[0], today))} to {fmtShort(dateOfDay(importedRange[1], today))}, tagged “Imported” below.
          {syntheticImport && ' The sample values are invented and are labelled SYNTHETIC.'}
        </Notice>
      )}

      <Tabs<VitalKey> label="Measurement" value={def.key} onChange={setKey} options={available.map((d) => ({ value: d.key, label: d.label, status: ev.vitalStatus[d.key] }))} />

      <Reveal>
        <Section
          title={`${def.label}${second ? ' (upper / lower)' : ''}`}
          description={`${mission?.context === 'space' && !dateMode ? 'Whole mission' : 'Since your first reading'} · ${def.unit}${importedDays ? ` · ${importedDays} imported day${importedDays === 1 ? '' : 's'} marked with a ring` : ''}`}
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={def.key} data={series} margin={chart.margin}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} {...chart.xAxis} tickFormatter={dayLabel} />
                <YAxis {...chart.yAxis} domain={['auto', 'auto']} />
                {base != null && <ReferenceLine y={base} {...chart.refLine()} label={{ value: 'baseline', fill: 'var(--color-dim)', fontSize: 11, position: 'insideTopLeft' }} />}
                <Tooltip
                  {...chart.tooltip}
                  content={
                    <ChartTooltip
                      unit={def.unit}
                      formatLabel={(d) => (dateMode ? fmtLong(dateOfDay(Number(d), today)) : `Mission day ${d} · ${fmtShort(dateOfDay(Number(d), today))}`)}
                    />
                  }
                />
                <Line
                  dataKey="value"
                  name={second ? 'Upper' : def.label}
                  {...chart.line}
                  dot={(p: { cx?: number; cy?: number; index?: number; payload?: Point }) =>
                    p.payload?.imported && p.cx != null && p.cy != null ? (
                      <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={3} fill="var(--color-space)" stroke="var(--color-accent)" strokeWidth={1.5} />
                    ) : (
                      <g key={`d${p.index}`} />
                    )
                  }
                />
                {second && <Line dataKey="value2" name="Lower" {...chart.line} stroke={chart.series[1]} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-dim">
            {base != null && 'Dashed line: your baseline, the average of your first 14 days with this measurement. '}
            {dateMode ? 'Dates are calendar days.' : 'D = mission day.'}
          </p>
        </Section>
      </Reveal>

      <Reveal delay={0.05}>
        <Section title="Records" description="Newest first">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="text-left">
                  <th className="label px-2 py-2 font-medium">When</th>
                  <th className="label px-2 py-2 font-medium">Value</th>
                  <th className="label px-2 py-2 font-medium">Source</th>
                  <th className="label px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const pair = pairOf(r)
                  const st = def.fields.length === 1 ? def.evaluate({ ...ev.values, [def.primary]: r.value }) : pair ? def.evaluate({ ...ev.values, [def.primary]: r.value, [second!]: pair.value }) : null
                  return (
                    <tr key={r.id} className={cx('border-t border-line', isImportedDevice(r.device) && 'bg-panel/40')}>
                      <td className="whitespace-nowrap px-2 py-2.5 text-soft">
                        {dateMode ? fmtShort(dateOfDay(r.day, today)) : `Day ${r.day}`} · {hhmm(r.at)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 font-medium text-ink">
                        {pair ? `${Math.round(r.value)}/${Math.round(pair.value)}` : r.value} <span className="font-normal text-dim">{def.unit}</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <SourceCell r={r} />
                      </td>
                      <td className="px-2 py-2.5">{st ? <StatusText status={st} /> : <span className="text-dim">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-dim">
            Records are append-only: a correction adds a new entry and never erases the original measurement. Rows tagged “Imported” are daily values from a Samsung Health export (device data; one value per day, see
            the import for how each is derived). For the simulated demo crew, all other values are simulated demo data unless you entered them.
          </p>
        </Section>
      </Reveal>
    </div>,
  )
}
