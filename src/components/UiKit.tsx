// Development-only living reference (/login?kit). Lives outside ui.tsx so recharts stays out of the login bundle.
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { ChevronRight, Info, X } from 'lucide-react'
import { useState } from 'react'
import { STATUS_COLOR, type Status } from '../data/vitals'
import Sparkline from './Sparkline'
import { Avatar, Badge, Button, Card, ChartTooltip, Checkbox, Dialog, EmptyState, Field, IconButton, Input, List, LiveDot, Meter, Metric, MotionRoot, Notice, PageHeader, PasswordInput, Row, ScoreRing, Section, Select, Sheet, Skeleton, SourceLink, Spinner, StatusPill, StatusText, Tabs, Textarea, Tooltip, chart } from './ui'

/* ================================================================== */
/* Living reference (development only): http://localhost:5173/login?kit */
/* ================================================================== */

const KIT_TREND = [118, 117, 121, 119, 122, 120, 124, 126, 125, 129, 131, 130, 134, 133, 138].map((value, i) => ({ day: 128 + i, value }))

/** Every primitive on one page, in every state. Open /login?kit in the dev server. Only reachable in development. */
export default function UiKit() {
  const [tab, setTab] = useState<'bp' | 'hr' | 'spo2' | 'sleep'>('bp')
  const [range, setRange] = useState<'7' | '30' | 'all'>('30')
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [status, setStatus] = useState<Status>('warn')
  const [value, setValue] = useState(138)
  const [loading, setLoading] = useState(false)
  const next: Record<Status, Status> = { ok: 'warn', warn: 'crit', crit: 'ok' }
  const fakeSave = () => {
    setLoading(true)
    window.setTimeout(() => setLoading(false), 1400)
  }
  return (
    <MotionRoot>
      <div className="mx-auto max-w-[1100px] space-y-12 px-4 py-10 sm:px-6">
        <PageHeader
          eyebrow="docs/DESIGN.md"
          title="AURA primitives"
          description="Every shared component in every state. If a page needs something that is not here, ask for it instead of hand-rolling it."
          status={<StatusPill status={status} announce />}
          actions={<Button onClick={() => setStatus(next[status])}>Change status</Button>}
        />

        <Section title="Type" description="IBM Plex Sans for everything a person reads; IBM Plex Mono for machine-written metadata.">
          <div className="space-y-3">
            <p className="text-display">Display 44 — auth headline</p>
            <p className="text-title">Title 28 — one per page</p>
            <p className="text-heading">Heading 18 — section headings</p>
            <p>Body 16 — Rest 5 minutes and re-measure. Tell your flight surgeon if it stays at or above 130/80.</p>
            <p className="text-sm text-soft">Small 14 — secondary text in the soft colour.</p>
            <p className="label">Label 13 — field labels and captions, sentence case</p>
            <p className="meta">meta 12 mono — D142 · 08:30 · Omron BP monitor</p>
          </div>
        </Section>

        <Section title="Buttons" description="One primary per view. Everything else is secondary or quiet.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={loading} onClick={fakeSave}>
              Save measurement
            </Button>
            <Button>Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Delete account</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button size="sm" icon={Info}>
              Small
            </Button>
            <Button size="lg" iconRight={ChevronRight}>
              Large
            </Button>
            <Tooltip label="Icon buttons always carry a label">
              <IconButton icon={X} label="Close" variant="secondary" />
            </Tooltip>
          </div>
        </Section>

        <Section title="Forms">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Systolic" hint="Upper number, in mmHg.">
              <Input inputMode="numeric" placeholder="120" />
            </Field>
            <Field label="Diastolic" error="Enter a value between 30 and 150.">
              <Input inputMode="numeric" defaultValue="300" />
            </Field>
            <Field label="Source">
              <Select defaultValue="device">
                <option value="device">Omron BP monitor</option>
                <option value="manual">Typed in by hand</option>
              </Select>
            </Field>
            <Field label="Password">
              <PasswordInput defaultValue="correct horse" />
            </Field>
            <Field label="Note" optional className="sm:col-span-2">
              <Textarea placeholder="Anything your flight surgeon should know" />
            </Field>
            <Checkbox className="sm:col-span-2" label="Share this reading with my flight surgeon" defaultChecked />
          </div>
        </Section>

        <Section title="Status" description="Icon shape + word + colour. Normal stays quiet; colour appears only when a reading needs you.">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="ok" />
            <StatusPill status="warn" />
            <StatusPill status="crit" />
            <StatusPill status={null} />
            <StatusPill status="warn" small />
            <StatusText status="ok">within your range</StatusText>
            <StatusText status="crit">below 5 h</StatusText>
            <Badge>Device</Badge>
            <Badge tone="accent">Simulated</Badge>
            <LiveDot />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Notice tone="warn" title="Blood pressure 138/86 mmHg" action={<Button size="sm">Re-measure</Button>}>
              Rest 5 minutes and re-measure. Tell your care contact if it stays at or above 130/80.
            </Notice>
            <Notice tone="crit" title="Sleep 4.4 h">
              Keep a fixed sleep window and dim the lights an hour before sleep.
            </Notice>
            <Notice tone="info">Simulated data. Thresholds marked “demo” are our own choices, not clinical limits.</Notice>
            <Notice tone="ok" title="Report delivered">
              Dr. Arslan will see it after the 14-minute signal delay.
            </Notice>
          </div>
        </Section>

        <Section
          title="Numbers"
          description="Numbers never count up from zero. They tween only when the value changes."
          action={
            <Button size="sm" onClick={() => setValue((v) => (v === 138 ? 121 : 138))}>
              Change value
            </Button>
          }
        >
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Metric size="xl" label="Systolic" value={value} unit="mmHg" status={value > 130 ? 'warn' : 'ok'} hint={value > 130 ? 'above 130' : 'in range'} />
            <Metric label="Heart rate" value={67} unit="bpm" status="ok" />
            <Metric label="Body temperature" value={36.8} decimals={1} unit="°C" hint="today 08:42" />
            <Metric label="Blood sugar" value={null} unit="mg/dL" status={null} hint="log a first reading" />
          </div>
          <div className="mt-8 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
            <ScoreRing score={status === 'ok' ? 96 : status === 'warn' ? 82 : 56} status={status} size={132} />
            <div className="max-w-md space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-dim">Radiation dose</span>
                  <span className="text-ink">
                    256 mSv <span className="text-dim">of 600</span>
                  </span>
                </div>
                <Meter
                  value={43}
                  marks={[
                    { at: 50, status: 'warn' },
                    { at: 80, status: 'crit' },
                  ]}
                  label="Radiation dose, 43% of the career limit"
                />
              </div>
              <Sparkline data={KIT_TREND} color={STATUS_COLOR[status]} />
            </div>
          </div>
        </Section>

        <Section
          title="Chart"
          description="Ink line, hairline grid, mono ticks, a tinted reference band. Straight segments between real measurements."
          action={
            <Tabs
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
        >
          <Tabs
            label="Measurement"
            variant="line"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'bp', label: 'Blood pressure', status: 'warn' },
              { value: 'hr', label: 'Heart rate' },
              { value: 'spo2', label: 'Blood oxygen' },
              { value: 'sleep', label: 'Sleep', status: 'crit' },
            ]}
          />
          <div className="mt-4 h-64 rounded-xl border border-line bg-deep p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={KIT_TREND} margin={chart.margin}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(d) => `D${d}`} {...chart.xAxis} />
                <YAxis domain={[110, 145]} {...chart.yAxis} />
                <ReferenceArea y1={110} y2={130} {...chart.band('ok')} />
                <ReferenceLine y={130} {...chart.refLine('warn')} />
                <ReferenceLine y={118} {...chart.refLine()} />
                <RTooltip {...chart.tooltip} content={<ChartTooltip unit="mmHg" formatLabel={(l) => `Day ${String(l)}`} />} />
                <Line dataKey="value" name="Systolic" {...chart.line} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-dim">Green band: normal range. Dashed amber: attention threshold. Dashed grey: your baseline.</p>
        </Section>

        <Section title="Surfaces and lists" description="Group with space and hairlines first. A Card is for a discrete object; never nest cards.">
          <div className="grid gap-6 lg:grid-cols-2">
            <List className="self-start">
              <Row leading={<Avatar name="Mira Okafor" text="CDR" />} title="Mira Okafor" description="Commander" trailing={<StatusPill status="warn" small />} to="/login?kit" />
              <Row leading={<Avatar name="Aiko Tanaka" text="MS1" />} title="Aiko Tanaka" description="Mission Specialist" trailing={<StatusPill status="ok" small />} to="/login?kit" />
              <Row title="Morning blood pressure" description="Omron BP monitor" trailing={<span className="meta">08:30</span>} />
            </List>
            <div className="space-y-4">
              <Card>
                <Metric size="md" label="Water today" value={1.6} decimals={1} unit="L" status="warn" hint="target 2.5 L" />
              </Card>
              <EmptyState icon={Info} title="No readings yet" description="Log your first blood pressure reading and AURA will start your baseline." action={<Button size="sm">Log a measurement</Button>} />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-24" />
                <Spinner label="Loading health data" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Overlays and sources">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button onClick={() => setSheet(true)}>Open sheet</Button>
          </div>
          <p className="mt-4 text-sm text-dim">
            Source: <SourceLink href="https://www.who.int/news-room/fact-sheets/detail/hypertension" org="WHO" title="Hypertension" />
          </p>
        </Section>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Send report to flight surgeon?"
        description="It arrives after the 14-minute signal delay."
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialog(false)} data-autofocus>
              Send report
            </Button>
          </>
        }
      >
        <p className="text-soft">The report contains today’s readings, open alerts and your 7-day trends.</p>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Blood pressure" description="How to measure">
        <p className="text-soft">Rest 5 minutes. Cuff on the upper arm at heart level, stay still and silent, then start.</p>
      </Sheet>
    </MotionRoot>
  )
}
