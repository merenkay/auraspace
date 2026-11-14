import { motion } from 'motion/react'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Panel, Reveal, Spinner } from '../components/ui'
import { STATUS_COLOR, VITALS, VITAL_BY_KEY, type VitalKey } from '../data/vitals'
import { baselineOf, seriesOf } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'

export default function History({ crewId }: { crewId: number }) {
  const { mission } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const [key, setKey] = useState<VitalKey>('bp')
  if (!ev) return <Spinner />
  const available = VITALS.filter((d) => ev.vitalStatus[d.key])
  const def = VITAL_BY_KEY[available.some((d) => d.key === key) ? key : available[0].key]
  const today = mission?.day ?? 142
  const series = seriesOf(data.rows, def.primary, today, today)
  const base = baselineOf(data.rows, def.primary)
  const recent = [...data.rows].filter((r) => r.metric === def.primary).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {available.map((d) => (
          <button
            key={d.key}
            type="button"
            aria-pressed={def.key === d.key}
            onClick={() => setKey(d.key)}
            className={`relative rounded-full px-4 py-2 text-sm font-semibold transition ${def.key === d.key ? 'text-space' : 'text-soft hover:text-ink'}`}
          >
            {def.key === d.key && <motion.span layoutId="hist-pill" className="absolute inset-0 rounded-full bg-cyan" />}
            <span className="relative">{d.label}</span>
          </button>
        ))}
      </div>

      <Reveal>
        <Panel title={`${def.label} · whole mission`}>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key={def.key} data={series} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#53D7FF" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#53D7FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1E3A55" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#91A9BD', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(d) => `D${d}`} minTickGap={30} />
                <YAxis tick={{ fill: '#91A9BD', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                {base != null && <ReferenceLine y={base} stroke="#91A9BD" strokeDasharray="5 5" label={{ value: 'baseline', fill: '#91A9BD', fontSize: 11, position: 'insideTopLeft' }} />}
                <Tooltip contentStyle={{ background: '#07111F', border: '1px solid #1E3A55', borderRadius: 12 }} labelFormatter={(d) => `Mission day ${d}`} />
                <Area type="monotone" dataKey="value" name={def.label} stroke="#53D7FF" strokeWidth={2} fill="url(#histFill)" animationDuration={1200} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </Reveal>

      <Reveal delay={0.05}>
        <Panel title="Records">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-widest text-dim">
                  <th className="px-3 py-2 font-semibold">WHEN</th>
                  <th className="px-3 py-2 font-semibold">VALUE</th>
                  <th className="px-3 py-2 font-semibold">SOURCE</th>
                  <th className="px-3 py-2 font-semibold">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => {
                  const st = def.fields.length === 1 ? def.evaluate({ ...ev.values, [def.primary]: r.value }) : null
                  return (
                    <motion.tr
                      key={r.id}
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.03 }}
                      className="border-t border-line/70"
                    >
                      <td className="px-3 py-2.5 text-soft">
                        Day {r.day} · {new Date(r.at).toTimeString().slice(0, 5)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold">
                        {r.value} {def.unit}
                      </td>
                      <td className="px-3 py-2.5 text-dim">{r.device}</td>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{ color: st ? STATUS_COLOR[st] : '#91A9BD' }}>
                        {st ? st.toUpperCase().replace('CRIT', 'URGENT').replace('WARN', 'ATTENTION').replace('OK', 'NORMAL') : '—'}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-dim">Records are append-only: a correction adds a new entry and never erases the original measurement. All values are simulated demo data unless marked as a device reading you entered.</p>
        </Panel>
      </Reveal>
    </div>
  )
}
