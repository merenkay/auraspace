// The sourced advice is mostly written for people on Earth (NHS numbers, A&E, GP). This adapts the
// plain-language text (never the stored quote) to who the person can actually reach in each context.
import type { Context } from '../../data/contexts'

const STRIP_PREFIX = /^(?:Step \d+[^:]{0,32}|Getting up \d+|Diabetes UK(?: examples)?|St John Ambulance adds|Recovery|Flu|Helper|Emergency \(999\)|Urgent)(?: \([^)]*\))?:\s*/i

/** Red flags are shown under "Get help at once if", so the leading "Call 999 if/for" is dropped. */
export function asRedFlag(text: string): string {
  return text.replace(/^(?:Call|Dial) 999 (?:now )?(?:if|for) /i, '')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Returns the adapted text, or null when the line does not apply in this context (e.g. "do not drive to A&E" in space). */
export function localise(text: string, ctx: Context): string | null {
  let t = cap(text.replace(STRIP_PREFIX, '').trim())
  if (ctx === 'home') {
    return t
      .replace(/\b(?:call|dial) 999\b/gi, (m) => `${m[0] === 'C' || m[0] === 'D' ? 'Call' : 'call'} 112 (999 in the UK)`)
      .replace(/\bNHS 111\b/g, 'your doctor or NHS 111')
  }
  const contact = ctx === 'space' ? 'the crew medical officer and flight surgeon' : 'the station doctor'
  if (ctx === 'space' && /\b(?:drive|driving|ambulance|hospital)\b/i.test(t)) return null
  if (ctx === 'polar' && /\b(?:drive|driving)\b/i.test(t)) return null
  // Earth phone-system details ("the call handler", "911", "emergency number") do not translate to a crew or station.
  if (/call handler|emergency number|\b911\b|\b112\b/i.test(t)) return null
  t = t
    .replace(/\b(?:call|dial|phone) (?:999|911|112)\b(?: straight away| now| immediately)?/gi, (m) => (m[0] === m[0].toUpperCase() ? `Alert ${contact} now` : `alert ${contact} now`))
    .replace(/\(999\)|\b999\b/g, ctx === 'space' ? 'the crew medical officer' : 'the station doctor')
    .replace(/\b(?:an urgent GP appointment or )?NHS 111\b/g, ctx === 'space' ? 'the flight surgeon' : 'the station doctor')
    .replace(/\b(?:a|your|the) GP\b|\bGP\b/g, ctx === 'space' ? 'the flight surgeon' : 'the station doctor')
    .replace(/\bA&E\b/g, ctx === 'space' ? 'the crew medical officer' : 'the station doctor')
  return t
}
