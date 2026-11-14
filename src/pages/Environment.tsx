import { Library } from 'lucide-react'
import { useState } from 'react'
import EnvStation from '../components/env/EnvStation'
import ScienceLibrary from '../components/ScienceLibrary'
import { Badge, Button, Card, List, Meter, Metric, PageHeader, Reveal, Section, Tabs } from '../components/ui'
import { CAREER_LIMIT_MSV, MISSIONS, formatDelay } from '../data/missions'
import { radiation } from '../lib/health'
import { useSession } from '../lib/session'

const GRAVITY: Record<string, number> = { iss: 0, 'lunar-transit': 0, 'lunar-base': 0.165, 'mars-transit': 0, 'mars-surface': 0.38 }

// Reference values for the cabin that AURA's sensor does NOT measure (shown as SAMPLE, sources in src/data/kb/environment.json).
const CABIN_SAMPLES = [
  { name: 'CO₂', value: '2.4', unit: 'mmHg', limit: 'limit ≤ 3 mmHg (1-h average, NASA OCHMO TB-004)' },
  { name: 'Pressure', value: '101.3', unit: 'kPa', limit: 'ISS norm 14.7 psia · 21 % O₂ (NASA OCHMO TB-003)' },
]

const DESCRIPTION = {
  space: 'Live cabin sensors first, then the radiation dose, gravity and signal delay of your mission profile.',
  polar: 'Live readings from your station sensor.',
  home: 'Live readings from your home sensor.',
}

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
  const radStatus = rad.status === 'ok' ? undefined : rad.status
  const gravities = [
    { name: 'Earth', g: 1, now: false },
    { name: 'Mars', g: 0.38, now: false },
    { name: 'Moon', g: 0.165, now: false },
    { name: `Now · ${prof.name}`, g: GRAVITY[profile] ?? 0, now: true },
  ]

  return (
    <div>
      <PageHeader
        title="Environment"
        description={DESCRIPTION[ctx]}
        actions={
          space ? (
            <Button icon={Library} onClick={() => setLibrary(true)}>
              Science Library
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-10">
        {/* The live sensor station comes first in every context: it is the only part with real-time data. */}
        <EnvStation context={ctx} title={stationTitle} />

        {space && (
          <Section title="Mission profile" description="Pick where the crew is. The dose, gravity and delay below follow it.">
            <Tabs label="Mission profile" value={profile} onChange={setProfile} options={MISSIONS.map((m) => ({ value: m.id, label: m.name }))} />
          </Section>
        )}

        {space && (
          <div className="grid gap-10 lg:grid-cols-12">
            <Reveal className="lg:col-span-7">
              <Section title="Space radiation" description={`Cumulative dose on day ${day} compared with the career limit`}>
                <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                  <Metric label={`Cumulative dose · day ${day}`} value={rad.dose} unit="mSv" status={rad.status} hint={`${Math.round(rad.pct)} % of the career limit`} />
                  <Metric label="Dose rate" size="md" value={String(prof.doseRate)} unit="mSv/day" />
                </div>
                <div className="mt-6">
                  <Meter
                    value={rad.dose}
                    max={CAREER_LIMIT_MSV}
                    marks={[
                      { at: CAREER_LIMIT_MSV * 0.5, status: 'warn' },
                      { at: CAREER_LIMIT_MSV * 0.8, status: 'crit' },
                    ]}
                    status={radStatus}
                    label={`Cumulative radiation dose, ${Math.round(rad.pct)} percent of the ${CAREER_LIMIT_MSV} mSv career limit`}
                  />
                  <div className="relative mt-2 h-10 text-xs text-dim">
                    <span className="absolute left-0">0</span>
                    <span className="absolute left-1/2 -translate-x-1/2 text-center">
                      50 %<br />
                      review
                    </span>
                    <span className="absolute left-[80%] -translate-x-1/2 text-center">
                      80 %<br />
                      escalate
                    </span>
                    <span className="absolute right-0 text-right">
                      {CAREER_LIMIT_MSV} mSv
                      <br />
                      limit
                    </span>
                  </div>
                </div>
                <p className="mt-2 max-w-prose text-sm text-soft">{prof.doseNote}. About 30% of ISS radiation is neutrons, which CSA’s CANS instrument is built to measure.</p>
              </Section>
            </Reveal>

            <Reveal delay={0.08} className="lg:col-span-5">
              <Section title="Gravity and distance" description={`Now: ${prof.name}`}>
                <List>
                  {gravities.map((g) => (
                    <li key={g.name} className={g.now ? 'bg-panel2 px-2 py-3' : 'px-2 py-3'}>
                      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                        <span className={g.now ? 'font-medium text-ink' : 'text-soft'}>{g.name}</span>
                        <span className="font-medium text-ink">{g.g === 0 ? 'Microgravity' : `${g.g} g`}</span>
                      </div>
                      <Meter value={g.g} min={0} max={1} label={`${g.name}: ${g.g === 0 ? 'microgravity' : `${g.g} g`}`} />
                    </li>
                  ))}
                </List>
                <div className="mt-4 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-soft">One-way delay to Earth</span>
                  <span className="text-right font-medium text-ink">
                    {formatDelay(prof.delaySec)} <span className="font-mono text-xs font-normal text-dim">({prof.delayRange})</span>
                  </span>
                </div>
              </Section>
            </Reveal>
          </div>
        )}

        {space && (
          <Reveal>
            <Section title="Other cabin values" description="Sample values, not measured by AURA">
              <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
                {CABIN_SAMPLES.map((c) => (
                  <Card key={c.name}>
                    <Badge className="mb-3">Sample · not measured</Badge>
                    <Metric label={c.name} value={c.value} unit={c.unit} hint={c.limit} />
                  </Card>
                ))}
              </div>
              <p className="mt-3 text-sm text-dim">AURA’s sensor kit has no CO₂ or pressure sensor; these are typical reference values, not readings.</p>
            </Section>
          </Reveal>
        )}
      </div>

      {library && <ScienceLibrary onClose={() => setLibrary(false)} />}
    </div>
  )
}
