// What to do when the gas alarm fires, per user context. Every sourced step was checked against the
// page it cites (fetched Nov 2026); quotes are verbatim. A step with no source would be shown as
// "common-sense step — no official source" (none needed so far).
import type { Context } from '../../data/contexts'

export type GuidanceSource = { org: string; title: string; url: string; quote: string }
export type GuidanceStep = { text: string; sources: GuidanceSource[] }
export type Guidance = { heading: string; intro: string; steps: GuidanceStep[]; note: string }

const NASA_ISS = {
  org: 'NASA Johnson Space Center',
  title: 'Tobias & McMillan (SpaceOps 2023): Evolution of Hardware and Philosophy of Emergency Response Actions on the International Space Station',
  url: 'https://ntrs.nasa.gov/citations/20220019247',
}
const HSE = { org: 'UK Health and Safety Executive (HSE)', title: 'Gas safety – Home owners / occupiers', url: 'https://www.hse.gov.uk/gas/domestic/faqownerocc.htm' }
const SGN = { org: 'SGN (UK gas network operator)', title: 'What to do if you smell gas', url: 'https://sgn.co.uk/smellgas' }
const GAZBIR = { org: 'GAZBİR (Natural Gas Distributors Association of Turkey)', title: '187 – Natural Gas Emergency', url: 'https://gazbir.org.tr/en/187-natural-gas-emergency/175' }
const AAD = {
  org: 'Australian Antarctic Division',
  title: 'Fire prevention at Antarctic stations',
  url: 'https://www.antarctica.gov.au/antarctic-operations/stations/amenities-and-operations/fire-prevention/',
}

const cite = (s: Omit<GuidanceSource, 'quote'>, quote: string): GuidanceSource => ({ ...s, quote })

const NO_SPARKS: GuidanceStep = {
  text: 'Do not touch light or appliance switches, and do not smoke or use any flame.',
  sources: [cite(SGN, 'Turning a switch on or off could ignite a gas leak.')],
}
const VENTILATE: GuidanceStep = { text: 'Open all doors and windows to let the gas out.', sources: [cite(HSE, 'Open all the doors and windows')] }
const SHUT_OFF: GuidanceStep = {
  text: 'If you can reach it safely, turn off the gas at the meter valve and on your appliances.',
  sources: [cite(HSE, 'Shut off the gas supply at the meter control valve (if you know where it is)')],
}
const CALL: GuidanceStep = {
  text: 'Leave and call the gas emergency line from a place where you cannot smell gas — Turkey: 187, United Kingdom: 0800 111 999.',
  sources: [cite(GAZBIR, 'Gas odour in the dwelling'), cite(HSE, "Call National Grid's Gas Emergency Freephone number: 0800 111 999")],
}

export const GAS_GUIDANCE: Record<Context, Guidance> = {
  space: {
    heading: 'Spacecraft: Warn, Gather, Work',
    intro: 'How NASA trains ISS crews to respond to fire, smoke and toxic air. AURA’s hobby sensor is only an early hint — the vehicle’s own alarms and procedures lead.',
    steps: [
      { text: 'WARN — raise the vehicle alarm so every crewmember and Mission Control knows.', sources: [cite(NASA_ISS, 'Initiating the alarm serves to warn all onboard crew and all ground teams')] },
      {
        text: 'GATHER — everyone goes to the agreed gathering point, with breathable air and a clear path to the return vehicle.',
        sources: [cite(NASA_ISS, 'After annunciating the alarm, all the crew make their way to a designated point within the ISS.')],
      },
      { text: 'Check the air at the gathering point with the hand-held combustion-product analyzer.', sources: [cite(NASA_ISS, 'They will constantly monitor air quality using hand-held combustion product analyzers')] },
      {
        text: 'WORK — put on breathing masks before going toward the source, then remove power from the suspected equipment.',
        sources: [cite(NASA_ISS, 'Upon identifying the locations to investigate, crew will don breathing masks')],
      },
      {
        text: 'If it does not stop, or you do not feel safe, close off the module and step back.',
        sources: [cite(NASA_ISS, 'it is their prerogative to isolate the module and stand down on any further fire response steps')],
      },
    ],
    note: 'The source describes ISS practice; other vehicles have their own procedures.',
  },
  polar: {
    heading: 'Remote station: alert, muster, no sparks, fresh air',
    intro: 'No official polar guidance for gas leaks was found. Steps 1–2 come from Antarctic station fire rules; steps 3–5 are general household gas-leak advice.',
    steps: [
      { text: 'Follow your station’s own emergency orders and tell the station leader.', sources: [cite(AAD, 'Each station has its own set of fire orders.')] },
      {
        text: 'If you are not on the emergency response team, go to the designated muster area.',
        sources: [cite(AAD, 'At the sound of a fire alarm in any building, all people not on the emergency response team muster at a designated area')],
      },
      NO_SPARKS,
      VENTILATE,
      SHUT_OFF,
    ],
    note: 'Gas-leak steps are household guidance from the UK, used because no station-specific source was found.',
  },
  home: {
    heading: 'At home: no sparks, fresh air, gas off, get out and call',
    intro: 'Official gas-safety advice for homes.',
    steps: [NO_SPARKS, VENTILATE, SHUT_OFF, CALL],
    note: 'Emergency numbers differ by country — check yours.',
  },
}

export const SENSOR_HONESTY =
  'This low-cost sensor is not a certified gas or carbon-monoxide alarm and does not measure ppm. It reacts to several flammable gases, so a high reading is a reason to check, not proof of a leak.'

const MQ2 = { org: 'Hanwei Electronics', title: 'MQ-2 gas sensor datasheet (hosted by Pololu)', url: 'https://www.pololu.com/file/0J309/MQ2.pdf' }

/** What the MQ-2 reacts to. */
export const MQ2_GASES = cite(MQ2, 'High sensitivity to LPG, Propane and Hydrogen')
/** The datasheet's standard test condition; our 2-minute warm-up is a demo choice, not this. */
export const MQ2_PREHEAT = cite(MQ2, 'Preheat time Over 48 hours')
