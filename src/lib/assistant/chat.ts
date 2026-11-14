// Everyday conversation for AURA, without AI: ordered patterns on fold()-ed text (English and Turkish input).
// This file only recognises WHAT was said; reply.ts decides what to answer. Safety comes first: crisis words
// are detected here and anything that sounds like a symptom is left to the consultation engine (route.ts).
import { fold } from '../doctor/parse'
import { normalizeNumbers } from '../voice/numbers'

export type Feeling = 'tired' | 'stressed' | 'lonely' | 'sad' | 'bored' | 'anxious' | 'good' | 'great' | 'homesick'
export type Unit = 'f' | 'c' | 'lb' | 'kg' | 'mi' | 'km' | 'in' | 'cm' | 'ft' | 'mmhg' | 'kpa' | 'mgdl' | 'mmoll' | 'oz' | 'ml'
export type CalcOp = '+' | '-' | '*' | '/' | '%of'

export type ChatIntent =
  | { type: 'hello'; wake: boolean }
  | { type: 'howAreYou' }
  | { type: 'thanks' }
  | { type: 'whoAreYou' }
  | { type: 'areYouHuman' }
  | { type: 'capabilities' }
  | { type: 'yourName' }
  | { type: 'setName'; name: string }
  | { type: 'myName' }
  | { type: 'joke' }
  | { type: 'time' }
  | { type: 'date' }
  | { type: 'missionDay' }
  | { type: 'weather' }
  | { type: 'cabin' }
  | { type: 'delay' }
  | { type: 'radiation' }
  | { type: 'today' }
  | { type: 'calc'; a: number; op: CalcOp; b: number }
  | { type: 'convert'; value: number; from: Unit; to: Unit }
  | { type: 'unitInfo'; unit: 'mmhg' | 'spo2' | 'bpm' }
  | { type: 'feeling'; feeling: Feeling }
  | { type: 'goodbye'; night: boolean }
  | { type: 'compliment' }
  | { type: 'ack' }
  | { type: 'yesterday' }
  | { type: 'why' }
  | { type: 'more' }
  | { type: 'slower' }
  | { type: 'presence' }
  | { type: 'favourite'; thing: string }

const clean = (s: string) =>
  fold(s)
    .replace(/[?!.;:"]/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const strip = (f: string) => f.replace(/^(?:(?:hey|ok|okay|so|well|and|aura|please|lutfen)\s+)+/, '').replace(/\s+(?:please|lutfen|aura|then)$/, '').trim()

/* ---------- safety first ---------- */

const CRISIS =
  /\b(?:kill(?:ing)? myself|suicid\w*|end (?:my|it all)|end my life|want to die|wanna die|wish i (?:was|were) dead|better off dead|don'?t want to (?:live|be alive|wake up)|no (?:reason|point) (?:to|in) liv\w*|self[- ]?harm|hurt(?:ing)? myself|harm myself|cut(?:ting)? myself)\b|intihar|kendimi (?:oldur|oldurmek|oldurecegim|asmak)|kendime zarar|olmek istiyorum|yasamak istemiyorum|olsem daha iyi|yasamanin anlami yok/

/** Words of suicide or self-harm. Always routed to the urgent consultation path, never to small talk. */
export const isCrisis = (text: string) => CRISIS.test(clean(text))

/* ---------- feelings (only short, plain statements; anything more goes to the consultation) ---------- */

const FEELINGS: [Feeling, RegExp][] = [
  ['homesick', /\bhomesick|miss (?:home|my family|earth|my kids|my wife|my husband)|evimi ozledim|ailemi ozledim|dunyayi ozledim/],
  ['lonely', /\blonely|alone|isolated|yalniz(?:im|lik)?\b/],
  ['stressed', /\bstress(?:ed)?|overwhelmed|under pressure|tense|burned out|burnt out|stresli(?:yim)?|gerginim|bunaldim/],
  ['anxious', /\banxious|nervous|worried|on edge|endiseli(?:yim)?|kaygili(?:yim)?|tedirginim/],
  ['tired', /\btired|exhausted|sleepy|worn out|knackered|no energy|yorgun(?:um)?|bitkin(?:im)?|uykum var|halsizim/],
  ['sad', /\bsad|down|low|blue|unhappy|mutsuz(?:um)?|uzgun(?:um)?|keyifsiz(?:im)?|moralim bozuk/],
  ['bored', /\bbored|boring|sikildim|canim sikiliyor/],
  ['great', /\b(?:great|amazing|fantastic|wonderful|excellent|awesome|super|harika|cok iyi(?:yim)?|mukemmel)\b/],
  ['good', /\b(?:good|fine|ok|okay|alright|well|happy|iyiyim|iyi)\b/],
]
const FEEL_LEAD = /^(?:i'?m|i am|i feel|i'?m feeling|i am feeling|feeling|i'?ve been feeling|i have been feeling|i'?m so|i'?m a bit|im|i'm in a|i am in a|kendimi|bugun|cok|biraz)?\b/

/** A short feeling statement ("I'm tired", "feeling a bit lonely", "çok yorgunum"); null otherwise. */
export function feelingOf(text: string): Feeling | null {
  const f = clean(text)
  const words = f.split(' ').length
  if (words > 9) return null
  const statement = /^(?:i'?m|i am|im|i feel|i'?ve been|i have been|feeling|so|really|kinda|a bit|pretty|very|just|today i|honestly)\b/.test(f) || /(?:im|um|yim|yum|iyorum|ledim|dim|dum|tim|var|yok|bozuk|sikiliyor)$/.test(f) || /\bmood\b/.test(f)
  if (!statement || !FEEL_LEAD.test(f)) return null
  for (const [k, re] of FEELINGS) if (re.test(f)) return /\bnot (?:so |very |feeling )?(?:good|great|well|ok|okay|fine)\b|iyi degil/.test(f) ? 'sad' : k
  return null
}

/* ---------- numbers: calculations and unit conversions ---------- */

const NUM = '(-?\\d+(?:\\.\\d+)?)'
const OPS: [RegExp, CalcOp][] = [
  [/^(?:plus|\+|arti|add)$/, '+'],
  [/^(?:minus|-|eksi|take away|less)$/, '-'],
  [/^(?:times|x|\*|multiplied by|carpi|kere)$/, '*'],
  [/^(?:divided by|\/|over|bolu|divide by)$/, '/'],
]
const OP_WORDS = 'plus|\\+|arti|minus|eksi|times|x|\\*|multiplied by|carpi|kere|divided by|divide by|\\/|bolu'
const CALC_RE = new RegExp(`${NUM}\\s*(${OP_WORDS})\\s*${NUM}`)
const PCT_RE = new RegExp(`${NUM}\\s*(?:percent|%)\\s*of\\s*${NUM}|${NUM}\\s*(?:in|nin|nun|un|in)?\\s*yuzde\\s*${NUM}`)

const UNIT_WORDS: [Unit, string][] = [
  ['f', 'degrees fahrenheit|fahrenheit|degrees f|f'],
  ['c', 'degrees celsius|celsius|centigrade|degrees c|santigrat|derece|c'],
  ['lb', 'pounds|pound|lbs|lb'],
  ['kg', 'kilograms|kilogram|kilos|kilo|kg'],
  ['mi', 'miles|mile|mil'],
  ['km', 'kilometres|kilometers|kilometre|kilometer|km'],
  ['in', 'inches|inch|inc|in'],
  ['cm', 'centimetres|centimeters|centimetre|centimeter|santim|cm'],
  ['ft', 'feet|foot|ft'],
  ['mmhg', 'millimetres of mercury|millimeters of mercury|mm hg|mmhg'],
  ['kpa', 'kilopascals|kilopascal|kpa'],
  ['mgdl', 'milligrams per decilitre|milligrams per deciliter|mg dl|mg/dl|mgdl'],
  ['mmoll', 'millimoles per litre|millimoles per liter|mmol l|mmol/l|mmol'],
  ['oz', 'fluid ounces|ounces|ounce|oz'],
  ['ml', 'millilitres|milliliters|ml'],
]
const unitAlt = UNIT_WORDS.map(([, w]) => w).join('|')
const unitOf = (w: string): Unit | null => UNIT_WORDS.find(([, re]) => new RegExp(`^(?:${re})$`).test(w.trim()))?.[0] ?? null
const CONVERT_A = new RegExp(`${NUM}\\s*(${unitAlt})\\s+(?:to|in|into|as|is how many|kac|ise kac)\\s+(${unitAlt})\\b`)
const CONVERT_B = new RegExp(`how many\\s+(${unitAlt})\\s+(?:is|are|in|make)\\s+${NUM}\\s*(${unitAlt})\\b`)
const COMPAT: Unit[][] = [['f', 'c'], ['lb', 'kg'], ['mi', 'km'], ['in', 'cm', 'ft'], ['mmhg', 'kpa'], ['mgdl', 'mmoll'], ['oz', 'ml']]
const compatible = (a: Unit, b: Unit) => a !== b && COMPAT.some((g) => g.includes(a) && g.includes(b))

function numbersFirst(f: string): string {
  return normalizeNumbers(f, true)
}

/* ---------- the parser ---------- */

/** Everyday conversation intents; null when the text is not small talk (the health parser then takes over). */
export function parseChat(text: string): ChatIntent | null {
  const raw = clean(text)
  const f = strip(raw)
  if (!f) return null
  const n = numbersFirst(f)
  const words = f.split(' ').length

  // follow-ups that lean on the last answer
  if (/^(?:(?:can you )?(?:say|repeat) (?:that|it)(?: again)? (?:more )?slow(?:er|ly)|slower|more slowly|slow down|speak slower|daha yavas|yavas soyle|yavas konus)/.test(f)) return { type: 'slower' }
  if (/^(?:why|why is that|why so|how come|why not|neden|niye|nicin|neden oyle)$/.test(f)) return { type: 'why' }
  if (/^(?:tell me more|more|go on|more details?|explain more|elaborate|and then|devam|daha fazla|biraz daha anlat|detay ver|ayrinti)$/.test(f)) return { type: 'more' }
  if (/^(?:(?:and|what about|how about) )?(?:yesterday|the day before|ya dun|dun|peki dun|dunku)(?: (?:then|value|reading))?$/.test(f) || /^(?:what|how) (?:was|about) (?:it )?yesterday$/.test(f)) return { type: 'yesterday' }

  // conversation
  if (/^(?:can you hear me|are you (?:there|listening|awake|on)|you there|anybody there|hello?? anyone|beni duyuyor musun|orada misin|burada misin)$/.test(f)) return { type: 'presence' }
  const fav = /^(?:what(?:'?s| is) )?your fav(?:ou?rite)? ([a-z ]{2,24})$/.exec(f)
  if (fav) return { type: 'favourite', thing: fav[1].trim() }
  if (/^(?:how are you|how are you doing|what'?s up|wassup|sup|how'?s it going|how do you do|how have you been|are you ok(?:ay)?|nasilsin|naber|ne haber|iyi misin|nasil gidiyor)$/.test(f)) return { type: 'howAreYou' }
  if (/^(?:thanks?|thank you|thank you (?:so much|very much)|thanks a lot|cheers|much appreciated|tesekkurler|tesekkur ederim|sagol|sag ol|eyvallah)(?: (?:aura|a lot|anyway))?$/.test(f)) return { type: 'thanks' }
  if (/\b(?:are you (?:a )?(?:human|real|a person|alive|a robot|an ai|ai|artificial|chat ?gpt|sentient|conscious)|insan misin|gercek misin|yapay zeka misin|robot musun)\b/.test(f)) return { type: 'areYouHuman' }
  if (/^(?:who|what) are you$|^what is aura$|^who made you$|^who built you$|^introduce yourself$|^sen kimsin$|^kimsin$|^sen nesin$/.test(f)) return { type: 'whoAreYou' }
  if (/^(?:what can you do|what do you do|what are you (?:good )?for|how can you help(?: me)?|what can i ask(?: you)?|what can i say|help|help me|commands|neler yapabilirsin|ne yapabilirsin|ne diyebilirim|yardim|yardim et)$/.test(f)) return { type: 'capabilities' }
  if (/^(?:what'?s|what is) your name$|^your name$|^do you have a name$|^adin ne$|^ismin ne$/.test(f)) return { type: 'yourName' }
  const nm = /^(?:call me|my name is|i'?m called|you can call me|bana|benim adim|adim)\s+([a-z][a-z' -]{0,30}?)(?:\s+(?:de|diye seslen|please))?$/.exec(f)
  if (nm && !/^(?:a|an|the|not|so|very|tired|sad|ok|okay|fine)$/.test(nm[1].split(' ')[0])) {
    const name = nm[1]
      .split(' ')
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    return { type: 'setName', name }
  }
  if (/^(?:what'?s|what is) my name$|^do you know my name$|^who am i$|^benim adim ne$|^adim ne$/.test(f)) return { type: 'myName' }
  if (/\b(?:joke|make me laugh|something funny|cheer me up|espri|fikra|guldur beni)\b/.test(f)) return { type: 'joke' }
  if (/^(?:good ?night|goodnight|good bye|goodbye|bye|see you(?: later)?|talk later|iyi geceler|hosca kal|gorusuruz|bay bay)$/.test(f)) return { type: 'goodbye', night: /night|gece/.test(f) }
  if (/^(?:you'?re|you are) (?:great|awesome|amazing|the best|smart|clever|helpful|cool|funny)|^(?:good job|well done|nice work|great job|i like you|i love you|harikasin|cok iyisin|aferin)/.test(f)) return { type: 'compliment' }
  if (/^(?:hello|hi|hey|hey there|hi there|good (?:morning|afternoon|evening|day)|morning|evening|merhaba|selam|gunaydin|iyi aksamlar|iyi gunler|tunaydin)$/.test(f)) return { type: 'hello', wake: false }
  if (/^(?:cool|nice|great|got it|i see|alright|ok then|okay then|fair enough|understood|good to know|anladim|guzel|super|peki)$/.test(f)) return { type: 'ack' }

  // time, date, mission
  if (/\b(?:what time is it|what'?s the time|the time now|current time|time please|saat kac|saat ne|su an saat)\b|^time$/.test(f)) return { type: 'time' }
  if (/\b(?:what(?:'?s| is) (?:the |today'?s )?date|what day is (?:it|today)|which day is it|today'?s date|bugun gunlerden ne|bugun ayin kaci|tarih ne|bugunun tarihi)\b/.test(f)) return { type: 'date' }
  if (/\b(?:mission day|day of (?:the )?mission|which day of (?:the )?mission|how many days|how long (?:have we been|until|is the mission)|gorev(?:in)? kacinci gun|gorev gunu|kacinci gundeyiz)\b/.test(f)) return { type: 'missionDay' }
  if (/\b(?:delay|signal (?:time|lag)|lag to earth|talk to earth|reach earth|earth delay|houston|mission control|gecikme|dunyaya ne kadar)\b/.test(f) && !/\bstart|open\b/.test(f)) return { type: 'delay' }
  if (/\b(?:radiation dose|how much radiation|radiation (?:so far|level|today)|my dose|dose so far|radyasyon doz|ne kadar radyasyon)\b/.test(f)) return { type: 'radiation' }
  if (/\b(?:what(?:'?s| is) (?:on )?(?:my |the )?(?:plan|schedule|agenda)|my tasks|today'?s tasks|what do i have today|what'?s next|my (?:session|workout|training) today|today'?s (?:session|workout|training|plan)|remind me|any reminders|bugun ne var|gorevlerim|bugunku plan|bugunku antrenman|hatirlat)\b/.test(f)) return { type: 'today' }
  if (/\b(?:weather|is it (?:cold|hot|warm|raining|sunny)|how (?:cold|hot|warm) is it|rain(?:ing)? (?:today|outside)|hava (?:nasil|durumu)|disarisi nasil|yagmur)\b/.test(f)) return { type: 'weather' }
  if (/\b(?:cabin|room|air|station|ortam|kabin|oda|hava kalitesi) (?:temperature|temp|humidity|air|quality|sicakligi|nemi)\b|\b(?:humidity|nem|air quality|gas level|gaz)\b/.test(f)) return { type: 'cabin' }

  // units and maths
  if (/^(?:what(?:'?s| is| does)|whats) (?:mm ?hg|millimet(?:re|er)s of mercury)(?: mean| stand for)?$|^mm ?hg (?:nedir|ne demek)$/.test(f)) return { type: 'unitInfo', unit: 'mmhg' }
  if (/^(?:what(?:'?s| is| does)|whats) (?:spo2|sp o2|s p o 2|oxygen saturation|o2 sat)(?: mean| stand for)?$|^spo2 (?:nedir|ne demek)$/.test(f)) return { type: 'unitInfo', unit: 'spo2' }
  if (/^(?:what(?:'?s| is| does)|whats) (?:bpm|beats per minute)(?: mean| stand for)?$/.test(f)) return { type: 'unitInfo', unit: 'bpm' }
  const cv = CONVERT_A.exec(n)
  if (cv) {
    const from = unitOf(cv[2])
    const to = unitOf(cv[3])
    if (from && to && compatible(from, to)) return { type: 'convert', value: Number(cv[1]), from, to }
  }
  const cv2 = CONVERT_B.exec(n)
  if (cv2) {
    const to = unitOf(cv2[1])
    const from = unitOf(cv2[3])
    if (from && to && compatible(from, to)) return { type: 'convert', value: Number(cv2[2]), from, to }
  }
  const pct = PCT_RE.exec(n)
  if (pct) {
    if (pct[1] !== undefined) return { type: 'calc', a: Number(pct[1]), op: '%of', b: Number(pct[2]) }
    return { type: 'calc', a: Number(pct[4]), op: '%of', b: Number(pct[3]) }
  }
  const calcCue = /^(?:what(?:'?s| is)|whats|how much is|calculate|compute|work out|kac eder|ne eder|hesapla)\b/.test(n) || /\b(?:kac eder|ne eder|equals?)\b/.test(n) || words <= 4
  const c = CALC_RE.exec(n)
  if (c && calcCue && !/\b(?:blood|pressure|bp|tansiyon|mmhg)\b/.test(n)) {
    const op = OPS.find(([re]) => re.test(c[2]))?.[1]
    if (op) return { type: 'calc', a: Number(c[1]), op, b: Number(c[3]) }
  }

  const feel = feelingOf(text)
  if (feel) return { type: 'feeling', feeling: feel }
  return null
}

/* ---------- maths (pure, exported for tests) ---------- */

export function calculate(a: number, op: CalcOp, b: number): number | null {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return b === 0 ? null : a / b
    case '%of':
      return (a / 100) * b
  }
}

/** Unit conversion by definition (exact factors where they exist). Glucose uses 18.016 mg/dL per mmol/L. */
export function convert(v: number, from: Unit, to: Unit): number | null {
  const f: Record<string, (x: number) => number> = {
    'f>c': (x) => ((x - 32) * 5) / 9,
    'c>f': (x) => (x * 9) / 5 + 32,
    'lb>kg': (x) => x * 0.45359237,
    'kg>lb': (x) => x / 0.45359237,
    'mi>km': (x) => x * 1.609344,
    'km>mi': (x) => x / 1.609344,
    'in>cm': (x) => x * 2.54,
    'cm>in': (x) => x / 2.54,
    'ft>cm': (x) => x * 30.48,
    'cm>ft': (x) => x / 30.48,
    'in>ft': (x) => x / 12,
    'ft>in': (x) => x * 12,
    'mmhg>kpa': (x) => x * 0.133322,
    'kpa>mmhg': (x) => x / 0.133322,
    'mgdl>mmoll': (x) => x / 18.016,
    'mmoll>mgdl': (x) => x * 18.016,
    'oz>ml': (x) => x * 29.5735,
    'ml>oz': (x) => x / 29.5735,
  }
  const fn = f[`${from}>${to}`]
  return fn ? fn(v) : null
}
