import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatFlux, formatUtc, REF, type ProtonPoint } from '../../lib/spaceWeather'
import { ChartTooltip, SourceLink, chart } from '../ui'

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16)
const DECADES = [0.01, 0.1, 1, 10, 100, 1000, 10000, 100000]

/** GOES ≥ 10 MeV integral proton flux on a log axis, with NOAA's S1 threshold (10 pfu). Real data only — the drill never draws here. */
export default function ProtonChart({ points }: { points: ProtonPoint[] }) {
  if (points.length < 2) return <p className="text-sm text-dim">No proton data in this copy.</p>
  const max = Math.max(...points.map((p) => p.flux))
  const min = Math.min(...points.map((p) => p.flux))
  const lo = DECADES.filter((d) => d <= min).at(-1) ?? 0.01
  const hi = Math.max(100, DECADES.find((d) => d >= max * 2) ?? 100000)
  const ticks = DECADES.filter((d) => d >= lo && d <= hi)
  return (
    <div>
      <div className="h-56 rounded-xl border border-line bg-deep p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={chart.margin}>
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={hhmm} {...chart.xAxis} />
            <YAxis scale="log" domain={[lo, hi]} ticks={ticks} allowDataOverflow tickFormatter={(v: number) => (v >= 1 ? v.toLocaleString('en-US') : String(v))} {...chart.yAxis} />
            <ReferenceLine y={10} {...chart.refLine('warn')} />
            <Tooltip {...chart.tooltip} content={<ChartTooltip unit="pfu" formatLabel={(l) => `${hhmm(Number(l))} UTC`} formatValue={(v) => formatFlux(Number(v))} />} />
            <Line dataKey="flux" name="≥ 10 MeV protons" {...chart.line} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-sm text-dim">
        ≥ 10 MeV proton flux measured by NOAA's GOES satellite over the 24 h up to {formatUtc(points[points.length - 1].t)}, logarithmic scale. Dashed amber line: 10 pfu, where NOAA starts an S1 radiation storm. Latest
        reading {formatFlux(points[points.length - 1].flux)} pfu.
      </p>
      <SourceLink className="mt-1" href={REF.noaaRadiationStorm.url} org={REF.noaaRadiationStorm.org} title={REF.noaaRadiationStorm.title} />
    </div>
  )
}
