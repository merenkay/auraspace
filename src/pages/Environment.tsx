import { motion } from 'motion/react'
import { useState } from 'react'
import EnvStation from '../components/env/EnvStation'
import ScienceLibrary from '../components/ScienceLibrary'
import { CountUp, Panel, Reveal } from '../components/ui'
import { CAREER_LIMIT_MSV, MISSIONS, formatDelay } from '../data/missions'
import { STATUS_COLOR } from '../data/vitals'
import { radiation } from '../lib/health'
import { useSession } from '../lib/session'

const GRAVITY: Record<string, number> = { iss: 0, 'lunar-transit': 0, 'lunar-base': 0.165, 'mars-transit': 0, 'mars-surface': 0.38 }

// Reference values for the cabin that AURA's sensor does NOT measure (shown as SAMPLE, sources in src/data/kb/environment.json).
const CABIN_SAMPLES = [
  { name: 'CO₂', value: '2.4', unit: 'mmHg', limit: 'limit ≤ 3 mmHg (1-h average, NASA OCHMO TB-004)' },
  { name: 'Pressure', value: '101.3', unit: 'kPa', limit: 'ISS norm 14.7 psia · 21 % O₂ (NASA OCHMO TB-003)' },
]

export default function Environment() {
  const { mission } = useSession()
  const ctx = mission?.context ?? 'space'
  const space = ctx === 'space'
  const [profile, setProfile] = useState(space ? (mission?.profileId ?? 'mars-transit') : 'mars-transit')
  const [library, setLibrary] = useState(false)
  const day = mission?.day ?? 142
  const rad = radiation(profile, day)
  const prof = MISSIONS.find((m) => m.id === profile) ?? MISSIONS[3]
  const stationTitle = space ? 'Cabin sensor station' : ctx === 'polar' ? 'Station sensor' : 'Home sensor station'

  return (
    <div className="space-y-6">
      {/* The live sensor station comes first in every context: it is the only part with real-time data. */}
      <EnvStation context={ctx} title={stationTitle} />

      {space && (
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
      )}

      {space && (
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
                  <div className="font-display text-3xl font-bold">
                    {prof.doseRate} <span className="text-sm font-normal text-dim">mSv/day</span>
                  </div>
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
                  <span className="font-semibold">
                    {formatDelay(prof.delaySec)} <span className="text-xs text-dim">({prof.delayRange})</span>
                  </span>
                </div>
              </div>
            </Panel>
          </Reveal>
        </div>
      )}

      {space && (
        <Reveal>
          <Panel title="Other cabin values · sample">
            <div className="grid gap-4 sm:grid-cols-2">
              {CABIN_SAMPLES.map((c) => (
                <div key={c.name} className="rounded-2xl border border-line bg-deep/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-soft">{c.name}</span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold tracking-wider text-dim">SAMPLE · NOT MEASURED</span>
                  </div>
                  <div className="mt-2 font-display text-3xl font-bold text-ink">
                    {c.value} <span className="text-sm font-normal text-dim">{c.unit}</span>
                  </div>
                  <div className="mt-1 text-xs text-dim">{c.limit}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-dim">AURA’s sensor kit has no CO₂ or pressure sensor; these are typical reference values, not readings.</p>
          </Panel>
        </Reveal>
      )}

      {library && <ScienceLibrary onClose={() => setLibrary(false)} />}
    </div>
  )
}
