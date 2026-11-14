import { useEffect, useMemo, useState } from 'react'
import BodyMap from './components/BodyMap'
import EditVitalModal from './components/EditVitalModal'
import SystemPanel from './components/SystemPanel'
import VitalTile from './components/VitalTile'
import { CABIN_LIMITS, CAREER_LIMIT_MSV, MISSIONS, formatDelay } from './data/missions'
import { SYSTEMS, SYSTEM_BY_ID, type SystemId } from './data/systems'
import {
  DEFAULT_VALUES,
  STATUS_COLOR,
  STATUS_LABEL,
  VITALS,
  VITAL_BY_KEY,
  worst,
  type FieldId,
  type Source,
  type Status,
  type Values,
  type VitalKey,
} from './data/vitals'
import { useSerial } from './hooks/useSerial'
import ScienceLibrary from './components/ScienceLibrary'

const STORAGE_KEY = 'crewpulse.v1'

type Saved = { values: Values; sources: Partial<Record<FieldId, Source>>; missionId: string; day: number }

function load(): Saved {
  const fallback: Saved = { values: DEFAULT_VALUES, sources: {}, missionId: 'mars-transit', day: 142 }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const s = JSON.parse(raw)
    return { ...fallback, ...s, values: { ...DEFAULT_VALUES, ...s.values } }
  } catch {
    return fallback
  }
}

// Delay-aware triage text: the further from Earth, the more the crew must handle alone.
function actionFor(status: Status, delaySec: number): string {
  const roundTrip = formatDelay(delaySec * 2)
  const remote = delaySec >= 60
  if (status === 'ok') return 'Within normal range. Keep your routine and measure again at the next scheduled check.'
  if (status === 'warn')
    return remote
      ? `Re-measure in 15 minutes and tell your crew medical officer. Follow the onboard protocol first — a reply from Earth takes at least ${roundTrip}.`
      : 'Re-measure in 15 minutes and tell a crewmate. If it stays out of range, raise it with the flight surgeon at the next ground conference.'
  return remote
    ? `Alert your crew medical officer now and send the flight-surgeon report. The earliest reply from Earth is in about ${roundTrip} — start the onboard steps below while you wait.`
    : 'Alert a crewmate and contact the flight surgeon now. Follow the steps below while you wait.'
}

export default function App() {
  const initial = useMemo(load, [])
  const [values, setValues] = useState<Values>(initial.values)
  const [sources, setSources] = useState(initial.sources)
  const [missionId, setMissionId] = useState(initial.missionId)
  const [day, setDay] = useState(initial.day)
  const [selected, setSelected] = useState<SystemId | null>(null)
  const [editing, setEditing] = useState<VitalKey | null>(null)
  const [simulate, setSimulate] = useState(false)
  const [cabin, setCabin] = useState<{ t?: number; h?: number } | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    try {
      // Simulated readings are never persisted as if they were real ones.
      const kept = Object.fromEntries(Object.entries(sources).filter(([, s]) => s === 'manual'))
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ values, sources: kept, missionId, day }))
    } catch {
      /* storage unavailable */
    }
  }, [values, sources, missionId, day])

  const patch = (p: Partial<Values>, source: Source) => {
    setValues((v) => ({ ...v, ...p }))
    setSources((s) => ({ ...s, ...Object.fromEntries(Object.keys(p).map((k) => [k, source])) }))
  }

  // Live sensor over Web Serial (Arduino).
  const serial = useSerial((r) => {
    const p: Partial<Values> = {}
    if (typeof r.hr === 'number') p.hr = r.hr
    if (typeof r.spo2 === 'number') p.spo2 = r.spo2
    if (typeof r.temp === 'number') p.temp = r.temp
    if (Object.keys(p).length) patch(p, 'live')
    if (typeof r.t === 'number' || typeof r.h === 'number') setCabin((c) => ({ ...c, t: r.t ?? c?.t, h: r.h ?? c?.h }))
  })

  // Simulated live feed for demos without hardware — always labelled SIMULATED.
  useEffect(() => {
    if (!simulate) return
    const id = setInterval(() => {
      setValues((v) => ({
        ...v,
        hr: Math.round(Math.min(110, Math.max(58, v.hr + (Math.random() - 0.5) * 5))),
        spo2: Math.round(Math.min(99, Math.max(94, v.spo2 + (Math.random() - 0.5) * 1.6))),
      }))
      setSources((s) => ({ ...s, hr: 'sim', spo2: 'sim' }))
    }, 1000)
    return () => clearInterval(id)
  }, [simulate])

  const mission = MISSIONS.find((m) => m.id === missionId) ?? MISSIONS[0]
  const dose = day * mission.doseRate
  const dosePct = (dose / CAREER_LIMIT_MSV) * 100
  const radStatus: Status = dosePct > 80 ? 'crit' : dosePct >= 50 ? 'warn' : 'ok'

  const vitalStatus = Object.fromEntries(VITALS.map((d) => [d.key, d.evaluate(values)])) as Record<VitalKey, Status>
  const systemStatus = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.id === 'radiation' ? radStatus : worst(s.vitals.map((k) => vitalStatus[k]))]),
  ) as Record<SystemId, Status>
  const summaries = Object.fromEntries(
    SYSTEMS.map((s) => [
      s.id,
      s.id === 'radiation'
        ? `${dose.toFixed(0)} mSv est.`
        : s.vitals.map((k) => `${VITAL_BY_KEY[k].display(values)} ${VITAL_BY_KEY[k].unit}`).join(' · '),
    ]),
  ) as Record<SystemId, string>

  const overall = worst(Object.values(systemStatus))
  const flagged = SYSTEMS.filter((s) => systemStatus[s.id] !== 'ok')

  const sourceOf = (key: VitalKey): Source => {
    const list = VITAL_BY_KEY[key].fields.map((f) => sources[f.id] ?? 'sample')
    return list.includes('live') ? 'live' : list.includes('sim') ? 'sim' : list.includes('manual') ? 'manual' : 'sample'
  }

  const tile = (key: VitalKey) => {
    const d = VITAL_BY_KEY[key]
    return (
      <VitalTile
        key={key}
        label={d.label}
        value={d.display(values)}
        unit={d.unit}
        status={vitalStatus[key]}
        source={sourceOf(key)}
        onClick={() => setEditing(key)}
      />
    )
  }

  const cabinStatus: Status =
    cabin?.t == null && cabin?.h == null
      ? 'ok'
      : (cabin.t != null && (cabin.t < CABIN_LIMITS.tempMin - 3 || cabin.t > CABIN_LIMITS.tempMax + 3)) ||
          (cabin.h != null && (cabin.h < CABIN_LIMITS.rhMin - 10 || cabin.h > CABIN_LIMITS.rhMax + 10))
        ? 'crit'
        : (cabin.t != null && (cabin.t < CABIN_LIMITS.tempMin || cabin.t > CABIN_LIMITS.tempMax)) ||
            (cabin.h != null && (cabin.h < CABIN_LIMITS.rhMin || cabin.h > CABIN_LIMITS.rhMax))
          ? 'warn'
          : 'ok'

  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-3 p-3 sm:p-4">
      {/* ---------- header ---------- */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold tracking-tight text-white">
            Crew<span className="text-sky-400">Pulse</span>
          </h1>
          <p className="text-[11px] uppercase tracking-widest text-slate-400">Onboard health companion</p>
        </div>

        <label className="text-xs text-slate-400">
          <span className="block uppercase tracking-wider">Mission</span>
          <select
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
            className="mt-0.5 block max-w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm font-semibold text-white"
          >
            {MISSIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          <span className="block uppercase tracking-wider">Mission day</span>
          <input
            type="number"
            min={1}
            max={1200}
            value={day}
            onChange={(e) => setDay(Math.max(1, Math.min(1200, Number(e.target.value) || 1)))}
            className="mt-0.5 w-24 rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm font-semibold tabular-nums text-white"
          />
        </label>
        <Stat label="Gravity" value={mission.gravity} />
        <Stat label="Delay to Earth" value={formatDelay(mission.delaySec)} sub={mission.delayRange} />

        <div className="flex gap-2">
          <button
            onClick={() => setSimulate((s) => !s)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              simulate ? 'border-sky-400 bg-sky-400/20 text-sky-200' : 'border-white/15 text-slate-300 hover:bg-white/10'
            }`}
          >
            {simulate ? '■ Stop simulation' : '▶ Simulate live feed'}
          </button>
          <button
            onClick={() => (serial.connected ? serial.disconnect() : serial.connect())}
            disabled={!serial.supported}
            title={serial.supported ? 'Connect an Arduino over USB' : 'Web Serial needs Chrome or Edge on a computer'}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
              serial.connected ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200' : 'border-white/15 text-slate-300 hover:bg-white/10'
            }`}
          >
            {serial.connected ? '● Sensor connected' : '🔌 Connect sensor'}
          </button>
          <button
            onClick={() => setLibraryOpen(true)}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
          >
            📚 Science Library
          </button>
        </div>
      </header>

      {/* ---------- overall triage banner ---------- */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border px-4 py-2.5"
        style={{ borderColor: STATUS_COLOR[overall], background: `${STATUS_COLOR[overall]}14` }}
      >
        <span className="text-sm font-bold tracking-widest" style={{ color: STATUS_COLOR[overall] }}>
          ● OVERALL: {STATUS_LABEL[overall]}
        </span>
        <span className="text-sm text-slate-200">
          {flagged.length === 0 ? (
            'All systems within normal range.'
          ) : (
            <>
              Needs attention:{' '}
              {flagged.map((s, i) => (
                <button key={s.id} onClick={() => setSelected(s.id)} className="font-semibold underline decoration-dotted underline-offset-2" style={{ color: STATUS_COLOR[systemStatus[s.id]] }}>
                  {s.name}
                  {i < flagged.length - 1 ? ', ' : ''}
                </button>
              ))}
            </>
          )}
        </span>
        {serial.error && <span className="text-xs text-rose-300">Sensor: {serial.error}</span>}
      </div>

      {/* ---------- main: tiles | body | tiles ---------- */}
      <main className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-[1fr_minmax(300px,400px)_1fr]">
        <div className="order-2 col-span-1 flex min-w-0 flex-col gap-3 lg:order-1">
          {(['bp', 'hr', 'spo2', 'temp', 'glucose'] as VitalKey[]).map(tile)}
        </div>

        <section className="order-1 col-span-2 flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.02] p-3 lg:order-2 lg:col-span-1">
          <p className="mb-1 text-center text-[11px] uppercase tracking-widest text-slate-400">Hover or tap a body part</p>
          <div className="h-[62vh] min-h-[420px] w-full lg:h-[calc(100vh-230px)]">
            <BodyMap statuses={systemStatus} summaries={summaries} selected={selected} onSelect={setSelected} heartRate={values.hr} />
          </div>
        </section>

        <div className="order-3 col-span-1 flex min-w-0 flex-col gap-3">
          {(['sleep', 'mood', 'exercise', 'vision'] as VitalKey[]).map(tile)}
          <VitalTile
            label="Radiation dose"
            value={dose.toFixed(0)}
            unit="mSv est."
            status={radStatus}
            source="sim"
            note={`${dosePct.toFixed(0)}% of career limit`}
            onClick={() => setSelected('radiation')}
          />
        </div>

        {cabin && (
          <div className="order-4 col-span-2 lg:col-span-3">
            <VitalTile
              label="Cabin environment (Arduino)"
              value={cabin.t != null ? cabin.t.toFixed(1) : '—'}
              unit={`°C${cabin.h != null ? ` · ${cabin.h.toFixed(0)}% humidity` : ''}`}
              status={cabinStatus}
              source="live"
              note="NASA-STD-3001 limits: 18–27 °C, 25–75% RH"
            />
          </div>
        )}
      </main>

      <footer className="pb-2 text-center text-[11px] text-slate-500">
        Values tagged SAMPLE or SIMULATED are not real measurements. CrewPulse supports self-assessment and does not diagnose. Not affiliated with NASA.
      </footer>

      {selected && (
        <SystemPanel
          system={SYSTEM_BY_ID[selected]}
          status={systemStatus[selected]}
          values={values}
          action={actionFor(systemStatus[selected], mission.delaySec)}
          onEdit={setEditing}
          onClose={() => setSelected(null)}
          extra={
            selected === 'radiation' ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wider text-slate-400">Estimated cumulative dose</p>
                <p className="text-3xl font-bold tabular-nums" style={{ color: STATUS_COLOR[radStatus] }}>
                  {dose.toFixed(0)} <span className="text-sm font-normal text-slate-400">mSv</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, dosePct)}%`, background: STATUS_COLOR[radStatus] }} />
                </div>
                <p className="mt-2 text-xs leading-snug text-slate-400">
                  Day {day} × ~{mission.doseRate} mSv/day = {dosePct.toFixed(0)}% of the {CAREER_LIMIT_MSV} mSv career limit (NASA-STD-3001 Vol 1). Simulated
                  estimate from a published average dose rate — a real mission reads the personal dosimeter.
                  <br />
                  <span className="text-slate-500">Dose rate: {mission.doseNote}</span>
                </p>
              </div>
            ) : undefined
          }
        />
      )}

      {libraryOpen && <ScienceLibrary onClose={() => setLibraryOpen(false)} />}

      {editing && (
        <EditVitalModal
          def={VITAL_BY_KEY[editing]}
          values={values}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            patch(p, 'manual')
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-xs text-slate-400">
      <span className="block uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
      {sub && <span className="ml-1 text-[10px] text-slate-500">{sub}</span>}
    </div>
  )
}
