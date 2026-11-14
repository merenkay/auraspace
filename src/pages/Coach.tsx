import { motion } from 'motion/react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { CountUp, Panel, Reveal, Spinner } from '../components/ui'
import { THRESHOLD_SOURCES, vitalFor } from '../data/contexts'
import { STATUS_COLOR } from '../data/vitals'
import { seriesOf } from '../lib/health'
import { useCrewData, useSession } from '../lib/session'

const EQUIPMENT = [
  { id: 'ARED', name: 'Advanced Resistive Exercise Device', spec: 'Up to 600 lb resistance' },
  { id: 'T2', name: 'Treadmill 2 (COLBERT)', spec: 'Up to 12.7 mph · harness load up to 70% body mass' },
  { id: 'CEVIS', name: 'Cycle ergometer', spec: 'Peak 200 W · up to 100 RPM' },
]

export default function Coach({ crewId }: { crewId: number }) {
  const { mission, user } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  if (!ev) return <Spinner />
  const today = mission?.day ?? 142
  const week = seriesOf(data.rows, 'exercise', 7, today)
  const sleep = seriesOf(data.rows, 'sleep', 7, today)
  const sleepAvg = sleep.length ? sleep.reduce((s, p) => s + p.value, 0) / sleep.length : 0
  const water = ev.values.water
  const canEdit = user?.role === 'astronaut'
  const bpWarn = ev.vitalStatus.bp && ev.vitalStatus.bp !== 'ok'
  const ctx = ev.context
  const space = ctx === 'space'
  const exDef = vitalFor('exercise', ctx)
  const waterDef = vitalFor('water', ctx)
  const sleepDef = vitalFor('sleep', ctx)
  const exTarget = space ? 90 : 21
  const waterTarget = space ? 2.5 : 2

  return (
    <div className="space-y-6">
      {space ? (
      <Reveal>
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="label">Today’s approved session</p>
              <h1 className="mt-1 font-display text-3xl font-bold">Resistance + aerobic · 90 min</h1>
              <p className="mt-1 text-sm text-dim">Prescription approved by the flight surgeon · AURA never raises loads on its own</p>
            </div>
            <span className="rounded-full bg-ok/15 px-3 py-1 text-xs font-bold text-ok">✓ Restrictions checked</span>
          </div>
          {bpWarn && (
            <p className="mt-4 rounded-2xl border border-warn/60 bg-warn/10 p-3 text-sm text-warn">
              Blood pressure is above range today — re-measure before the session. Loads stay as prescribed.
            </p>
          )}
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              { eq: 'CEVIS', name: 'Aerobic intervals', min: 30 },
              { eq: 'ARED', name: 'Lower-body resistance', min: 45 },
              { eq: 'T2', name: 'Loaded running', min: 15 },
            ].map((b, i) => (
              <motion.div
                key={b.eq}
                initial={{ opacity: 0, x: 40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-4 rounded-2xl bg-deep/70 p-4"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel2 font-display font-bold text-ice">{b.eq}</div>
                <div className="flex-1">
                  <div className="font-semibold">{b.name}</div>
                  <div className="text-sm text-dim">{b.min} min</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>
      </Reveal>
      ) : (
        <Reveal>
          <Panel>
            <p className="label">Your activity goal</p>
            <h1 className="mt-1 font-display text-3xl font-bold">150 minutes a week</h1>
            <p className="mt-2 max-w-2xl text-sm text-soft">{THRESHOLD_SOURCES.activity.text} {ctx === 'home' ? THRESHOLD_SOURCES.activityOlderBalance.text : ''}</p>
            <a href={THRESHOLD_SOURCES.activity.source.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-cyan underline">
              Source: {THRESHOLD_SOURCES.activity.source.org} — {THRESHOLD_SOURCES.activity.source.title}
            </a>
          </Panel>
        </Reveal>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Reveal delay={0.05}>
          <Panel title="Exercise · last 7 days" className="h-full">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="day" tick={{ fill: '#91A9BD', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(d) => `D${d}`} />
                  <Tooltip cursor={{ fill: '#162D42' }} contentStyle={{ background: '#07111F', border: '1px solid #1E3A55', borderRadius: 12 }} labelFormatter={(d) => `Day ${d}`} />
                  <ReferenceLine y={exTarget} stroke="#35D399" strokeDasharray="4 4" />
                  <Bar dataKey="value" name="Minutes" radius={[8, 8, 2, 2]} animationDuration={900}>
                    {week.map((w) => (
                      <Cell key={w.day} fill={STATUS_COLOR[exDef.evaluate({ ...ev.values, exercise: w.value })]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-dim">{space ? 'Target 90 min/day. NASA reports ISS crews training 1.5–2 h a day.' : `Target about ${exTarget} min/day (≈ 150 min per week, WHO).`}</p>
          </Panel>
        </Reveal>

        <Reveal delay={0.1}>
          <Panel title="Sleep & recovery" className="h-full">
            <div className="font-display text-5xl font-bold" style={{ color: STATUS_COLOR[sleepDef.evaluate({ ...ev.values, sleep: sleepAvg })] }}>
              <CountUp value={sleepAvg} decimals={1} /> <span className="text-base font-normal text-dim">h / night</span>
            </div>
            <p className="mt-2 text-sm text-soft">{space ? '7-night average. NASA recommends 7–9 h; astronauts average about 6 h in flight.' : ctx === 'home' ? `7-night average. ${THRESHOLD_SOURCES.sleepOlder.text}` : '7-night average. Fixed bedtimes helped Concordia crews sleep through the polar night (ESA).'}</p>
          </Panel>
        </Reveal>

        <Reveal delay={0.15}>
          <Panel title="Hydration" className="h-full">
            <div className="font-display text-5xl font-bold" style={{ color: STATUS_COLOR[waterDef.evaluate(ev.values)] }}>
              {water.toFixed(1)} <span className="text-base font-normal text-dim">of {waterTarget} L</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-line">
              <motion.div
                className="h-2 rounded-full"
                style={{ background: STATUS_COLOR[waterDef.evaluate(ev.values)] }}
                animate={{ width: `${Math.min(100, (water / waterTarget) * 100)}%` }}
              />
            </div>
            {canEdit && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => void data.add({ water: Math.round((water + 0.25) * 10) / 10 }, 'manual', 'Drink log')}
                className="mt-4 w-full rounded-2xl border border-cyan/60 py-2.5 font-semibold text-ice transition hover:bg-cyan/10"
              >
                + 250 mL
              </motion.button>
            )}
            <p className="mt-2 text-xs text-dim">{space ? 'Minimum 2.5 L/day per crew member (NASA OCHMO TB-027).' : waterDef.source}</p>
          </Panel>
        </Reveal>
      </div>

      {space && (
      <Reveal>
        <h2 className="label mb-3">Onboard equipment</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {EQUIPMENT.map((q, i) => (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ y: -4 }}
              className="glass rounded-3xl p-5"
            >
              <div className="font-display text-2xl font-bold">{q.id}</div>
              <div className="text-sm text-dim">{q.name}</div>
              <div className="mt-3 text-sm text-soft">{q.spec}</div>
            </motion.div>
          ))}
        </div>
        <a href="https://www.nasa.gov/ochmo-tb-031-exercise-overview-2/" target="_blank" rel="noreferrer" className="mt-2 block text-xs text-cyan underline">
          Source: NASA OCHMO TB-031 — Exercise overview
        </a>
      </Reveal>
      )}
    </div>
  )
}
