// Builds the spoken text from an Evaluation: concise, calm, a little formal. It only re-words what the
// deterministic rules already decided (values, statuses, alerts, score). No medical logic lives here.
import { STATUS_LABEL, type Status, type VitalKey } from '../../data/vitals'
import { timeAgo, type Evaluation } from '../health'
import type { CrewMember, User } from '../types'
import { numberWords } from './numbers'
import { sayBloodPressure, sayCount, sayHours, sayLitres, sayPercent, sayTemperature } from './speech'

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function greeting(hour: number): string {
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** How AURA addresses the person: rank for the commander and pilot, "Doctor" for the flight surgeon, else the first name. */
export function addressFor(user: User | null, member?: CrewMember | null): string | null {
  if (!user) return null
  if (user.role === 'surgeon') return 'Doctor'
  if (user.role === 'ground') return user.title.split('·').pop()?.trim() || 'Control'
  const pos = member?.position
  if ((user.role === 'astronaut' || user.role === 'member') && pos && /^(commander|pilot)$/i.test(pos)) return pos
  return user.name.split(' ')[0] || null
}

const countWord = (n: number) => cap(numberWords(n))
const lead = (hour: number, address: string | null) => `${greeting(hour)}${address ? `, ${address}` : ''}.`

/** "138 over 86", "ninety-eight percent", "five point two hours" ... one reading as it is said aloud. */
export function spokenValue(ev: Evaluation, key: VitalKey): string {
  const v = ev.values
  switch (key) {
    case 'bp':
      return sayBloodPressure(v.sys, v.dia)
    case 'hr':
      return `${Math.round(v.hr)} beats per minute`
    case 'spo2':
      return sayPercent(v.spo2)
    case 'temp':
      return sayTemperature(v.temp)
    case 'glucose':
      return `${Math.round(v.glucose)} milligrams per decilitre`
    case 'sleep':
      return sayHours(v.sleep)
    case 'water':
      return sayLitres(v.water)
    case 'exercise':
      return sayCount(v.exercise, 'minutes')
    case 'mood': {
      const scale = ev.defByKey.mood?.fields[0].scale
      return `${scale?.[Math.round(v.mood) - 1]?.toLowerCase() ?? v.mood} on a scale of one to five`
    }
    case 'vision':
      return `${numberWords(Math.round(v.vision))} out of five`
  }
}

const label = (ev: Evaluation, key: VitalKey) => (ev.defByKey[key]?.label ?? key).toLowerCase()

export type BriefOpts = { address: string | null; hour: number; /** set when the signed-in person is looking at someone else's record */ subject?: string | null }

export const NO_DATA = 'There are no readings yet, so I cannot say how things are. Log a measurement and ask me again.'

/** "Not enough current data for a score: four of ten measurements are current." */
function dataLine(ev: Evaluation): string {
  const q = ev.quality
  return `Not enough current data for a score: ${numberWords(q.current)} of ${numberWords(q.expected)} measurements ${q.current === 1 ? 'is' : 'are'} current.`
}

/** Old readings are mentioned as last known values (abnormal ones by name), never as current. */
function oldLine(ev: Evaluation): string {
  const old = ev.lastKnown
  if (!old.length) return ''
  const bad = old.filter((i) => i.status !== 'ok')
  if (bad.length) return `Last known ${bad.map((i) => `${i.label.toLowerCase()} was ${STATUS_LABEL[i.status!].toLowerCase()}, ${timeAgo(i.at)}`).join('; ')}. That is old, so please re-measure.`
  return `${countWord(old.length)} ${old.length === 1 ? 'reading is' : 'readings are'} old and not counted: ${old.map((i) => i.label.toLowerCase()).join(', ')}.`
}

export function statusBriefing(ev: Evaluation | null, o: BriefOpts): string {
  const head = lead(o.hour, o.address)
  const about = o.subject ? ` This is the briefing for ${o.subject}.` : ''
  if (!ev || !ev.hasData) return `${head}${about} ${NO_DATA}`
  const parts = [head + about, ev.scoreReady ? `Health score ${numberWords(ev.score)}.` : `Health score unavailable. ${dataLine(ev)}`]
  if (!ev.alerts.length) {
    const n = ev.quality.current
    parts.push(n ? `${n === 1 ? 'The one current reading I have is' : `All ${numberWords(n)} current readings I have are`} within range.` : 'None of the readings I have is current.')
  } else {
    const items = ev.alerts.map((a) => {
      const level = a.level === 'crit' ? 'urgent' : 'attention'
      const isVital = ev.vitalStatus[a.key as VitalKey] !== undefined
      return isVital ? `${label(ev, a.key as VitalKey)} ${spokenValue(ev, a.key as VitalKey)}, ${level}` : `${a.title.charAt(0).toLowerCase()}${a.title.slice(1)}, ${level}`
    })
    const n = ev.alerts.length
    parts.push(`${countWord(n)} ${n === 1 ? 'item needs' : 'items need'} attention: ${items.join('; ')}.`)
    const first = ev.alerts[0]
    if (first.detail) parts.push(`Suggested first step: ${first.detail}`)
  }
  const old = oldLine(ev)
  if (old) parts.push(old)
  return parts.join(' ')
}

export function readingBriefing(ev: Evaluation | null, key: VitalKey, o: { subject?: string | null; hidden?: boolean }): string {
  const who = o.subject ? `${o.subject}'s` : 'your'
  if (o.hidden) return 'That reading is not available to your role.'
  const name = ev ? label(ev, key) : key
  const st: Status | undefined = ev?.vitalStatus[key]
  if (!ev || !ev.hasData || !st) return `I do not have a ${name} reading for ${o.subject ?? 'you'} yet. I will not assume it is normal.`
  const def = ev.defByKey[key]!
  const at = ev.meta[def.primary]?.at
  const head = `${cap(who)} ${name} is ${spokenValue(ev, key)}${at ? `, measured ${timeAgo(at).replace(/^today /, 'today at ')}` : ''}.`
  const old = ev.lastKnown.find((i) => i.key === key)
  if (old) return `${head} That reading is ${numberWords(old.ageDays ?? 0)} days old, so it is only the last known value${st === 'ok' ? '' : `, which was ${STATUS_LABEL[st].toLowerCase()}`}. Please re-measure.`
  const verdict = st === 'ok' ? 'That is within range.' : `Status: ${STATUS_LABEL[st].toLowerCase()}.`
  const alert = ev.alerts.find((a) => a.key === key)
  return [head, verdict, alert?.detail ? `Suggested step: ${alert.detail}` : ''].filter(Boolean).join(' ')
}

export function alertsBriefing(ev: Evaluation | null): string {
  if (!ev || !ev.hasData) return `There are no readings yet, so there is nothing to alert on. ${NO_DATA}`
  if (!ev.alerts.length) return ['No alerts.', ev.quality.current ? 'Every current reading I have is within range.' : 'None of the readings I have is current.', oldLine(ev)].filter(Boolean).join(' ')
  const n = ev.alerts.length
  const lines = ev.alerts.map((a) => `${a.level === 'crit' ? 'Urgent' : 'Attention'}: ${a.title}.`)
  return `${countWord(n)} ${n === 1 ? 'alert' : 'alerts'}. ${lines.join(' ')}`
}

export function scoreBriefing(ev: Evaluation | null): string {
  if (!ev || !ev.hasData) return `There is no health score yet. ${NO_DATA}`
  const out = ev.alerts.map((a) => a.title)
  if (!ev.scoreReady) {
    const q = ev.quality
    const flagged = out.length ? ` Current readings out of range: ${out.join('; ')}.` : ''
    return `Health score unavailable. ${dataLine(ev)} A score needs ${numberWords(q.minCurrent)} current measurements, including blood pressure and heart rate. Missing and old readings are not counted as normal or as a problem.${flagged} The thresholds are fixed rules, not an estimate by AI.`
  }
  return `Health score ${numberWords(ev.score)}. It starts at one hundred and loses points for every current reading outside its range, more for urgent readings than for attention ones. ${out.length ? `Right now these count against it: ${out.join('; ')}.` : 'Nothing is counting against it right now.'} The thresholds are fixed rules, not an estimate by AI.`
}

export const HELP_TEXT =
  'You can say: status report; how is my blood pressure; list my alerts; explain my score; show the heart; open history; log two hundred and fifty millilitres of water; my blood pressure is one twenty eight over eighty two; or describe a symptom such as I have chest pain. I also understand Turkish; switch the language in the voice settings. Say stop to make me quiet.'

export const UNKNOWN_TEXT = 'I did not catch that. Try “status report” or “how is my blood pressure”.'
