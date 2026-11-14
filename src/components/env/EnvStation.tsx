import { Droplets, Flame, FlaskConical, Plug, Square, Thermometer, Unplug, Wind } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Context } from '../../data/contexts'
import { CABIN_LIMITS } from '../../data/missions'
import { BUCKET_MS, GAS_ALARM_RATIO, GAS_WARN_RATIO, LIVE_WINDOW_MS, type Level } from '../../lib/envStation'
import { Panel } from '../ui'
import { EnvCharts, EnvTable } from './EnvCharts'
import { GasAlarmBanner, GasGuidance } from './GasAlarm'
import { MQ2_GASES, MQ2_PREHEAT } from './gasGuidance'
import { ExtLink, LevelChip, SourceBadge, ageText, clockTime, fmt } from './parts'
import { Readout } from './Readout'
import { SensorSetup } from './SensorSetup'
import { useEnvStation } from './useEnvStation'

const NASA_STD_3001_V2 = 'https://standards.nasa.gov/sites/default/files/standards/NASA/D/nasa-std-3001-vol-2-rev-d-signature.pdf'
const RANGES = [
  { min: 15, label: '15 min' },
  { min: 60, label: '1 h' },
  { min: 360, label: '6 h' },
  { min: 1440, label: '24 h' },
]

const btn = 'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40'
const primary = `${btn} border-cyan bg-cyan text-space hover:bg-ice`
const secondary = `${btn} border-line text-soft hover:border-ice hover:text-ink`
const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? 'bg-cyan text-space' : 'text-soft hover:text-ink'}`

const LINK_STATE: Record<string, { level: Level; label: string }> = {
  live: { level: 'ok', label: 'CONNECTED' },
  connecting: { level: 'none', label: 'CONNECTING' },
  stale: { level: 'warn', label: 'NO SIGNAL' },
  error: { level: 'warn', label: 'PROBLEM' },
  idle: { level: 'none', label: 'NOT CONNECTED' },
  unsupported: { level: 'none', label: 'NOT AVAILABLE HERE' },
}

/**
 * Live environment station (temperature, humidity, flammable gas) for every user context.
 * Sources of numbers are always labelled: LIVE SENSOR, SIMULATED (never saved) or STORED.
 */
export default function EnvStation({ context, title }: { context: Context; title: string }) {
  const s = useEnvStation()
  const { serial, mode } = s
  const [tab, setTab] = useState<'live' | 'stored'>('stored')
  const [table, setTable] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    setTab(mode === 'live' || mode === 'sim' ? 'live' : 'stored')
  }, [mode])

  if (!s.station) {
    return (
      <Panel title={title}>
        <p className="text-sm text-dim">Sign in to use the sensor station.</p>
      </Panel>
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

  const gasBig = s.gas.ratio != null ? s.gas.ratio.toFixed(2) : fmt(s.gas.raw, 0)
  const gasUnit = s.gas.ratio != null ? '× baseline' : '/ 1023 raw'

  const baselineArea =
    mode === 'live' ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={secondary}
          disabled={s.baselineCandidate.value == null}
          title={s.baselineCandidate.reason ?? 'Use the last 10 seconds as the clean-air reference'}
          onClick={s.captureBaseline}
        >
          <Wind className="h-4 w-4" aria-hidden="true" /> {s.baseline ? 'Re-set clean-air baseline' : 'Set clean-air baseline'}
        </button>
        {s.baseline && (
          <button type="button" className="text-xs text-dim underline underline-offset-2 hover:text-ink" onClick={s.clearBaseline}>
            Clear baseline
          </button>
        )}
        {s.baselineCandidate.reason && <span className="w-full text-xs text-dim">{s.baselineCandidate.reason}</span>}
        {s.gas.warm != null && s.gas.warm > 0 && (
          <button type="button" className="text-xs text-dim underline underline-offset-2 hover:text-ink" onClick={s.skipWarmup}>
            Sensor already powered for several minutes? Skip the warm-up
          </button>
        )}
        <span className="w-full text-xs text-dim">Do this in fresh, clean air after the warm-up.</span>
      </div>
    ) : null

  // The live window grows from the first sample (min. 1 minute) up to the last 5 minutes.
  const firstLive = s.liveSeries.length ? s.liveSeries[0].x : s.now
  const liveFrom = Math.min(s.now - 60_000, Math.max(s.now - LIVE_WINDOW_MS, firstLive - 5_000))
  const storedFrom = s.now - s.range * 60_000

  return (
    <Panel
      title={title}
      action={<SourceBadge mode={mode} pulse={liveLink && serial.status === 'live'} suffix={badgeSuffix} />}
    >
      <div className="space-y-4">
        {mode === 'sim' && (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-dashed border-ink/60 bg-panel2/60 p-3 text-sm" role="status">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
            <p>
              <b className="tracking-wider text-ink">SIMULATION MODE</b> <span className="text-soft">— these numbers are generated by AURA for a demo. They are not measured, not saved and never uploaded.</span>
            </p>
          </div>
        )}

        {s.alarm && <GasAlarmBanner alarm={s.alarm} context={context} simRunning={mode === 'sim'} onDismiss={s.dismissAlarm} />}
        {s.simAlarm && <GasAlarmBanner alarm={s.simAlarm} context={context} onDismiss={s.dismissAlarm} />}

        {/* connection + controls */}
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-deep/40 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <LevelChip level={link.level} label={link.label} />
            <p className="min-w-0 text-sm text-soft" aria-live="polite">
              {serial.message}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {serial.connected ? (
              <button type="button" className={secondary} onClick={() => void serial.disconnect()}>
                <Unplug className="h-4 w-4" aria-hidden="true" /> Disconnect
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={primary}
                  disabled={!serial.supported || serial.status === 'connecting'}
                  title={serial.supported ? 'Connect the Arduino over USB' : 'Needs Chrome or Edge on a computer'}
                  onClick={() => void serial.connect()}
                >
                  <Plug className="h-4 w-4" aria-hidden="true" /> Connect sensor
                </button>
                {serial.supported && serial.knownPort && (
                  <button type="button" className="text-xs text-dim underline underline-offset-2 hover:text-ink" onClick={() => void serial.connect({ choose: true })}>
                    Choose another port
                  </button>
                )}
              </>
            )}
            {s.sim ? (
              <>
                <button type="button" className={secondary} onClick={s.stopSim}>
                  <Square className="h-4 w-4" aria-hidden="true" /> Stop simulation
                </button>
                <button type="button" className={secondary} disabled={s.simLeaking} onClick={s.simulateLeak}>
                  <Flame className="h-4 w-4" aria-hidden="true" /> {s.simLeaking ? 'Leak running…' : 'Simulate gas leak'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={secondary}
                disabled={serial.connected}
                title={serial.connected ? 'Disconnect the sensor to use the simulation' : 'Show simulated readings (never saved)'}
                onClick={s.startSim}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" /> Simulate
              </button>
            )}
          </div>
        </div>

        {/* readouts */}
        <div className="grid gap-4 md:grid-cols-3">
          <Readout
            name="Temperature"
            Icon={Thermometer}
            value={fmt(s.temp.value, 1)}
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
          <Readout
            name="Humidity"
            Icon={Droplets}
            value={fmt(s.hum.value, 0)}
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
          <Readout
            name="Flammable gas"
            Icon={Flame}
            value={gasBig}
            unit={gasUnit}
            ev={s.gas.eval}
            dimmed={s.noData}
            updated={updated}
            extra={
              <>
                <span className="mr-1 rounded border border-line px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-soft">UNCALIBRATED · NOT PPM</span>
                Raw {fmt(s.gas.raw, 0)} / 1023
                {s.gas.base != null ? ` · baseline ${s.gas.base}${mode === 'sim' ? ' (simulated)' : ''}` : ''}
                {mode === 'live' && s.baseline ? ` · set ${clockTime(Date.parse(s.baseline.at), false)}` : ''}
                {baselineArea}
              </>
            }
            rule={
              <>
                Attention ≥ {GAS_WARN_RATIO}× · alarm ≥ {GAS_ALARM_RATIO}× your clean-air baseline (AURA demo thresholds)
              </>
            }
          />
        </div>

        {/* charts */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-full border border-line p-1" role="tablist" aria-label="Chart data">
              <button type="button" role="tab" aria-selected={tab === 'live'} className={chip(tab === 'live')} onClick={() => setTab('live')}>
                Live · last 5 min
              </button>
              <button type="button" role="tab" aria-selected={tab === 'stored'} className={chip(tab === 'stored')} onClick={() => setTab('stored')}>
                Stored history
              </button>
            </div>
            {tab === 'stored' && (
              <div className="flex flex-wrap items-center gap-1">
                {RANGES.map((r) => (
                  <button key={r.min} type="button" aria-pressed={s.range === r.min} className={chip(s.range === r.min)} onClick={() => s.setRange(r.min)}>
                    {r.label}
                  </button>
                ))}
                <button type="button" aria-pressed={table} className={chip(table)} onClick={() => setTable((v) => !v)}>
                  Table
                </button>
              </div>
            )}
          </div>

          {tab === 'live' ? (
            s.liveSeries.length ? (
              <EnvCharts data={s.liveSeries} from={liveFrom} to={s.now} gasUnit={s.liveGasUnit} seconds />
            ) : (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-dim">
                No live values. Connect the sensor, or press <b>Simulate</b> for a demo without hardware.
              </div>
            )
          ) : (
            <div className={`space-y-3 transition-opacity ${s.history.loading ? 'opacity-60' : ''}`}>
              <EnvCharts data={s.storedSeries} from={storedFrom} to={s.now} gasUnit={s.storedGasUnit} seconds={s.range <= 15} />
              {table && <EnvTable rows={s.history.rows} />}
            </div>
          )}
          <p className="text-xs text-dim">
            {tab === 'live' ? (
              <>
                {mode === 'sim' ? 'SIMULATED values, one per second.' : 'LIVE SENSOR values, one per second.'} Gaps mean no data. The gas line pauses while the heater warms up.
              </>
            ) : (
              <>
                STORED · {s.history.from === 'server' ? 'from the AURA server' : 'saved in this browser'} · each point is a {BUCKET_MS / 1000}-second average (longer ranges are
                averaged further; gas shows the peak). {s.history.rows.length} point(s).
                {s.history.error && <span className="text-warn"> Server not reachable — showing readings saved in this browser.</span>}
              </>
            )}
          </p>
        </div>

        {/* guidance + setup */}
        {!guidanceShown && (
          <details className="rounded-2xl border border-line bg-deep/40 p-4" open={guideOpen} onToggle={(e) => setGuideOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-semibold text-ink">What to do if the gas alarm goes off</summary>
            <div className="mt-3">
              <GasGuidance context={context} />
            </div>
          </details>
        )}
        <details className="rounded-2xl border border-line bg-deep/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Set up the Arduino sensor</summary>
          <div className="mt-3">
            <SensorSetup device={s.device} noise={s.noise} lines={serial.lineCount} />
          </div>
        </details>

        {/* honesty + storage notes */}
        <div className="space-y-1.5 text-xs text-dim">
          <p>
            <b className="text-soft">{s.station.label}.</b> {s.station.who}{' '}
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
      </div>
    </Panel>
  )
}
