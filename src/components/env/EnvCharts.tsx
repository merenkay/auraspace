import { memo, useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CABIN_LIMITS } from '../../data/missions'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO, rowRatio, type EnvRow } from '../../lib/envStation'
import { STATUS_COLOR } from '../../data/vitals'
import { ChartTooltip, chart, Disclosure } from '../ui'
import { clockTime, fmt } from './parts'
import type { ChartPoint } from './useEnvStation'

type Key = 't' | 'h' | 'g'
type Ref = { y: number; label: string; tone: 'dim' | 'warn' | 'crit' }
/** `domain` turns the data's min/max into the range the axis must at least show (e.g. always include the limits). */
type Spec = { key: Key; title: string; unit: string; digits: number; refs: Ref[]; domain: [(v: number) => number, (v: number) => number] }

/** Round axis range + evenly spaced "nice" ticks (1, 2, 2.5, 5 × 10^n). */
function niceScale(lo: number, hi: number, count = 4): { domain: [number, number]; ticks: number[] } {
  if (!(hi > lo)) hi = lo + 1
  const raw = (hi - lo) / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { domain: [a, b], ticks }
}

function specs(gasUnit: 'ratio' | 'raw'): Spec[] {
  return [
    {
      key: 't',
      title: 'Temperature',
      unit: '°C',
      digits: 1,
      refs: [
        { y: CABIN_LIMITS.tempMin, label: `${CABIN_LIMITS.tempMin} °C`, tone: 'dim' },
        { y: CABIN_LIMITS.tempMax, label: `${CABIN_LIMITS.tempMax} °C`, tone: 'dim' },
      ],
      domain: [(min) => Math.min(min, CABIN_LIMITS.tempMin) - 1, (max) => Math.max(max, CABIN_LIMITS.tempMax) + 1],
    },
    {
      key: 'h',
      title: 'Humidity',
      unit: '%',
      digits: 0,
      refs: [
        { y: CABIN_LIMITS.rhMin, label: `${CABIN_LIMITS.rhMin} %`, tone: 'dim' },
        { y: CABIN_LIMITS.rhMax, label: `${CABIN_LIMITS.rhMax} %`, tone: 'dim' },
      ],
      domain: [(min) => Math.max(0, Math.min(min, CABIN_LIMITS.rhMin) - 5), (max) => Math.min(100, Math.max(max, CABIN_LIMITS.rhMax) + 5)],
    },
    gasUnit === 'ratio'
      ? {
          key: 'g',
          title: 'Flammable gas',
          unit: '× baseline',
          digits: 2,
          refs: [
            { y: GAS_WARN_RATIO, label: `attention ${GAS_WARN_RATIO}×`, tone: 'warn' },
            { y: GAS_ALARM_RATIO, label: `alarm ${GAS_ALARM_RATIO}×`, tone: 'crit' },
          ],
          domain: [() => 0, (max) => Math.max(max, GAS_ALARM_RATIO) * 1.15],
        }
      : { key: 'g', title: 'Flammable gas', unit: 'raw (no baseline)', digits: 0, refs: [], domain: [() => 0, (max) => Math.max(100, max * 1.3)] },
  ]
}

const MiniChart = memo(function MiniChart({ spec, data, from, to, seconds }: { spec: Spec; data: ChartPoint[]; from: number; to: number; seconds: boolean }) {
  const points = data.filter((p) => p[spec.key] != null)
  const last = points[points.length - 1]
  const values = points.map((p) => p[spec.key] as number)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const scale = niceScale(spec.domain[0](lo), spec.domain[1](hi))
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-ink">
          {spec.title} <span className="font-normal text-dim">· {spec.unit}</span>
        </span>
        <span className="font-mono text-xs text-dim">last {last ? fmt(last[spec.key], spec.digits) : '—'}</span>
      </figcaption>
      <div className="h-[168px] rounded-xl border border-line bg-deep p-3">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-dim">No data in this time window</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ ...chart.margin, right: 30 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="x" type="number" scale="time" domain={[from, to]} allowDataOverflow tickFormatter={(v: number) => clockTime(v, seconds)} {...chart.xAxis} />
              <YAxis domain={scale.domain} ticks={scale.ticks} allowDataOverflow {...chart.yAxis} />
              {spec.refs.map((r) => (
                <ReferenceLine
                  key={r.label}
                  y={r.y}
                  {...chart.refLine(r.tone === 'dim' ? undefined : r.tone)}
                  label={{ value: r.label, position: 'insideTopLeft', fill: r.tone === 'dim' ? 'var(--color-dim)' : STATUS_COLOR[r.tone], fontSize: 12 }}
                />
              ))}
              <Tooltip
                {...chart.tooltip}
                content={<ChartTooltip unit={spec.unit} formatLabel={(l) => clockTime(Number(l), true)} formatValue={(v) => (typeof v === 'number' ? v.toFixed(spec.digits) : '—')} />}
              />
              <Line dataKey={spec.key} {...chart.line} dot={points.length < 15 ? { r: 2.5, fill: 'var(--color-ink)', strokeWidth: 0 } : false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  )
})

/** Three small multiples on a shared time window (never one chart with two y-axes). Gaps = no data. */
/** Memoised: the station ticks every second, but a chart redraws only when its data or window changes. */
export const EnvCharts = memo(function EnvCharts({ data, from, to, gasUnit, seconds }: { data: ChartPoint[]; from: number; to: number; gasUnit: 'ratio' | 'raw'; seconds: boolean }) {
  const list = useMemo(() => specs(gasUnit), [gasUnit])
  // Nothing at all in the window: one line instead of three empty plot areas.
  if (!data.some((p) => p.t != null || p.h != null || p.g != null))
    return <p className="flex h-24 items-center justify-center rounded-xl border border-dashed border-line text-sm text-dim">No data in this time window</p>
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {list.map((s) => (
          <MiniChart key={s.key} spec={s} data={data} from={from} to={to} seconds={seconds} />
        ))}
      </div>
      <Disclosure size="row" id="env.chart-key" title="How to read these charts" className="mt-1">
      <p className="text-sm text-dim">
        Dashed grey lines: the normal band for temperature and humidity.
        {gasUnit === 'ratio' ? ' Dashed amber and red lines: the attention and alarm levels for gas (AURA demo thresholds).' : ' The gas chart shows raw values until a clean-air baseline is set.'} A gap in a line means no data.
      </p>
      </Disclosure>
    </div>
  )
})

/** Table view of stored rows (newest first) so no value is reachable only by hovering a chart. */
export function EnvTable({ rows }: { rows: EnvRow[] }) {
  const shown = [...rows].reverse().slice(0, 30)
  if (!shown.length) return <p className="text-sm text-dim">No stored readings in this time window.</p>
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="sr-only">Stored sensor readings, newest first</caption>
        <thead className="sticky top-0 bg-deep text-dim">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Time</th>
            <th scope="col" className="px-3 py-2 font-medium">Temp °C</th>
            <th scope="col" className="px-3 py-2 font-medium">Humidity %</th>
            <th scope="col" className="px-3 py-2 font-medium">Gas raw (mean / peak)</th>
            <th scope="col" className="px-3 py-2 font-medium">Peak ÷ baseline</th>
            <th scope="col" className="px-3 py-2 font-medium">Samples</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.at} className="border-t border-line text-soft">
              <td className="px-3 py-2">{clockTime(Date.parse(r.at), true)}</td>
              <td className="px-3 py-2">{fmt(r.t, 1)}</td>
              <td className="px-3 py-2">{fmt(r.h, 0)}</td>
              <td className="px-3 py-2">
                {fmt(r.gas, 0)} / {fmt(r.gasMax, 0)}
              </td>
              <td className="px-3 py-2">{rowRatio(r) != null ? `${fmt(rowRatio(r), 2)}×` : 'no baseline'}</td>
              <td className="px-3 py-2">{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
