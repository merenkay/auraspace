import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CABIN_LIMITS } from '../../data/missions'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO, rowRatio, type EnvRow } from '../../lib/envStation'
import { clockTime, fmt, themeColor } from './parts'
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

function MiniChart({ spec, data, from, to, seconds }: { spec: Spec; data: ChartPoint[]; from: number; to: number; seconds: boolean }) {
  const line = themeColor('--color-cyan', '#53d7ff')
  const grid = themeColor('--color-line', '#1e3a55')
  const dim = themeColor('--color-dim', '#91a9bd')
  const tone = { dim, warn: themeColor('--color-warn', '#f6bd60'), crit: themeColor('--color-crit', '#f06464') }
  const points = data.filter((p) => p[spec.key] != null)
  const last = points[points.length - 1]
  const values = points.map((p) => p[spec.key] as number)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const scale = niceScale(spec.domain[0](lo), spec.domain[1](hi))
  return (
    <figure className="min-w-0 rounded-2xl border border-line bg-deep/40 p-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-soft">
          {spec.title} <span className="font-normal text-dim">· {spec.unit}</span>
        </span>
        <span className="text-dim">last {last ? fmt(last[spec.key], spec.digits) : '—'}</span>
      </figcaption>
      {points.length === 0 ? (
        <div className="flex h-[150px] items-center justify-center text-xs text-dim">No data in this time window</div>
      ) : (
        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={grid} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                scale="time"
                domain={[from, to]}
                allowDataOverflow
                tickFormatter={(v: number) => clockTime(v, seconds)}
                tick={{ fill: dim, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: grid }}
                minTickGap={36}
              />
              <YAxis domain={scale.domain} ticks={scale.ticks} allowDataOverflow tick={{ fill: dim, fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              {spec.refs.map((r) => (
                <ReferenceLine
                  key={r.label}
                  y={r.y}
                  stroke={tone[r.tone]}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{ value: r.label, position: 'insideTopLeft', fill: tone[r.tone], fontSize: 10 }}
                />
              ))}
              <Tooltip
                cursor={{ stroke: dim, strokeWidth: 1 }}
                isAnimationActive={false}
                content={(props) => {
                  const p = props.payload?.[0]
                  if (!props.active || !p || typeof p.value !== 'number') return null
                  return (
                    <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                      <div className="text-dim">{clockTime(Number(props.label), true)}</div>
                      <div className="font-semibold text-ink">
                        {p.value.toFixed(spec.digits)} {spec.unit}
                      </div>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey={spec.key}
                stroke={line}
                strokeWidth={2}
                dot={points.length < 3 ? { r: 3, fill: line, strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: line, stroke: grid, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}

/** Three small multiples on a shared time window (never one chart with two y-axes). Gaps = no data. */
export function EnvCharts({ data, from, to, gasUnit, seconds }: { data: ChartPoint[]; from: number; to: number; gasUnit: 'ratio' | 'raw'; seconds: boolean }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {specs(gasUnit).map((s) => (
        <MiniChart key={s.key} spec={s} data={data} from={from} to={to} seconds={seconds} />
      ))}
    </div>
  )
}

/** Table view of stored rows (newest first) so no value is reachable only by hovering a chart. */
export function EnvTable({ rows }: { rows: EnvRow[] }) {
  const shown = [...rows].reverse().slice(0, 30)
  if (!shown.length) return <p className="text-sm text-dim">No stored readings in this time window.</p>
  return (
    <div className="max-h-80 overflow-auto rounded-2xl border border-line">
      <table className="w-full min-w-[520px] text-left text-xs">
        <caption className="sr-only">Stored sensor readings, newest first</caption>
        <thead className="sticky top-0 bg-deep text-dim">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Time</th>
            <th scope="col" className="px-3 py-2 font-semibold">Temp °C</th>
            <th scope="col" className="px-3 py-2 font-semibold">Humidity %</th>
            <th scope="col" className="px-3 py-2 font-semibold">Gas raw (mean / peak)</th>
            <th scope="col" className="px-3 py-2 font-semibold">Peak ÷ baseline</th>
            <th scope="col" className="px-3 py-2 font-semibold">Samples</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.at} className="border-t border-line text-soft">
              <td className="px-3 py-1.5">{clockTime(Date.parse(r.at), true)}</td>
              <td className="px-3 py-1.5">{fmt(r.t, 1)}</td>
              <td className="px-3 py-1.5">{fmt(r.h, 0)}</td>
              <td className="px-3 py-1.5">
                {fmt(r.gas, 0)} / {fmt(r.gasMax, 0)}
              </td>
              <td className="px-3 py-1.5">{rowRatio(r) != null ? `${fmt(rowRatio(r), 2)}×` : 'no baseline'}</td>
              <td className="px-3 py-1.5">{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
