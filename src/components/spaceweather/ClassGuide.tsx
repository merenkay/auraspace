import { CME_TYPE, G_SCALE, REF, S_SCALE, type ScaleLevel } from '../../lib/spaceWeather'
import { SourceLink, cx } from '../ui'
import { Quote } from './parts'

function ScaleTable({ kind, rows, measure, current }: { kind: 'S' | 'G'; rows: ScaleLevel[]; measure: string; current: number | null }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.level} className={cx('grid gap-1 px-2 py-2.5 sm:grid-cols-[8rem_10rem_1fr] sm:gap-4', current === r.level && 'bg-panel2')}>
          <span className="text-[15px] font-medium text-ink">
            {kind}
            {r.level} {r.name}
            {current === r.level && <span className="ml-2 text-sm font-normal text-dim">now</span>}
          </span>
          <span className="font-mono text-xs leading-6 text-dim">
            {measure} {r.threshold}
          </span>
          <span className="text-sm text-soft">{r.effect}</span>
        </li>
      ))}
    </ul>
  )
}

/** Flare classes, the radiation-storm (S) scale and CME types — in NOAA's and NASA's own words. */
export default function ClassGuide({ sLevel, gLevel, showG = false }: { sLevel: number | null; gLevel: number | null; showG?: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">Solar flare classes: A, B, C, M, X</h3>
        <p className="mt-1 max-w-prose text-sm text-soft">
          A flare's class is its peak X-ray brightness measured by NOAA's GOES satellites. Each letter is ten times the one before; the number after it is a multiplier (M2 is twice M1).
        </p>
        <Quote className="mt-2 max-w-prose">“{REF.nasaFlares.quote}”</Quote>
        <div className="mt-1 flex flex-wrap gap-x-4">
          <SourceLink href={REF.nasaFlares.url} org={REF.nasaFlares.org} title={REF.nasaFlares.title} />
          <SourceLink href={REF.noaaFlares.url} org={REF.noaaFlares.org} title={REF.noaaFlares.title} />
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-ink">Radiation storms: NOAA S-scale</h3>
        <p className="mb-2 mt-1 max-w-prose text-sm text-soft">Measured as the flux of protons above 10 MeV. The effect column is NOAA's own text for people.</p>
        <ScaleTable kind="S" rows={S_SCALE} measure="≥ 10 MeV" current={sLevel} />
        <SourceLink className="mt-1" href={REF.noaaScales.url} org={REF.noaaScales.org} title={REF.noaaScales.title} />
      </div>

      {showG && (
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Geomagnetic storms: NOAA G-scale</h3>
          <p className="mb-2 mt-1 max-w-prose text-sm text-soft">Measured with the planetary Kp index (0–9). The effect column is NOAA's text on radio, navigation and aurora.</p>
          <ScaleTable kind="G" rows={G_SCALE} measure="" current={gLevel} />
          <SourceLink className="mt-1" href={REF.noaaScales.url} org={REF.noaaScales.org} title={REF.noaaScales.title} />
        </div>
      )}

      <div>
        <h3 className="text-[15px] font-semibold text-ink">Coronal mass ejection types</h3>
        <p className="mt-1 max-w-prose text-sm text-soft">DONKI types each CME by its speed (SCORE scale):</p>
        <ul className="mt-1 text-sm text-soft">
          {Object.values(CME_TYPE).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <SourceLink className="mt-1" href={REF.donkiScore.url} org={REF.donkiScore.org} title={REF.donkiScore.title} />
      </div>
    </div>
  )
}
