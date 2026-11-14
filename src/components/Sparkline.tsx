import { memo } from 'react'
import { Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { DUR } from './ui'

/** A trend at a glance: straight segments between real measurements, a dot on the latest one. No fill, no smoothing. */
function SparklineImpl({ data, color, height = 44 }: { data: { day: number; value: number }[]; color: string; height?: number }) {
  if (data.length < 2)
    return (
      <div style={{ height }} className="flex items-end text-xs text-dim">
        Not enough data for a trend
      </div>
    )
  const last = data[data.length - 1]
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 1 }}>
          <XAxis hide type="number" dataKey="day" domain={['dataMin', 'dataMax']} />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="linear" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} activeDot={false} animationDuration={DUR.draw * 1000} animationEasing="ease-out" />
          <ReferenceDot x={last.day} y={last.value} r={2.5} fill={color} stroke="none" ifOverflow="visible" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Memoised: a page re-render does not redraw every trend unless its data changed. */
const Sparkline = memo(SparklineImpl)
export default Sparkline
export { Sparkline }
