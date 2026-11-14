import { Droplets, Flame, FlaskConical, Plug, Square, Table2, Thermometer, Unplug, Wind } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Context } from '../../data/contexts'
import { CABIN_LIMITS } from '../../data/missions'
import { BUCKET_MS, GAS_ALARM_RATIO, GAS_WARN_RATIO, LIVE_WINDOW_MS, type Level } from '../../lib/envStation'
import { Button, Card, Disclosure as UiDisclosure, EmptyState, LiveDot, Meter, Notice, Section, Stagger, StaggerItem, Tabs, cx } from '../ui'
import { EnvCharts, EnvTable } from './EnvCharts'
import { GasAlarmBanner, GasGuidance } from './GasAlarm'
import { MQ2_GASES, MQ2_PREHEAT } from './gasGuidance'
import { ExtLink, LevelChip, SourceBadge, ageText, clockTime, fmt } from './parts'
import { Readout } from './Readout'
import { SensorSetup } from './SensorSetup'
import { useEnvStation } from './useEnvStation'

const NASA_STD_3001_V2 = 'https://standards.nasa.gov/sites/default/files/standards/NASA/D/nasa-std-3001-vol-2-rev-d-signature.pdf'
const RANGES = [
  { value: '15', label: '15 min' },
  { value: '60', label: '1 h' },
  { value: '360', label: '6 h' },
  { value: '1440', label: '24 h' },
]

const LINK_STATE: Record<string, { level: Level; label: string }> = {
  live: { level: 'ok', label: 'Connected' },
  connecting: { level: 'none', label: 'Connecting' },
  stale: { level: 'warn', label: 'No signal' },
  error: { level: 'warn', label: 'Problem' },
  idle: { level: 'none', label: 'Not connected' },
  unsupported: { level: 'none', label: 'Not available here' },
}

/** The shared disclosure with this page's look: 44 px target, a chevron that turns, a hairline above. Remembers its state. */
function Disclosure({ id, title, summary, onToggle, children }: { id: string; title: string; summary?: ReactNode; onToggle?: (open: boolean) => void; children: ReactNode }) {
  return (
    <UiDisclosure size="row" id={id} title={<span className="text-[15px] font-semibold text-ink">{title}</span>} summary={summary} onToggle={onToggle} className="border-t border-line">
      <div className="pb-2 pt-1">{children}</div>
    </UiDisclosure>
  )
}

/**
 * Live environment station (temperature, humidity, flammable gas) for every user context.
 * Sources of numbers are always labelled: live sensor, simulated (never saved) or stored.
 */
export default function EnvStation({ context, title }: { context: Context; title: string }) {
  const s = useEnvStation()
  const { serial, mode } = s
  const [tab, setTab] = useState<'live' | 'stored'>('stored')
  const [table, setTable] = useState(false)

  useEffect(() => {
    setTab(mode === 'live' || mode === 'sim' ? 'live' : 'stored')
  }, [mode])

  if (!s.station) {
    return (
      <Section title={title}>
        <p className="text-sm text-dim">Sign in to use the sensor station.</p>
      </Section>
    )
  }

  const liveLink = mode === 'live'
  const badgeSuffix =
    mode === 'live'
      ? serial.status === 'stale'
        ? 'NO SIGNAL'
        : serial.status === 'connecting'
          ? 'CONNECTING'
          : undefined
      : mode === 'sim'
        ? 'NOT REAL DATA'
        : mode === 'stored'
          ? ageText(s.age)
          : undefined
  const updated = s.lastAt == null ? 'never' : mode === 'stored' ? `${ageText(s.age)} (stored ${clockTime(s.lastAt)})` : ageText(s.age)
  const guidanceShown = (s.alarm != null && s.alarm.endedAt == null) || (s.simAlarm != null && s.simAlarm.endedAt == null)
  const link = LINK_STATE[serial.status]
  const nonHome = context !== 'space'
  const connectIsPrimary = !serial.connected && !s.sim

  const gasValue = s.gas.ratio ?? s.gas.raw ?? null
  const gasLevel = s.gas.eval.level
  const gasMeter =
    s.gas.ratio != null && !s.noData ? (
      <div>
        <Meter
          value={s.gas.ratio}
          min={0}
          max={GAS_ALARM_RATIO * 1.5}
          marks={[
            { at: GAS_WARN_RATIO, status: 'warn' },
            { at: GAS_ALARM_RATIO, status: 'crit' },
          ]}
          status={gasLevel === 'crit' ? 'crit' : gasLevel === 'warn' ? 'warn' : undefined}
          label="Flammable gas compared with the clean-air baseline"
        />
        <p className="mt-2 text-sm text-dim">
          Amber tick: attention at {GAS_WARN_RATIO}×. Red tick: alarm at {GAS_ALARM_RATIO}×.
        </p>
      </div>
    ) : null

  const baselineArea =
    mode === 'live' ? (
      <span className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Wind} disabled={s.baselineCandidate.value == null} title={s.baselineCandidate.reason ?? 'Use the last 10 seconds as the clean-air reference'} onClick={s.captureBaseline}>
          {s.baseline ? 'Re-set clean-air baseline' : 'Set clean-air baseline'}
        </Button>
        {s.baseline && (
          <Button size="sm" variant="quiet" onClick={s.clearBaseline}>
            Clear baseline
          </Button>
        )}
        {s.baselineCandidate.reason && <span className="w-full">{s.baselineCandidate.reason}</span>}
        {s.gas.warm != null && s.gas.warm > 0 && (
          <Button size="sm" variant="quiet" onClick={s.skipWarmup} className="h-auto min-h-9 whitespace-normal py-1.5 text-left">
            Sensor already powered for several minutes? Skip the warm-up
          </Button>
        )}
        <span className="w-full">Do this in fresh, clean air after the warm-up.</span>
      </span>
    ) : null

  // The live window grows from the first sample (min. 1 minute) up to the last 5 minutes.
  const firstLive = s.liveSeries.length ? s.liveSeries[0].x : s.now
  const liveFrom = Math.min(s.now - 60_000, Math.max(s.now - LIVE_WINDOW_MS, firstLive - 5_000))
  // Stored history moves in whole buckets, so the (memoised) charts redraw once per bucket instead of every second.
  const storedTo = Math.ceil(s.now / BUCKET_MS) * BUCKET_MS
  const storedFrom = storedTo - s.range * 60_000

  return (
    <Section title={title} description="Live temperature, humidity and flammable gas from the Arduino kit" action={<SourceBadge mode={mode} pulse={liveLink && serial.status === 'live'} suffix={badgeSuffix} />}>
      <div className="space-y-6">
        {/* Alarms come first and appear instantly: never inside a reveal or a stagger. */}
        {s.alarm && <GasAlarmBanner alarm={s.alarm} context={context} simRunning={mode === 'sim'} onDismiss={s.dismissAlarm} />}
        {s.simAlarm && <GasAlarmBanner alarm={s.simAlarm} context={context} onDismiss={s.dismissAlarm} />}

        {mode === 'sim' && (
          <Notice tone="info" role="status" title="Simulation mode">
            These numbers are generated by AURA for a demo. They are not measured, not saved and never uploaded.
          </Notice>
        )}

        {/* connection + controls */}
        <Card pad="sm" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {serial.status === 'live' ? <LiveDot label="Connected" className="text-sm" /> : <LevelChip level={link.level} label={link.label} />}
            <p className="min-w-0 text-sm text-soft" aria-live="polite">
              {serial.message}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {serial.connected ? (
              <Button icon={Unplug} onClick={() => void serial.disconnect()}>
                Disconnect
              </Button>
            ) : (
              <>
                <Button
                  variant={connectIsPrimary ? 'primary' : 'secondary'}
                  icon={Plug}
                  disabled={!serial.supported || serial.status === 'connecting'}
                  title={serial.supported ? 'Connect the Arduino over USB' : 'Needs Chrome or Edge on a computer'}
                  onClick={() => void serial.connect()}
                >
                  Connect sensor
                </Button>
                {serial.supported && serial.knownPort && (
                  <Button variant="quiet" onClick={() => void serial.connect({ choose: true })}>
                    Choose another port
                  </Button>
                )}
              </>
            )}
            {s.sim ? (
              <>
                <Button icon={Square} onClick={s.stopSim}>
                  Stop simulation
                </Button>
                <Button variant="primary" icon={Flame} disabled={s.simLeaking} onClick={s.simulateLeak}>
                  {s.simLeaking ? 'Leak running…' : 'Simulate gas leak'}
                </Button>
              </>
            ) : (
              <Button
                icon={FlaskConical}
                disabled={serial.connected}
                title={serial.connected ? 'Disconnect the sensor to use the simulation' : 'Show simulated readings (never saved)'}
                onClick={s.startSim}
              >
                Simulate
              </Button>
            )}
          </div>
        </Card>

        {/* readouts */}
        <Stagger className="grid gap-4 md:grid-cols-3 lg:gap-6">
          <StaggerItem>
            <Readout
              name="Temperature"
              Icon={Thermometer}
              value={s.temp.value ?? null}
              decimals={1}
              unit="°C"
              ev={s.temp.eval}
              dimmed={s.noData}
              updated={updated}
              rule={
                <>
                  Normal band {CABIN_LIMITS.tempMin}–{CABIN_LIMITS.tempMax} °C (NASA cabin standard)
                </>
              }
            />
          </StaggerItem>
          <StaggerItem>
            <Readout
              name="Humidity"
              Icon={Droplets}
              value={s.hum.value ?? null}
              decimals={0}
              unit="%"
              ev={s.hum.eval}
              dimmed={s.noData}
              updated={updated}
              rule={
                <>
                  Normal band {CABIN_LIMITS.rhMin}–{CABIN_LIMITS.rhMax} % (NASA cabin standard)
                </>
              }
            />
          </StaggerItem>
          <StaggerItem>
            <Readout
              name="Flammable gas"
              Icon={Flame}
              value={gasValue}
              decimals={s.gas.ratio != null ? 2 : 0}
              unit={s.gas.ratio != null ? '× baseline' : '/ 1023 raw'}
              ev={s.gas.eval}
              dimmed={s.noData}
              updated={updated}
              meter={gasMeter}
              extra={
                <>
                  <span className="mb-1 inline-flex h-6 items-center rounded-md border border-line px-1.5 font-mono text-xs text-soft">Uncalibrated, not ppm</span>
                  <span className="block">
                    Raw {fmt(s.gas.raw, 0)} / 1023
                    {s.gas.base != null ? ` · baseline ${s.gas.base}${mode === 'sim' ? ' (simulated)' : ''}` : ''}
                    {mode === 'live' && s.baseline ? ` · set ${clockTime(Date.parse(s.baseline.at), false)}` : ''}
                  </span>
                  {baselineArea}
                </>
              }
              rule={
                <>
                  Attention ≥ {GAS_WARN_RATIO}× · alarm ≥ {GAS_ALARM_RATIO}× your clean-air baseline (AURA demo thresholds)
                </>
              }
            />
          </StaggerItem>
        </Stagger>

        {/* charts */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                label="Chart data"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'live', label: 'Live · last 5 min' },
                  { value: 'stored', label: 'Stored history' },
                ]}
              />
              {tab === 'live' && liveLink && serial.status === 'live' && <LiveDot label="Streaming" />}
            </div>
            {tab === 'stored' && (
              <div className="flex flex-wrap items-center gap-2">
                <Tabs label="Time range" value={String(s.range)} onChange={(v) => s.setRange(Number(v))} options={RANGES} />
                <Button size="sm" icon={Table2} aria-pressed={table} className={cx(table && 'border-edge bg-panel2')} onClick={() => setTable((v) => !v)}>
                  Table
                </Button>
              </div>
            )}
          </div>

          {tab === 'live' ? (
            s.liveSeries.length ? (
              <EnvCharts data={s.liveSeries} from={liveFrom} to={s.now} gasUnit={s.liveGasUnit} seconds />
            ) : (
              <EmptyState icon={Plug} title="No live values" description="Connect the sensor, or press Simulate for a demo without hardware." />
            )
          ) : (
            <div className={cx('space-y-4 transition-opacity', s.history.loading && 'opacity-60')}>
              <EnvCharts data={s.storedSeries} from={storedFrom} to={storedTo} gasUnit={s.storedGasUnit} seconds={s.range <= 15} />
              {table && <EnvTable rows={s.history.rows} />}
            </div>
          )}
          <p className="text-sm text-dim">
            {tab === 'live' ? (
              <>
                {mode === 'sim' ? 'Simulated values, one per second.' : 'Live sensor values, one per second.'} Gaps mean no data. The gas line pauses while the heater warms up.
              </>
            ) : (
              <>
                Stored · {s.history.from === 'server' ? 'from the AURA server' : 'saved in this browser'} · each point is a {BUCKET_MS / 1000}-second average (longer ranges are
                averaged further; gas shows the peak). {s.history.rows.length} point(s).
                {s.history.error && <span className="text-warn"> Server not reachable — showing readings saved in this browser.</span>}
              </>
            )}
          </p>
        </div>

        {/* guidance + setup */}
        <div className="border-b border-line">
          {!guidanceShown && (
            <Disclosure id="env.gas-guide" title="What to do if the gas alarm goes off">
              <GasGuidance context={context} />
            </Disclosure>
          )}
          <Disclosure id="env.setup" title="Set up the Arduino sensor">
            <SensorSetup device={s.device} noise={s.noise} lines={serial.lineCount} />
          </Disclosure>
        </div>

        {/* honesty + storage notes: the safety line stays visible, the rest folds away */}
        <p className="max-w-3xl text-sm text-dim">Simulated values are never saved. Not a certified gas or carbon-monoxide alarm.</p>
        <Disclosure id="env.notes" title="About these readings and their sources">
        <div className="max-w-3xl space-y-2 text-sm text-dim">
          <p>
            <b className="font-medium text-soft">{s.station.label}.</b> {s.station.who}{' '}
            {s.serverMode ? (
              <>
                Live readings are saved to the AURA server as one averaged row every {BUCKET_MS / 1000} s
                {s.upload.pending > 0 ? ` · ${s.upload.pending} waiting to upload` : ''}
                {s.upload.lastSentAt ? ` · last upload ${ageText(s.now - s.upload.lastSentAt)}` : ''}.
                {s.upload.error && <span className="text-warn"> {s.upload.error}</span>}
              </>
            ) : (
              <>Demo mode: live readings are saved only in this browser (one averaged row every {BUCKET_MS / 1000} s, last 6 hours kept).</>
            )}{' '}
            Simulated values are never saved.{s.recorded > 0 ? ` ${s.recorded} row(s) recorded on this page.` : ''}
          </p>
          <p>
            Temperature and humidity bands come from <ExtLink href={NASA_STD_3001_V2}>NASA-STD-3001 Vol. 2 Rev. D</ExtLink> (crew cabin; simplified from a combined
            temperature–humidity envelope){nonHome ? ' — a guide, not a rule for homes or stations' : ''}.
          </p>
          <p>
            Gas is the raw sensor value compared with your own clean-air baseline; the {GAS_WARN_RATIO}× and {GAS_ALARM_RATIO}× levels are AURA demo thresholds, not a
            safety standard. The MQ-2 reacts to several flammable gases (<ExtLink href={MQ2_GASES.url}>datasheet</ExtLink>: “{MQ2_GASES.quote}”). Its standard test uses
            a much longer warm-up (“{MQ2_PREHEAT.quote}”) than our 2-minute demo warm-up, so readings can drift. Not a certified gas or carbon-monoxide alarm.
          </p>
        </div>
        </Disclosure>
      </div>
    </Section>
  )
}
