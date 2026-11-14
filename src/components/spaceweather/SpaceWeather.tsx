import { FlaskConical, RefreshCw } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { Context } from '../../data/contexts'
import {
  AURA_LIMITS,
  FORECAST_WATCH_PCT,
  REF,
  SOURCE_KEYS,
  flareInfo,
  formatUtc,
  gFromKp,
  scaleLevel,
  scaleName,
  useSpaceWeather,
  type AdvisoryContent,
  type SourceKey,
  type SpaceWeatherView,
} from '../../lib/spaceWeather'
import { Badge, Button, Metric, Notice, Section, Skeleton, SourceLink } from '../ui'
import ClassGuide from './ClassGuide'
import EventTimeline from './EventTimeline'
import { Fold, OriginBadge, Quote, ago, originSentence } from './parts'

const ProtonChart = lazy(() => import('./ProtonChart'))

const FEED_NAME: Record<SourceKey, string> = {
  flr: 'Solar flares — NASA DONKI FLR',
  sep: 'Solar energetic particles — NASA DONKI SEP',
  cme: 'Coronal mass ejections with analyses — NASA DONKI CME',
  gst: 'Geomagnetic storms — NASA DONKI GST',
  notifications: 'Notifications — NASA DONKI',
  scales: 'Space weather scales — NOAA SWPC',
  protons: 'GOES ≥ 10 MeV proton flux — NOAA SWPC',
}

/** Space-weather section for the Environment page. Space: full panel. Polar: geomagnetic note. Home: nothing. */
export default function SpaceWeather({ context }: { context: Context }) {
  if (context === 'home') return null
  return context === 'polar' ? <PolarSpaceWeather /> : <SpaceSpaceWeather />
}

/* ------------------------------------------------------------------ advisory */

function Advisory({ a }: { a: AdvisoryContent }) {
  return (
    <Notice tone={a.tone} role={a.tone === 'crit' || a.tone === 'warn' ? 'alert' : undefined} title={a.title}>
      <p>{a.lead}</p>
      <ul className="mt-3 space-y-3">
        {a.lines.map((l) => (
          <li key={l.text}>
            <p className="text-soft">{l.text}</p>
            <SourceLink href={l.source.url} org={l.source.org} title={l.source.title} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-ink">What AURA does not do: {a.limits}</p>
      <p className="mt-1 text-xs text-dim">Rule-based display of NOAA / NASA data, not a prediction by AURA.</p>
    </Notice>
  )
}

/* ------------------------------------------------------------------ space */

function SpaceSpaceWeather() {
  const v = useSpaceWeather()
  const { snapshot, fresh, storm, cond, model, advisory, drill } = v

  return (
    <div data-demo="space-weather">
      <Section
        title="Space weather — live from NASA DONKI"
        description="Solar flares, particle storms and coronal mass ejections from NASA's space weather database, with NOAA's radiation-storm scale."
        action={snapshot && fresh ? <OriginBadge snapshot={snapshot} fresh={fresh} /> : undefined}
      >
        {!snapshot || !fresh || !storm || !cond || !model ? (
          <div className="grid gap-6 sm:grid-cols-3" aria-busy="true">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="space-y-6">
            {advisory && <Advisory a={advisory} />}

            <div className="grid gap-6 sm:grid-cols-3">
              <Metric
                label="Radiation storm · NOAA S-scale"
                value={storm.level == null ? null : storm.level === 0 ? 'None' : `S${storm.level}`}
                status={storm.status}
                hint={
                  storm.drill
                    ? 'simulated drill'
                    : storm.level == null
                      ? storm.lastKnown != null
                        ? `last known ${storm.lastKnown === 0 ? 'none' : `S${storm.lastKnown}`} · ${ago(fresh.ageMs)}`
                        : 'no current reading'
                      : storm.level === 0
                        ? storm.maxForecastProb != null
                          ? `chance of S1+ next days: up to ${storm.maxForecastProb} %`
                          : 'no storm now'
                        : scaleName('S', storm.level)
                }
              />
              <Metric
                label="Strongest flare · 7 days"
                value={cond.topFlare?.cls ?? (model.fetched.flr != null ? 'None' : null)}
                hint={
                  cond.topFlare
                    ? `peak ${formatUtc(cond.topFlare.peak ?? cond.topFlare.begin)}${(flareInfo(cond.topFlare.cls)?.r ?? 0) > 0 ? ` · radio blackout R${flareInfo(cond.topFlare.cls)!.r}` : ''}`
                    : model.fetched.flr != null
                      ? 'no flare recorded'
                      : 'no data'
                }
              />
              <Metric
                label="Geomagnetic storm · NOAA G-scale"
                value={cond.g == null ? null : cond.g === 0 ? 'None' : `G${cond.g}`}
                hint={cond.g == null ? 'no current reading' : cond.g === 0 ? 'Kp below 5' : scaleName('G', cond.g)}
              />
            </div>

            <p className="max-w-prose text-sm text-soft">
              <span className="font-medium text-ink">Conditions: {cond.label}</span>
              {cond.reasons.length ? ` — ${cond.reasons.join('; ')}.` : cond.level === 'quiet' ? ' — no M- or X-class flares, particle events or Earth-directed CMEs in the last 24 h.' : '.'}
              {fresh.asOf !== v.now && ` As of ${formatUtc(fresh.asOf)}.`}
            </p>

            <div>
              <Fold
                id="sw.events"
                title="Recent events"
                meta={`${v.events.filter((e) => !e.simulated).length} in 7 days`}
                summary={cond.topFlare ? `Strongest flare ${cond.topFlare.cls}; links to each event in DONKI` : 'Flares, particle events, CMEs and geomagnetic storms'}
              >
                <EventTimeline events={v.events} hiddenCmes={v.hiddenCmes} />
              </Fold>
              <Fold id="sw.protons" title="Proton flux, last 24 h" meta="NOAA GOES" summary="What flight controllers watch for radiation storms">
                <Suspense fallback={<Skeleton className="h-56" />}>
                  <ProtonChart points={model.protons} />
                </Suspense>
              </Fold>
              <Fold id="sw.notices" title="Latest DONKI notifications" meta={String(model.notices.length)}>
                <Notifications view={v} />
              </Fold>
              <Fold id="sw.guide" title="What the classes mean" summary="Flare classes A–X, NOAA radiation-storm scale S1–S5, CME types">
                <ClassGuide sLevel={storm.drill ? 3 : storm.level} gLevel={cond.g} />
              </Fold>
              <Fold id="sw.about" title="About this data" summary="Sources, update times, and what AURA does not do">
                <About view={v} />
              </Fold>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button size="sm" variant="secondary" icon={FlaskConical} aria-pressed={drill} onClick={() => v.setDrill(!drill)}>
                {drill ? 'End storm drill' : 'Run storm drill'}
              </Button>
              {drill && (
                <Badge icon={FlaskConical} className="border-dashed border-soft text-ink">
                  Simulated · not real data
                </Badge>
              )}
              <span className="text-sm text-dim">Shows what the radiation-storm alert looks like. Real data and the dose figure are not changed.</span>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

function Notifications({ view }: { view: SpaceWeatherView }) {
  const list = view.model?.notices.slice(0, 4) ?? []
  if (!list.length) return <p className="text-sm text-dim">No DONKI notifications in this 7-day window.</p>
  return (
    <ul className="space-y-4">
      {list.map((n) => (
        <li key={n.id}>
          <p className="text-sm">
            <span className="font-medium text-ink">{n.type}</span> <span className="font-mono text-xs text-dim">{formatUtc(n.issued)}</span>
          </p>
          <p className="mt-1 max-w-prose text-sm text-soft">{n.summary || 'No summary in this message.'}</p>
          {n.url && <SourceLink href={n.url} org="NASA DONKI" title={n.id} />}
        </li>
      ))}
    </ul>
  )
}

function About({ view }: { view: SpaceWeatherView }) {
  const { snapshot, fresh, model } = view
  if (!snapshot || !fresh || !model) return null
  return (
    <div className="space-y-5 text-sm">
      <p className="max-w-prose text-soft">{originSentence(snapshot, fresh)}</p>
      <ul className="divide-y divide-line border-y border-line">
        {SOURCE_KEYS.map((k) => {
          const t = model.fetched[k]
          const err = model.errors[k]
          return (
            <li key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 py-2">
              <span className="text-soft">{FEED_NAME[k]}</span>
              <span className="font-mono text-xs text-dim">
                {t == null ? 'not available' : `fetched ${ago(view.now - t)}`}
                {err ? ` · last refresh failed (${err})` : ''}
              </span>
            </li>
          )
        })}
      </ul>
      <div>
        <p className="font-medium text-ink">What AURA does not do</p>
        <p className="mt-1 max-w-prose text-soft">{AURA_LIMITS}</p>
      </div>
      <div>
        <p className="font-medium text-ink">Why it matters to the crew</p>
        <Quote className="mt-1 max-w-prose">“{REF.ochmoCountermeasures.quote}”</Quote>
        <SourceLink href={REF.ochmoCountermeasures.url} org={REF.ochmoCountermeasures.org} title={REF.ochmoCountermeasures.title} />
        <Quote className="mt-2 max-w-prose">“{REF.ochmoEventLimit.quote}”</Quote>
        <SourceLink href={REF.ochmoEventLimit.url} org={REF.ochmoEventLimit.org} title={REF.ochmoEventLimit.title} />
      </div>
      <div>
        <p className="font-medium text-ink">Data</p>
        <Quote className="mt-1 max-w-prose">“{REF.donki.quote}”</Quote>
        <div className="flex flex-wrap gap-x-4">
          <SourceLink href={REF.donki.url} org={REF.donki.org} title="DONKI" />
          <SourceLink href="https://www.spaceweather.gov/" org="NOAA SWPC" title="Space Weather Prediction Center" />
        </div>
        <p className="mt-2 text-dim">
          Thresholds AURA chose for display (demo choices): a copy older than 3 h is shown as out of date; a DONKI particle event in the last 24 h shows as Attention; a NOAA forecast chance of {FORECAST_WATCH_PCT} % or more shows a
          note. Not affiliated with NASA or NOAA.
        </p>
      </div>
      <Button size="sm" variant="quiet" icon={RefreshCw} loading={view.loading} onClick={view.refresh}>
        Check for updates
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ polar */

function PolarSpaceWeather() {
  const v = useSpaceWeather()
  const { snapshot, fresh, cond, model } = v
  const lastStorm = model?.storms[0] ?? null
  const level = scaleLevel('G', cond?.g)
  return (
    <div data-demo="space-weather">
      <Section
        title="Space weather"
        description="Geomagnetic storms can disturb HF radio and satellite navigation and bring aurora. From NOAA SWPC and NASA DONKI."
        action={snapshot && fresh ? <OriginBadge snapshot={snapshot} fresh={fresh} /> : undefined}
      >
        {!snapshot || !fresh || !cond || !model ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <Metric label="Geomagnetic storm now · NOAA G-scale" value={cond.g == null ? null : cond.g === 0 ? 'None' : `G${cond.g}`} hint={cond.g == null ? `no current reading · copy ${ago(fresh.ageMs)}` : cond.g === 0 ? 'Kp below 5' : scaleName('G', cond.g)} />
              <Metric
                label="Last geomagnetic storm · 7 days"
                value={lastStorm?.maxKp != null ? `Kp ${lastStorm.maxKp}` : model.fetched.gst != null ? 'None' : null}
                hint={lastStorm ? `${formatUtc(lastStorm.start)} · ${scaleName('G', gFromKp(lastStorm.maxKp))}` : model.fetched.gst != null ? 'no storm recorded by DONKI' : 'no data'}
              />
            </div>
            <div className="max-w-prose">
              {level ? (
                <>
                  <p className="text-sm font-medium text-ink">NOAA, {scaleName('G', cond.g)}:</p>
                  <Quote className="mt-2">“{level.effect}”</Quote>
                  <SourceLink href={REF.noaaScales.url} org={REF.noaaScales.org} title={REF.noaaScales.title} />
                </>
              ) : (
                <>
                  <Quote>“{REF.noaaGeomagnetic.quote}”</Quote>
                  <SourceLink href={REF.noaaGeomagnetic.url} org={REF.noaaGeomagnetic.org} title={REF.noaaGeomagnetic.title} />
                </>
              )}
            </div>
            <div>
              <Fold id="sw.polar.guide" title="Geomagnetic storm levels" summary="NOAA G1–G5: radio, navigation and aurora">
                <ClassGuide sLevel={null} gLevel={cond.g} showG />
              </Fold>
              <Fold id="sw.polar.about" title="About this data">
                <p className="max-w-prose text-sm text-soft">{originSentence(snapshot, fresh)}</p>
                <Quote className="mt-2 max-w-prose">“{REF.donki.quote}”</Quote>
                <SourceLink href={REF.donki.url} org={REF.donki.org} title="DONKI" />
              </Fold>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

/** One-line status for other pages (space context): e.g. "Space weather: Quiet · no radiation storm · updated 4 min ago". */
export function SpaceWeatherLine({ className }: { className?: string }) {
  const v = useSpaceWeather()
  if (!v.snapshot || !v.storm || !v.cond || !v.fresh) return null
  const radiation = v.storm.drill ? 'simulated storm drill' : v.storm.level == null ? 'radiation storm level unknown' : v.storm.level === 0 ? 'no radiation storm' : `radiation storm ${scaleName('S', v.storm.level)}`
  return (
    <p className={className ?? 'text-sm text-soft'} data-demo="space-weather-line">
      <span className="font-medium text-ink">Space weather:</span> {v.cond.label} · {radiation} · {v.snapshot.origin === 'sample' ? 'saved sample' : `updated ${ago(v.fresh.ageMs)}`}
    </p>
  )
}
