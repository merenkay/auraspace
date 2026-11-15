// Jury demo mode: the tour itself, as data. Eight chapters, about three minutes at 1× speed.
// Every step drives the real app inside the sandbox: the numbers, alerts, plans and sources on screen are
// produced by the app's own rules from simulated readings; nothing shown is a mock-up.
//
// Targets prefer selectors that already exist in the pages (ids, roles, aria-labels, visible text). Optional
// steps point at `data-demo="…"` attributes of features that may or may not be in the build; they are skipped
// when the element is missing. The attribute names are listed in OPTIONAL_TARGETS below.
import type { Action, Chapter, Script, Scene, Step, Target } from './types'

/** `data-demo` attributes the optional steps look for. */
export const OPTIONAL_TARGETS = {
  earlyWarning: '[data-demo="early-warning"]',
  cabinLink: '[data-demo="cabin-link"]',
  spaceWeather: '[data-demo="space-weather"]',
} as const

/** Shown on the closing card. `team` is left empty until the team sets its name. */
export const CLOSING = {
  project: 'AURA — Full Body Diagnostics',
  tagline: 'Your health, wherever help is far away.',
  team: 'Team Son KargaBurunlar',
  event: 'NASA Space Apps Challenge 2026',
}

const okafor = (route: string): Scene => ({ persona: 'okafor', route })
const reyes = (route: string): Scene => ({ persona: 'reyes', route })

const OVERVIEW = '/crew/:id'

/** A stable hook first (if the page ever gets one), then what exists today. */
const or = (...t: Target[]): Target => t.flatMap((x) => (Array.isArray(x) ? x : [x]))

const button = (text: string): Target => ({ css: 'button', text, exact: true })
const ALERTS: Target = '[aria-label="Alerts"]'
const VIEWER: Target = or('[data-viewer="3d"]', '[data-demo="body"]', { css: 'a', text: 'BodyParts3D', closest: '.overflow-hidden' })

/** Each chapter opens with a title card; the page behind it changes while the card is up. */
function chapter(number: number, id: string, title: string, subtitle: string, scene: Scene, steps: Step[], cardMs = 2400): Chapter {
  const card: Step = { id: `${id}.title`, caption: subtitle, duration: cardMs, card: { kind: 'chapter', number, title, subtitle } }
  return { id, title, subtitle, scene, steps: [card, ...steps] }
}

const startSimulation: Action = { type: 'click', target: button('Simulate'), unless: button('Stop simulation') }

export const SCRIPT: Script = {
  chapters: [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'problem',
      title: 'Far from help',
      subtitle: 'On the way to Mars, a doctor is minutes away at the speed of light.',
      scene: okafor(OVERVIEW),
      steps: [
        {
          id: 'problem.delay',
          card: { kind: 'delay' },
          caption: 'On the way to Mars, a radio signal needs between 3 and 22 minutes to reach Earth. The answer needs just as long to come back.',
          duration: 8000,
          cue: 'open',
        },
        {
          id: 'problem.promise',
          card: { kind: 'promise' },
          caption: 'So the first response has to work on board, with no connection. AURA is health monitoring built on fixed rules and published sources.',
          duration: 7000,
        },
        {
          id: 'problem.mission',
          optional: true,
          timeout: 2500,
          target: { css: 'dl', text: 'Earth delay' },
          callout: { title: 'Mission facts', text: 'Every piece of advice in the app takes this delay into account.' },
          caption: 'The simulated crew is on day 142 of a Mars transit, 14 minutes from Earth.',
          duration: 4500,
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    chapter(2, 'daily', 'The daily picture', 'How am I today? Does anything need me?', okafor(OVERVIEW), [
      {
        id: 'daily.score',
        target: or('[data-demo="score"]', { css: 'p', text: 'Health score', exact: true, closest: '.rounded-2xl' }),
        callout: { title: 'Health score', text: '100 minus fixed points for each current reading out of range, shown only when enough data is current. Every point can be explained.' },
        caption: 'Commander Okafor starts her day. Her health score is plain arithmetic on her latest readings, not a guess.',
        duration: 5500,
        cue: 'select',
      },
      {
        id: 'daily.alerts',
        target: ALERTS,
        callout: { title: 'Alerts', text: 'They appear at once, each with the next step in plain words.' },
        caption: 'Two readings need attention: blood pressure and sleep. The screen stays quiet until something needs her.',
        duration: 5000,
      },
      {
        id: 'daily.early',
        optional: true,
        target: OPTIONAL_TARGETS.earlyWarning,
        callout: { title: 'Early warning', text: 'Looks at the direction of the readings, not only at the limits.' },
        caption: 'Early warning follows the trend behind the numbers: a slow rise is flagged before a limit is crossed.',
        duration: 5300,
      },
      {
        id: 'daily.body',
        // Phones fold the 3D body on the Overview: open it first (no toggle on wider screens, so it is skipped fast).
        before: [{ type: 'set', target: '[data-demo="body-toggle"]', on: true, timeout: 400 }],
        target: VIEWER,
        callout: { title: '3D body', text: 'A real anatomy model. A system takes a colour only when it needs attention.' },
        caption: 'The same status, organ system by organ system, on a 3D model she can turn and open.',
        duration: 5000,
      },
      {
        id: 'daily.heart',
        before: [{ type: 'select-system', system: 'heart' }],
        target: or({ css: '[role="dialog"] div', text: 'reply from Earth', closest: '.rounded-xl' }, '[role="dialog"]'),
        callout: { title: 'Delay-aware advice', text: 'Mars transit: a reply from Earth takes at least 28 minutes.' },
        caption: 'She selects the heart. AURA tells her what to do first, and that she should not wait for Earth to answer.',
        duration: 6500,
        cue: 'select',
      },
    ]),

    /* ------------------------------------------------------------------ 3 */
    chapter(3, 'trend', 'Caught early', 'A slow rise, noticed before it is dangerous.', okafor('/crew/:id/diagnostics'), [
      {
        id: 'trend.xray',
        before: [{ type: 'select-system', system: 'heart' }],
        target: VIEWER,
        callout: { title: 'X-ray view', text: 'Fades the other layers so the selected system stays visible.' },
        during: [
          { type: 'wait', ms: 1900 },
          { type: 'set', target: button('X-ray'), on: false },
          { type: 'wait', ms: 1400 },
          { type: 'set', target: button('X-ray'), on: true },
        ],
        caption: 'Diagnostics isolates one system. With X-ray on, the heart and vessels stay visible through the body.',
        duration: 6500,
      },
      {
        id: 'trend.chart',
        target: or('[data-demo="trend"]', { css: '.recharts-wrapper', closest: '.rounded-xl' }, '.recharts-wrapper'),
        callout: { title: 'Blood pressure, 30 days', text: 'Dashed line: her own baseline. Coloured dots: readings above the normal range.' },
        caption: 'Thirty days of readings from her blood-pressure cuff. For three weeks the upper value has climbed away from her baseline.',
        duration: 6500,
      },
      {
        id: 'trend.reading',
        target: or('[data-demo="vital-bp"]', { css: 'button[aria-pressed]', text: 'Blood pressure' }),
        callout: { title: 'A new reading', text: 'The rules run again the moment it arrives.' },
        during: [
          { type: 'wait', ms: 1300 },
          { type: 'reading', key: 'okafor-bp-morning', values: { sys: 139, dia: 88 }, device: 'Omron BP monitor' },
          { type: 'sfx', name: 'confirm' },
        ],
        caption: 'This morning’s measurement arrives: 139 over 88. Still attention, not yet urgent, and she already knows what to do.',
        duration: 6000,
      },
    ]),

    /* ------------------------------------------------------------------ 4 */
    chapter(
      4,
      'emergency',
      'An emergency',
      'Chest pain, 14 light-minutes from Earth.',
      reyes('/crew/:id/aura'),
      [
        {
          id: 'emergency.describe',
          rewind: false,
          target: { css: '#aura-compose', closest: 'form' },
          during: [
            { type: 'wait', ms: 900 },
            { type: 'type', target: '#aura-compose', text: 'I have a tight pain in my chest', cps: 20, submit: true },
          ],
          caption: 'He types it in his own words. Keyword rules on the device find the symptom: no language model.',
          duration: 5500,
        },
        {
          id: 'emergency.question',
          rewind: false,
          // the newest message: the follow-up question with the engine's reason for asking it
          target: or({ css: '[role="log"] > div', text: 'Safety check' }, '[role="log"]'),
          callout: { title: 'Safety check', text: 'The engine asks the one question that can complete a red-flag rule.', prefer: 'above' },
          during: [
            { type: 'wait', ms: 2800 },
            { type: 'click', target: { css: '[role="group"][aria-label="Answer"] button', text: 'Yes', exact: true } },
            { type: 'waitFor', target: '#main [role="alert"]', timeout: 4000 },
          ],
          caption: 'One focused follow-up: does the pain spread to the arm or jaw? He answers yes.',
          duration: 4600,
        },
        {
          id: 'emergency.alert',
          rewind: false,
          target: '#main [role="alert"]',
          caption: 'Emergency. A fixed rule raised this alert the moment both signs were present.',
          duration: 4000,
          cue: 'alarm',
        },
        {
          id: 'emergency.first',
          target: or({ css: '#main ol > li', text: 'reply from Earth' }, '#main ol > li'),
          callout: { title: 'First step', text: 'Written for where he is: a reply from Earth takes at least 28 minutes.' },
          caption: 'The first step knows where he is: alert the crew, start the onboard procedure, and do not wait for Earth.',
          duration: 6000,
        },
        {
          id: 'emergency.aspirin',
          target: or({ css: 'article', text: 'Aspirin' }),
          callout: { title: 'Checked against his profile', text: 'His record lists an aspirin allergy.' },
          caption: 'Before suggesting a medicine, AURA reads his health profile. He is allergic to aspirin, so that step is withheld.',
          duration: 5800,
        },
        {
          id: 'emergency.air',
          optional: true,
          target: OPTIONAL_TARGETS.cabinLink,
          callout: { title: 'Cabin air', text: 'Sensor readings add context. They never lower the urgency.' },
          caption: 'AURA also checks what the cabin sensors measured, because the air can be part of the cause.',
          duration: 5000,
        },
      ],
    ),

    /* ------------------------------------------------------------------ 5 */
    chapter(5, 'air', 'The cabin is part of the patient', 'A sensor station watches the cabin air.', reyes('/environment'), [
      {
        id: 'air.station',
        rewind: false,
        before: [startSimulation],
        target: or('[data-demo="env-readouts"]', { css: '[role="group"]', text: 'Flammable gas', closest: '.grid' }),
        callout: { title: 'Simulated for this tour', text: 'On stage the same panel reads a live Arduino kit over USB.' },
        caption: 'Temperature, humidity and flammable gas, once a second. Simulated for this tour, and labelled as such.',
        duration: 5000,
      },
      {
        id: 'air.leak',
        rewind: false,
        target: or('[data-demo="env-gas"]', { css: '[role="group"]', text: 'Flammable gas' }),
        callout: { title: 'Gas, relative to clean air', text: 'Attention at 1.5 times the baseline, alarm at 2 times (demo thresholds).' },
        // The simulated leak crosses the alarm level about five seconds after it starts; this step ends just before.
        during: [
          { type: 'wait', ms: 700 },
          { type: 'click', target: button('Simulate gas leak') },
          { type: 'wait', ms: 3400 },
        ],
        caption: 'A leak begins. The reading climbs past the attention mark, towards twice its clean-air baseline.',
        duration: 6000,
      },
      {
        id: 'air.alarm',
        rewind: false,
        before: [{ type: 'waitFor', target: { css: '[role="alert"]', text: 'gas alarm' }, timeout: 14000 }],
        target: { css: '[role="alert"]', text: 'gas alarm' },
        caption: 'The alarm appears at once and stays until the air is clear. Each step to take carries its source.',
        duration: 6500,
        cue: 'alarm',
      },
      {
        id: 'air.weather',
        optional: true,
        target: OPTIONAL_TARGETS.spaceWeather,
        callout: { title: 'Space weather', text: 'NASA and NOAA alerts. The tour shows the copy saved on the device.' },
        caption: 'Outside the hull: solar activity from NASA and NOAA, shown beside the crew’s radiation dose.',
        duration: 5000,
      },
    ]),

    /* ------------------------------------------------------------------ 6 */
    chapter(6, 'coach', 'Staying strong without gravity', 'A personal programme against muscle and bone loss.', okafor('/crew/:id/coach'), [
      {
        id: 'coach.focus',
        target: or('[data-demo="coach-focus"]', { css: 'div', text: 'Suggested focus', closest: '.rounded-xl' }, { css: 'h1', text: 'Your programme', closest: 'header' }),
        callout: { title: 'Built from her data', text: 'Mission day, readings, health profile and the latest assessment.' },
        caption: 'Day 142 without gravity. The coach proposes a programme against muscle and bone loss, and adds her blood pressure.',
        duration: 6000,
      },
      {
        id: 'coach.safety',
        target: or('[data-demo="coach-safety"]', { css: 'h3', text: 'Changed for your safety', closest: 'div' }, { css: 'section', text: 'Before you train' }),
        callout: { title: 'Restrictions come first', text: 'AURA never raises a load on its own.' },
        caption: 'Safety comes before training. Because her blood pressure is raised, effort is capped at 6 out of 10.',
        duration: 6000,
      },
      {
        id: 'coach.session',
        target: or('[data-demo="coach-session"]', { css: 'section', text: 'Today’s session' }, { css: 'section', text: 'Next session' }),
        caption: 'Each session lists the exercises for the onboard machines, with the dose and how to do each one.',
        duration: 5500,
      },
    ]),

    /* ------------------------------------------------------------------ 7 */
    chapter(7, 'earth', 'The same gap exists on Earth', 'Far from a hospital is not only space.', { persona: 'polar', route: OVERVIEW }, [
      {
        id: 'earth.polar-fact',
        card: { kind: 'context', context: 'polar' },
        caption: 'At Concordia station in Antarctica, crews are cut off for almost nine months a year.',
        duration: 4500,
      },
      {
        id: 'earth.polar',
        target: ALERTS,
        callout: { title: 'Polar station profile', text: 'Same rules. The care contact is now the station doctor.' },
        caption: 'The same system for a winter-over crew member. Short sleep and low mood are flagged before they become a crisis.',
        duration: 6000,
      },
      {
        id: 'earth.home-fact',
        scene: { persona: 'home', route: OVERVIEW },
        card: { kind: 'context', context: 'home' },
        caption: 'At home, an estimated 44 percent of adults with high blood pressure do not know it.',
        duration: 4800,
      },
      {
        id: 'earth.home',
        scene: { persona: 'home', route: OVERVIEW },
        target: ALERTS,
        callout: { title: 'Home care profile', text: 'Plain words, and a report she can hand to her doctor.' },
        caption: 'For Nermin, 72, living at home: raised blood pressure and too little water, each with one clear next step.',
        duration: 6000,
      },
    ]),

    /* ------------------------------------------------------------------ 8 */
    chapter(8, 'trust', 'Why it can be trusted', 'No black box near a medical decision.', okafor('/crew/:id/coach'), [
      {
        id: 'trust.sources',
        before: [{ type: 'set', target: { css: 'button[aria-expanded]', text: 'How this plan was built' }, on: true }],
        target: or('[data-demo="source-quote"]', { css: '[data-open="true"] li', text: '“' }),
        callout: { title: 'Source and quote', text: 'The sentence the rule is based on, in the source’s own words.' },
        caption: 'Every rule is shown with its source and the sentence it rests on. AURA’s own modelling choices are labelled as such.',
        duration: 6500,
      },
      {
        id: 'trust.principles',
        card: { kind: 'principles' },
        caption: 'No AI model decides anything medical: fixed rules, published sources, offline first, and data that stays with the person.',
        duration: 7000,
      },
      {
        id: 'trust.closing',
        card: { kind: 'closing' },
        caption: 'AURA: your health, wherever help is far away.',
        duration: 4000,
        manual: true,
        cue: 'done',
      },
    ]),
  ],
}
