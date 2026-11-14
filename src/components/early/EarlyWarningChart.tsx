import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricAnalysis } from '../../lib/earlyWarning'
import { decimalsOf } from '../../lib/earlyWarning/metrics'
import { dateOfDay, fmtShort } from '../../lib/trend'
import { ChartTooltip, chart } from '../ui'

type Row = { day: number; value?: number; fit?: number; proj?: number }

/** Evidence chart: daily readings, the person's usual range (baseline band), trend line and projection. */
export default function EarlyWarningChart({ a, today, dateMode }: { a: MetricAnalysis; today: number; dateMode: boolean }) {
  const dec = decimalsOf(a.metric.field)
  const byDay = new Map<number, Row>()
  const put = (day: number, patch: Partial<Row>) => byDay.set(day, { ...(byDay.get(day) ?? { day }), ...patch })
  for (const p of [...(a.baseline?.points ?? []), ...a.recent]) put(p.day, { value: p.value })
  const showTrend = a.trend && a.rules.some((r) => r.family === 'trend')
  if (showTrend && a.trend && a.recent.length) {
    const d0 = a.recent[0].day
    put(d0, { fit: +(a.trend.intercept + a.trend.slope * d0).toFixed(3) })
    put(today, { fit: +(a.trend.intercept + a.trend.slope * today).toFixed(3) })
    if (a.projection) {
      put(today, { proj: +(a.trend.intercept + a.trend.slope * today).toFixed(3) })
      const end = Math.round(a.projection.atDay * 10) / 10
      put(end, { proj: a.projection.target })
    }
  }
  const rows = [...byDay.values()].sort((x, y) => x.day - y.day)
  const b = a.baseline
  const label = (d: number) => (dateMode ? fmtShort(dateOfDay(Math.round(d), today)) : `D${Math.round(d)}`)
  const lineStatus = a.projection ? (a.projection.line === 'urgent' ? 'crit' : 'warn') : null
  const unit = a.metric.unit

  return (
    <figure className="mt-3">
      <div className="h-44 rounded-xl border border-line bg-deep p-2 sm:h-48 sm:p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={chart.margin}>
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={label} {...chart.xAxis} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(dec)} {...chart.yAxis} />
            {b && <ReferenceArea y1={b.median - 2 * b.spread} y2={b.median + 2 * b.spread} {...chart.band('ok')} />}
            {b && <ReferenceLine y={b.median} {...chart.refLine()} />}
            {a.projection && lineStatus && <ReferenceLine y={a.projection.target} {...chart.refLine(lineStatus)} />}
            <Tooltip
              {...chart.tooltip}
              content={<ChartTooltip unit={unit} formatLabel={(l) => label(Number(l))} formatValue={(v) => (typeof v === 'number' ? v.toFixed(dec) : '—')} />}
            />
            <Line dataKey="value" name="Reading" {...chart.line} connectNulls dot={{ r: 2.5, fill: 'var(--color-ink)', strokeWidth: 0 }} />
            {showTrend && <Line dataKey="fit" name="Trend" {...chart.line} stroke={chart.series[1]} dot={false} activeDot={false} connectNulls />}
            {a.projection && <Line dataKey="proj" name="Projection" {...chart.line} stroke={chart.series[1]} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-dim">
        Dots: daily readings ({unit}).{b ? ' Green band: usual range (baseline ± 2 usual spreads); dashed grey: baseline median.' : ' No baseline yet.'}
        {showTrend ? ' Grey line: trend (Theil–Sen).' : ''}
        {a.projection ? ` Dashed grey: projection to the ${a.projection.line} line (dashed ${lineStatus === 'crit' ? 'red' : 'amber'}) — an estimate.` : ''}
      </figcaption>
    </figure>
  )
}
