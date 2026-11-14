// What the crew is shown when a radiation storm is in progress, recent or forecast. Operational wording only, each
// line quoted from NOAA or NASA; AURA does not turn an event into a dose and does not give medical advice here.
import type { Status } from '../../data/vitals'
import type { RadiationStorm } from './derive'
import { formatUtc } from './derive'
import { scaleLevel, scaleName } from './explain'
import { REF, type Citation } from './refs'

export type AdvisoryLine = { text: string; source: Citation }
export type AdvisoryContent = { tone: Status | 'info'; title: string; lead: string; lines: AdvisoryLine[]; limits: string }

/** Always shown with an advisory: what AURA does not do. */
export const AURA_LIMITS =
  'AURA does not measure or estimate the radiation dose from this event. The cumulative dose on this page is a simple mission-profile model (published average dose rate × mission day) and does not change with space weather. Onboard dosimeters and the ground radiation team decide on shelter and spacewalks.'

const SHELTER: AdvisoryLine = { text: '“Radiation alerting provides an additional layer of protection to limit exposure to SPEs (early warning allows for crew to safe vehicle and configure shelter).”', source: REF.ochmoShelter }
const EVA: AdvisoryLine = { text: '“Real-time alert dosimetry also provides a very high level of protection for EVAs if termination occurs within 2 hours and there is access to shielding.”', source: REF.ochmoShelter }
const SEEK: AdvisoryLine = { text: '“Shielding, monitoring, accurate event determination, dosimetry, and timely reporting to alert crew to seek shelter are essential for crew safety.”', source: REF.ochmoCountermeasures }
const ALARA: AdvisoryLine = { text: '“Implementing ALARA is the primary basis for real-time radiological support, and understanding and minimizing exposures from space weather events is a key to that implementation.”', source: REF.srag }
const DEFINITION: AdvisoryLine = { text: 'A radiation storm starts when “the flux of protons at energies ≥ 10 MeV equals or exceeds 10 proton flux units”.', source: REF.noaaRadiationStorm }

/** Null when nothing needs saying. */
export function advisoryFor(s: RadiationStorm): AdvisoryContent | null {
  if (s.advisory === 'none') return null
  const drill = s.drill ? 'Drill — simulated: ' : ''
  if (s.advisory === 'severe' || s.advisory === 'storm') {
    const lvl = scaleLevel('S', s.level)
    const noaa: AdvisoryLine = { text: `NOAA, level ${scaleName('S', s.level)}: “${lvl?.effect ?? ''}”`, source: REF.noaaScales }
    return {
      tone: s.advisory === 'severe' ? 'crit' : 'warn',
      title: `${drill}Solar radiation storm ${scaleName('S', s.level)} in progress`,
      lead:
        s.basis === 'drill'
          ? 'This is a practice alert. No real event is happening.'
          : s.basis === 'goes-flux'
            ? `GOES ≥ 10 MeV proton flux ${s.latestFlux ? `${formatFlux(s.latestFlux.flux)} pfu at ${formatUtc(s.latestFlux.t)}` : ''} (NOAA).`
            : 'Current level on the NOAA Space Weather Scales.',
      lines: s.advisory === 'severe' ? [noaa, SHELTER, EVA, ALARA] : [noaa, SHELTER, SEEK],
      limits: AURA_LIMITS,
    }
  }
  // watch: recent SEP, or NOAA forecast chance at/above the demo threshold
  if (s.recentSep) {
    return {
      tone: 'warn',
      title: 'Solar energetic particle event recorded',
      lead: `NASA DONKI logged a solar energetic particle event at ${formatUtc(s.recentSep.time)}. NOAA radiation-storm level now: ${scaleName('S', s.level)}.`,
      lines: [DEFINITION, SEEK],
      limits: AURA_LIMITS,
    }
  }
  const top = s.forecast.reduce<{ date: string; prob: number } | null>((a, b) => (b.prob > (a?.prob ?? -1) ? b : a), null)
  return {
    tone: 'info',
    title: 'Radiation storm possible',
    lead: top ? `NOAA gives a ${top.prob} % chance of a radiation storm of S1 or greater on ${top.date}. AURA shows this note from 25 % (demo threshold).` : 'NOAA forecasts a possible radiation storm.',
    lines: [DEFINITION, SHELTER],
    limits: AURA_LIMITS,
  }
}

export function formatFlux(pfu: number): string {
  if (pfu >= 100) return Math.round(pfu).toLocaleString('en-US')
  if (pfu >= 1) return pfu.toFixed(1)
  return pfu.toPrecision(2)
}
