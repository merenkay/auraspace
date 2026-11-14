import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import ScienceLibrary from '../components/ScienceLibrary'
import { CountUp, Panel, Reveal } from '../components/ui'
import { CABIN_LIMITS, CAREER_LIMIT_MSV, MISSIONS, formatDelay } from '../data/missions'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'
import { useSerial } from '../hooks/useSerial'
import { radiation } from '../lib/health'
import { useSession } from '../lib/session'

const GRAVITY: Record<string, number> = { iss: 0, 'lunar-transit': 0, 'lunar-base': 0.165, 'mars-transit': 0, 'mars-surface': 0.38 }

export default function Environment() {
  const { mission } = useSession()
  const [profile, setProfile] = useState(mission?.profileId ?? 'mars-transit')
  const [cabin, setCabin] = useState<{ t: number; h: number; live: boolean }>({ t: 22.4, h: 41, live: false })
  const [sim, setSim] = useState(false)
  const [library, setLibrary] = useState(false)
  const day = mission?.day ?? 142
  const rad = radiation(profile, day)
  const prof = MISSIONS.find((m) => m.id === profile)!

  const serial = useSerial((r) => {
    setCabin((c) => ({ t: typeof r.t === 'number' ? r.t : c.t, h: typeof r.h === 'number' ? r.h : c.h, live: true }))
  })

  useEffect(() => {
    if (!sim) return
    const id = setInterval(() => {
      setCabin((c) => ({ t: Math.round((c.t + (Math.random() - 0.5) * 0.3) * 10) / 10, h: Math.round(c.h + (Math.random() - 0.5) * 1.5), live: false }))
    }, 1200)
    return () => clearInterval(id)
  }, [sim])

  const tStatus: Status = cabin.t < CABIN_LIMITS.tempMin || cabin.t > CABIN_LIMITS.tempMax ? 'warn' : 'ok'
  const hStatus: Status = cabin.h < CABIN_LIMITS.rhMin || cabin.h > CABIN_LIMITS.rhMax ? 'warn' : 'ok'
  const cabinCards = [
    { name: 'Temperature', value: cabin.t.toFixed(1), unit: '°C', st: tStatus, limit: '18–27 °C', src: cabin.live ? 'ARDUINO · LIVE' : sim ? 'SIMULATED' : 'SAMPLE' },
    { name: 'Humidity', value: cabin.h.toFixed(0), unit: '%', st: hStatus, limit: '25–75 %', src: cabin.live ? 'ARDUINO · LIVE' : sim ? 'SIMULATED' : 'SAMPLE' },
    { name: 'CO₂', value: '2.4', unit: 'mmHg', st: 'ok' as Status, limit: '≤ 3 mmHg (1-h avg)', src: 'SAMPLE' },
    { name: 'Pressure', value: '101.3', unit: 'kPa', st: 'ok' as Status, limit: '14.7 psia · 21% O₂', src: 'SAMPLE' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {MISSIONS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={profile === m.id}
            onClick={() => setProfile(m.id)}
            className={`relative rounded-full px-4 py-2 text-sm font-semibold transition ${profile === m.id ? 'text-space' : 'text-soft hover:text-ink'}`}
          >
            {profile === m.id && <motion.span layoutId="env-pill" className="absolute inset-0 rounded-full bg-cyan" />}
            <span className="relative">{m.name}</span>
          </button>
        ))}
        <button type="button" onClick={() => setLibrary(true)} className="ml-auto rounded-full border border-line px-4 py-2 text-sm text-soft transition hover:border-cyan">
          📚 Science Library
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Reveal>
          <Panel title="Space radiation" className="h-full">
            <div className="flex flex-wrap items-end gap-8">
              <div>
                <div className="text-sm text-dim">Cumulative dose · day {day}</div>
                <div className="font-display text-6xl font-bold" style={{ color: STATUS_COLOR[rad.status] }}>
                  <CountUp key={profile} value={rad.dose} /> <span className="text-lg font-normal text-dim">mSv</span>
                </div>
              </div>
              <div>
                <div className="text-sm text-dim">Dose rate</div>
                <div className="font-display text-3xl font-bold">{prof.doseRate} <span className="text-sm font-normal text-dim">mSv/day</span></div>
              </div>
            </div>
            <div className="relative mt-6 h-3 rounded-full bg-line">
              <motion.div className="h-3 rounded-full" style={{ background: STATUS_COLOR[rad.status] }} animate={{ width: `${Math.min(100, rad.pct)}%` }} transition={{ duration: 0.9 }} />
              <span className="absolute left-1/2 top-[-4px] h-5 w-0.5 bg-warn" />
              <span className="absolute left-[80%] top-[-4px] h-5 w-0.5 bg-crit" />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-dim">
              <span>0</span>
              <span>50% review</span>
              <span>80% escalate</span>
              <span>{CAREER_LIMIT_MSV} mSv career limit</span>
            </div>
            <p className="mt-4 text-sm text-soft">{prof.doseNote}. About 30% of ISS radiation is neutrons, which CSA’s CANS instrument is built to measure.</p>
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel title="Gravity & distance" className="h-full">
            <div className="space-y-4">
              {[
                { name: 'Earth', g: 1 },
                { name: 'Mars', g: 0.38 },
                { name: 'Moon', g: 0.165 },
                { name: `Now · ${prof.name}`, g: GRAVITY[profile] ?? 0 },
              ].map((g, i) => (
                <div key={g.name}>
                  <div className="flex justify-between text-sm">
                    <span className="text-soft">{g.name}</span>
                    <span className="font-semibold">{g.g === 0 ? 'Microgravity' : `${g.g} g`}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-line">
                    <motion.div
                      className="h-1.5 rounded-full bg-cyan"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${Math.max(1, g.g * 100)}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1, duration: 0.8 }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-3 text-sm">
                <span className="text-soft">One-way delay to Earth</span>
                <span className="font-semibold">{formatDelay(prof.delaySec)} <span className="text-xs text-dim">({prof.delayRange})</span></span>
              </div>
            </div>
          </Panel>
        </Reveal>
      </div>

      <Reveal>
        <Panel
          title="Cabin conditions"
          action={
            <div className="flex gap-2">
              <button type="button" onClick={() => setSim((s) => !s)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${sim ? 'border-cyan bg-cyan/15 text-ice' : 'border-line text-soft'}`}>
                {sim ? '■ Stop simulation' : '▶ Simulate'}
              </button>
              <button
                type="button"
                disabled={!serial.supported}
                title={serial.supported ? 'Connect an Arduino over USB' : 'Web Serial needs Chrome or Edge on a computer'}
                onClick={() => (serial.connected ? serial.disconnect() : serial.connect())}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${serial.connected ? 'border-ok bg-ok/15 text-ok' : 'border-line text-soft'}`}
              >
                {serial.connected ? '● Sensor connected' : '🔌 Connect Arduino'}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {cabinCards.map((c, i) => (
              <motion.div
                key={c.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="rounded-2xl bg-deep/70 p-4"
                style={{ boxShadow: `inset 0 2px 0 ${STATUS_COLOR[c.st]}` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-soft">{c.name}</span>
                  <span className="text-[10px] font-bold tracking-wider text-ice">{c.src}</span>
                </div>
                <div className="mt-2 font-display text-3xl font-bold" style={{ color: STATUS_COLOR[c.st] }}>
                  {c.value} <span className="text-sm font-normal text-dim">{c.unit}</span>
                </div>
                <div className="mt-1 text-xs text-dim">
                  {STATUS_LABEL[c.st]} · limit {c.limit}
                </div>
              </motion.div>
            ))}
          </div>
          {serial.error && <p className="mt-3 text-xs text-crit">Sensor: {serial.error}</p>}
          <p className="mt-3 text-xs text-dim">Limits: NASA-STD-3001 Vol 2 and OCHMO TB-004 (CO₂). Arduino sends lines like {'{"t":23.4,"h":41}'} at 9600 baud.</p>
        </Panel>
      </Reveal>

      {library && <ScienceLibrary onClose={() => setLibrary(false)} />}
    </div>
  )
}
