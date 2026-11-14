// What AURA says in everyday conversation. Pure: every input (time, mission, sensor reading, today's plan)
// is passed in, so replies are deterministic and testable. Warm, concise, lightly witty, honest about being a
// rule-based assistant, and it never gives medical judgement here: health questions go to the rule engines.
import type { Context } from '../../data/contexts'
import { CAREER_LIMIT_MSV, CABIN_LIMITS, MISSIONS } from '../../data/missions'
import { radiation } from '../health'
import type { Role } from '../types'
import { calculate, convert, type ChatIntent, type Feeling, type Unit } from './chat'
import { vary, type Memory, type Offer } from './memory'

export type EnvSnapshot = {
  label: string
  t: number | null
  h: number | null
  gas: 'ok' | 'warn' | 'crit' | 'none'
  ageMin: number
  simulated: boolean
  /** Environment-aware brief for "is it the air?" (src/lib/cabinLink/envDx.ts environmentBrief), when available. */
  brief?: string | null
  /** The reading is live from the connected sensor. */
  live?: boolean
}

export type ChatCtx = {
  now: Date
  /** How to address the person (their chosen name, rank, "Doctor"), or null. */
  address: string | null
  role: Role | null
  context: Context
  mission: { day: number; totalDays: number | null; profileId: string; name: string } | null
  /** Latest environment-station reading (weather / cabin questions); null = none stored. */
  env?: EnvSnapshot | null
  /** Today's coach sentence and checklist (today / reminders). */
  today?: { coach: string | null; tasks: { label: string; time: string; done: boolean }[] | null } | null
  /** Spoken sentence about yesterday's value of the last reading asked (computed by the caller). */
  yesterday?: string | null
}

export type ChatReply = {
  say: string
  offer?: Offer | null
  /** Repeat the previous reply at a slower rate. */
  slower?: boolean
  topic?: string
  why?: string | null
  more?: string | null
  /** Close the HUD after speaking (goodbye). */
  close?: boolean
}

export const greetingFor = (hour: number) => (hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
const comma = (a: string | null) => (a ? `, ${a}` : '')
const r1 = (n: number) => Math.round(n * 10) / 10
const fmt = (n: number) => {
  const a = Math.abs(n)
  const v = a >= 100 ? Math.round(n) : a >= 10 ? r1(n) : Math.round(n * 100) / 100
  return String(v)
}

/** A small, clean set of space and health jokes. */
export const JOKES = [
  'How do you throw a party in space? You planet.',
  'Why did the astronaut break up before launch? They needed space.',
  'What did the stethoscope say to the heart? Stop beating around the bush.',
  'Why don’t astronauts get hungry after lift-off? They’ve just had a big launch.',
  'I tried to tell a joke about blood pressure. It went over everyone’s head, then came back down to eighty.',
  'What kind of music do planets like? Neptunes.',
  'Why was the Moon never hungry? It was always full.',
  'Why did the skeleton skip the spacewalk? It had no body to go with.',
]

const UNIT_NAME: Record<Unit, [string, string]> = {
  f: ['degree Fahrenheit', 'degrees Fahrenheit'],
  c: ['degree Celsius', 'degrees Celsius'],
  lb: ['pound', 'pounds'],
  kg: ['kilogram', 'kilograms'],
  mi: ['mile', 'miles'],
  km: ['kilometre', 'kilometres'],
  in: ['inch', 'inches'],
  cm: ['centimetre', 'centimetres'],
  ft: ['foot', 'feet'],
  mmhg: ['millimetre of mercury', 'millimetres of mercury'],
  kpa: ['kilopascal', 'kilopascals'],
  mgdl: ['milligram per decilitre', 'milligrams per decilitre'],
  mmoll: ['millimole per litre', 'millimoles per litre'],
  oz: ['fluid ounce', 'fluid ounces'],
  ml: ['millilitre', 'millilitres'],
}
const unitName = (u: Unit, v: number) => UNIT_NAME[u][Math.abs(v) === 1 ? 0 : 1]

const CAPABILITIES =
  'I can give you a status briefing, read any of your measurements, explain your score and alerts, show a body system or open a page. I can log water, blood pressure, heart rate, oxygen, temperature, blood sugar, sleep, mood and exercise, always reading it back before I save. Describe a symptom and I’ll start a consultation. And I’m happy to chat: the time, the mission day, the cabin sensor, quick sums and unit conversions, or a joke.'

function feelingReply(f: Feeling, c: ChatCtx, m: Memory): ChatReply {
  const a = comma(c.address)
  switch (f) {
    case 'tired':
      return {
        say: `${vary(['Sorry to hear that', 'That sounds like a long day', 'Rest is part of the job too'], m.turn, 'tired')}${a}. If you can, keep a fixed sleep window and dim the lights an hour before sleep. If this is more than ordinary tiredness, or it comes with anything else, I can start a short consultation. Shall I?`,
        offer: { kind: 'consult' },
        topic: 'feeling',
      }
    case 'stressed':
    case 'anxious':
      return {
        say: `${vary(['That sounds hard', 'I hear you', 'That’s a lot to carry'], m.turn, 'stress')}${a}. Take a moment for yourself if you can. Talk to someone you trust; a private check-in with your care contact is available any time. Would you like me to log how you’re feeling as your mood today?`,
        offer: { kind: 'logMood', value: 2 },
        topic: 'feeling',
      }
    case 'lonely':
    case 'homesick':
      return {
        say: `${c.context === 'space' ? 'Being this far from home is one of the hardest parts of the mission' : c.context === 'polar' ? 'A long winter station is hard on anyone' : 'Feeling alone is hard'}${a}. A call or a message to someone close can help, and a private check-in with your care contact is always available. I’m only a rule-based assistant, but I’m here. Shall I note your mood for today?`,
        offer: { kind: 'logMood', value: 2 },
        topic: 'feeling',
      }
    case 'sad':
      return {
        say: `I’m sorry you’re feeling low${a}. Talk to someone you trust; a private check-in with your care contact is available any time. If it has gone on for a while, a short consultation can help me point you to the right support. Shall I start one?`,
        offer: { kind: 'consult' },
        topic: 'feeling',
      }
    case 'bored':
      return { say: `${vary(['Boredom on a mission is practically tradition', 'I can fix that, slightly'], m.turn, 'bored')}. Want a joke?`, offer: { kind: 'joke' }, topic: 'feeling' }
    case 'great':
      return { say: `Excellent${a}! Shall I log your mood as great?`, offer: { kind: 'logMood', value: 5 }, topic: 'feeling' }
    case 'good':
      return { say: `${vary(['Glad to hear it', 'Good to hear', 'That’s what I like to hear'], m.turn, 'good')}${a}. Want me to log your mood as good?`, offer: { kind: 'logMood', value: 4 }, topic: 'feeling' }
  }
}

function envReply(c: ChatCtx, weather: boolean, air = false): ChatReply {
  const lead = weather
    ? c.context === 'space'
      ? 'There’s no weather in here, just the cabin. '
      : 'I don’t have a weather forecast: I work offline and can’t see outside. '
    : ''
  const e = c.env
  if (!e || (e.t === null && e.h === null)) {
    return { say: `${lead}There’s no reading from the ${e?.label.toLowerCase() ?? 'environment sensor'} yet. Connect it on the Environment page and ask me again.`, offer: { kind: 'nav', target: 'environment' }, topic: 'env' }
  }
  const parts: string[] = []
  if (e.t !== null) parts.push(`${r1(e.t)} degrees`)
  if (e.h !== null) parts.push(`${Math.round(e.h)} percent humidity`)
  const age = e.ageMin < 1 ? 'just now' : e.ageMin < 90 ? `${Math.round(e.ageMin)} minute${Math.round(e.ageMin) === 1 ? '' : 's'} ago` : 'a while ago, so it may be out of date'
  const tempOk = e.t === null || (e.t >= CABIN_LIMITS.tempMin && e.t <= CABIN_LIMITS.tempMax)
  const humOk = e.h === null || (e.h >= CABIN_LIMITS.rhMin && e.h <= CABIN_LIMITS.rhMax)
  const old = e.ageMin > 15 // older than the consultation's "fresh" limit: never called normal
  const verdict = old
    ? 'It may not reflect the air now.'
    : tempOk && humOk
      ? 'That’s within the comfort range the app uses.'
      : `${!tempOk ? `Temperature is outside ${CABIN_LIMITS.tempMin} to ${CABIN_LIMITS.tempMax} degrees. ` : ''}${!humOk ? `Humidity is outside ${CABIN_LIMITS.rhMin} to ${CABIN_LIMITS.rhMax} percent.` : ''}`.trim()
  const gas = e.gas === 'crit' ? ' The gas sensor is in alarm: check the Environment page now.' : e.gas === 'warn' ? ' The gas reading needs attention.' : ''
  if (air && e.brief && !e.simulated) {
    // "is it the air?": gas alarm first, then what these readings make expected (environment-aware brief)
    return {
      say: `${gas.trim() ? `${gas.trim()} ` : ''}${e.brief}`,
      topic: 'env',
      offer: { kind: 'consult' },
      more: 'Sweating and thirst in heat, shivering in cold and dry eyes in very dry air are explained from NHS, MedlinePlus and OSHA pages; the heat index is NOAA’s formula. The sensor is only accurate to about 2 degrees and 5 percent.',
      why: 'I compare the newest fresh reading with the NASA cabin band and sourced heat, cold and dry-air effects. It never lowers an alarm.',
    }
  }
  return {
    say: `${lead}${e.simulated ? 'The simulated ' : 'Your '}${e.label.toLowerCase().replace(/^your /, '')} read ${parts.join(' and ')}, ${age}. ${verdict}${gas}`,
    topic: 'env',
    more: 'The comfort range is the cabin envelope from NASA’s crew health standard, as listed on the Environment page.',
    why: 'Those are the ranges the Environment page uses for the cabin.',
  }
}

export function chatReply(intent: ChatIntent, c: ChatCtx, m: Memory, lastReply = ''): ChatReply {
  const a = comma(c.address)
  const hour = c.now.getHours()
  const space = c.context === 'space'
  const mission = c.mission
  switch (intent.type) {
    case 'hello':
      return { say: `${vary([greetingFor(hour), 'Hello', 'Hi'], m.turn, 'hello')}${a}. ${vary(['What can I do for you?', 'How can I help?', 'What do you need?'], m.turn, 'hello2')}`, topic: 'hello' }
    case 'howAreYou':
      return {
        say: vary(
          [`All systems nominal${a}, thanks for asking. How are you feeling?`, `Running smoothly${a}. No complaints from the rule engine. How about you?`, `Quite well, for a set of rules${a}. How are you doing?`],
          m.turn,
          'hay',
        ),
        topic: 'smalltalk',
      }
    case 'thanks':
      return { say: vary(['You’re welcome.', 'Any time.', 'Happy to help.', 'My pleasure.'], m.turn, 'thx') + (m.turn % 3 === 0 ? ' Anything else?' : ''), topic: 'smalltalk' }
    case 'whoAreYou':
      return {
        say: 'I’m AURA, the assistant built into this health monitor. I’m rule-based: not a person and not an AI language model. Everything I say comes from fixed rules, your own readings and the app’s sources, and I work offline.',
        why: 'Fixed rules make every answer explainable and repeatable, which matters for health data.',
        topic: 'self',
      }
    case 'areYouHuman':
      return { say: 'No. I’m a rule-based assistant, not a person and not an AI. I follow fixed rules and your data, so I won’t pretend to know more than I do.', topic: 'self' }
    case 'capabilities':
      return { say: CAPABILITIES, topic: 'help' }
    case 'yourName':
      return { say: 'I’m AURA. You can wake me by saying “hey AURA” if the wake word is on.', topic: 'self' }
    case 'setName':
      return { say: `${vary(['Nice to meet you', 'Got it', 'Noted'], m.turn, 'name')}, ${intent.name}. I’ll call you that for this session.`, topic: 'self' }
    case 'myName':
      return { say: c.address ? `I call you ${c.address}. Say “call me” and a name if you’d prefer something else.` : 'I don’t know your name yet. Say “call me” and your name.', topic: 'self' }
    case 'joke': {
      const i = (m.joke + 1 + (m.turn % 2)) % JOKES.length
      m.joke = i
      return { say: JOKES[i], topic: 'joke', why: 'It’s a pun. I’m told those are the best kind. Or the worst.' }
    }
    case 'time':
      return { say: `It’s ${c.now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}${space ? ' on this device’s clock' : ''}.`, topic: 'time' }
    case 'date': {
      const d = c.now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      return { say: `Today is ${d}${mission && space ? `, mission day ${mission.day}` : ''}.`, topic: 'date' }
    }
    case 'missionDay': {
      if (!mission) return { say: 'There’s no mission profile for this account.', topic: 'mission' }
      const label = space ? 'mission day' : 'tracking day'
      const left = mission.totalDays ? ` of ${mission.totalDays}, so ${Math.max(0, mission.totalDays - mission.day)} to go` : ''
      return { say: `It’s ${label} ${mission.day}${left}.${space ? ` Profile: ${mission.name}.` : ''}`, topic: 'mission' }
    }
    case 'delay': {
      if (!space || !mission) return { say: 'There’s no signal delay here: you’re on Earth, so help is a normal call away.', topic: 'delay' }
      const p = MISSIONS.find((x) => x.id === mission.profileId)
      if (!p) return { say: 'I don’t know the delay for this mission profile.', topic: 'delay' }
      if (p.delaySec < 0.5) return { say: `On ${p.name} the link to Earth is near real-time, so mission control hears you almost at once.`, topic: 'delay' }
      const one = p.delaySec < 60 ? `about ${r1(p.delaySec)} seconds` : `about ${Math.round(p.delaySec / 60)} minutes`
      const two = p.delaySec < 60 ? `${r1(p.delaySec * 2)} seconds` : `${Math.round((p.delaySec * 2) / 60)} minutes`
      return {
        say: `On ${p.name} a message takes ${one} to reach Earth one way, so a question and its answer take at least ${two}. That’s why I give you the first steps myself.`,
        more: `The range for this profile is ${p.delayRange}; the figure comes from the mission data on the Environment page.`,
        topic: 'delay',
      }
    }
    case 'radiation': {
      if (!space || !mission) return { say: 'Radiation dose is tracked only on space missions.', topic: 'radiation' }
      const r = radiation(mission.profileId, mission.day)
      return {
        say: `Estimated from the profile’s average dose rate, not measured: about ${Math.round(r.dose)} millisieverts over ${mission.day} days, roughly ${Math.round(r.pct)} percent of the ${CAREER_LIMIT_MSV} millisievert career limit.`,
        more: r.mission.doseNote,
        why: 'It’s the published average daily dose for this mission type multiplied by the mission day.',
        topic: 'radiation',
      }
    }
    case 'today': {
      const t = c.today
      const parts: string[] = []
      if (t?.coach) parts.push(t.coach)
      const open = t?.tasks?.filter((x) => !x.done) ?? []
      if (t?.tasks) parts.push(open.length ? `Still on your checklist: ${open.slice(0, 4).map((x) => `${x.label}${x.time ? ` at ${x.time}` : ''}`).join('; ')}.` : 'Your daily checklist is all done.')
      if (!parts.length) return { say: 'I don’t have a plan or checklist for you today.', topic: 'today' }
      return { say: parts.join(' '), offer: t?.coach ? { kind: 'nav', target: 'coach' } : null, topic: 'today', more: t?.coach ? 'Say “open coach” for the full session.' : null }
    }
    case 'weather':
      return envReply(c, true)
    case 'cabin':
      return envReply(c, false, intent.air)
    case 'unitInfo':
      if (intent.unit === 'mmhg') return { say: 'mmHg means millimetres of mercury. It’s the unit blood pressure is given in. One mmHg is about 0.133 kilopascals.', topic: 'units' }
      if (intent.unit === 'spo2') return { say: 'SpO2 is the oxygen saturation a pulse oximeter shows: the share of your blood’s haemoglobin carrying oxygen, as a percentage.', topic: 'units' }
      return { say: 'bpm means beats per minute: how often your heart beats.', topic: 'units' }
    case 'calc': {
      const v = calculate(intent.a, intent.op, intent.b)
      if (v === null) return { say: 'Dividing by zero is one thing even I won’t attempt.', topic: 'calc' }
      const opWord = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '%of': 'percent of' }[intent.op]
      return { say: `${fmt(intent.a)} ${opWord} ${fmt(intent.b)} is ${fmt(v)}.`, topic: 'calc' }
    }
    case 'convert': {
      const v = convert(intent.value, intent.from, intent.to)
      if (v === null) return { say: 'I can’t convert between those units.', topic: 'convert' }
      const extra = intent.from === 'mgdl' || intent.to === 'mgdl' ? ' That uses 18 milligrams per decilitre per millimole, the usual factor for glucose.' : ''
      return { say: `${fmt(intent.value)} ${unitName(intent.from, intent.value)} is about ${fmt(v)} ${unitName(intent.to, v)}.${extra}`, topic: 'convert' }
    }
    case 'feeling':
      return feelingReply(intent.feeling, c, m)
    case 'goodbye':
      return { say: intent.night ? `Good night${a}. Sleep well.` : vary([`Talk soon${a}.`, `Standing by${a}.`, `See you later${a}.`], m.turn, 'bye'), close: true, topic: 'bye' }
    case 'compliment':
      return { say: vary(['Thank you. I’ll pass that on to my rules.', 'That’s kind of you. Flattery won’t change your score, though.', 'Thanks. I do my best within my rules.'], m.turn, 'cmp'), topic: 'smalltalk' }
    case 'ack':
      return { say: vary(['Anything else?', 'Let me know if you need anything.', 'Standing by.'], m.turn, 'ack'), topic: 'smalltalk' }
    case 'yesterday':
      if (!m.lastReading) return { say: 'Yesterday’s what? Ask about a reading first, for example “how is my heart rate”.', topic: m.lastTopic ?? undefined }
      return { say: c.yesterday ?? 'I don’t have a reading from yesterday for that.', topic: m.lastTopic ?? undefined }
    case 'why':
      if (m.why) return { say: m.why, topic: m.lastTopic ?? undefined }
      return { say: 'I answer from fixed rules and your latest readings; there’s no hidden reasoning. Ask about a reading and I’ll tell you its status and why.', topic: m.lastTopic ?? undefined }
    case 'more':
      if (m.more) return { say: m.more, topic: m.lastTopic ?? undefined }
      return { say: 'That’s all I have on that. Try asking about a reading, your alerts or the coach.', topic: m.lastTopic ?? undefined }
    case 'presence':
      return { say: vary([`I’m here${a}. Go ahead.`, `Loud and clear${a}.`, `Right here${a}. What do you need?`], m.turn, 'here'), topic: 'smalltalk' }
    case 'favourite':
      return {
        say: /planet|world/.test(intent.thing)
          ? 'Earth. It has all my favourite people, and the best atmosphere.'
          : /colou?r/.test(intent.thing)
            ? 'The green of a normal reading, if I had to choose.'
            : /number/.test(intent.thing)
              ? 'Ninety-eight. As in percent oxygen saturation. I know, very romantic.'
              : `I’m a rule-based assistant, so I don’t really have a favourite ${intent.thing}. I do like a full set of readings.`,
        topic: 'smalltalk',
      }
    case 'slower':
      return { say: lastReply || 'I haven’t said anything yet.', slower: true, topic: m.lastTopic ?? undefined }
  }
}

/** When nothing matched: say plainly what AURA can help with (varied, never a guess). */
export function fallbackReply(m: Memory): string {
  return vary(
    [
      'I didn’t catch that. You can ask for a status report, a reading such as your blood pressure, or say “what can you do”.',
      'Sorry, that one’s outside my rules. Try “how is my heart rate”, “log a glass of water”, or “tell me a joke”.',
      'I’m not sure what you mean. I can read your measurements, log values, open pages, start a consultation, or just chat. Say “help” for more.',
    ],
    m.turn,
    'fallback',
  )
}
