// Making sense of imperfect recognition without AI: a table of common mis-hearings, filler-word removal,
// edit-distance matching on a rough phonetic key for our domain vocabulary (English and Turkish), wake-word
// variants and a simple English / Turkish language guess. Everything works on fold()-ed text (ASCII, lower case).
import { fold } from '../doctor/parse'

/* ---------- edit distance + phonetic key ---------- */

/** Optimal-string-alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** A rough "sounds like" key: letters that are often confused by recognisers collapse to one. */
export function phoneticKey(word: string): string {
  return fold(word)
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/(?<=[^aeiou])h/g, '')
    .replace(/([a-z])\1+/g, '$1')
}

/* ---------- vocabulary ---------- */

/** Domain words that recognisers get wrong; fuzzy matching only ever corrects towards these. */
export const VOCAB = [
  // English: vitals, systems, pages, commands, units
  'pressure', 'glucose', 'oxygen', 'saturation', 'temperature', 'pulse', 'heartbeat', 'sleep', 'water', 'mood', 'exercise', 'workout', 'vision',
  'lungs', 'brain', 'kidneys', 'kidney', 'bones', 'muscles', 'metabolism', 'immune', 'radiation', 'cardio', 'breathing',
  'diagnostics', 'history', 'environment', 'coach', 'overview', 'dashboard', 'roster', 'reports', 'consultation',
  'status', 'briefing', 'alerts', 'score', 'summary', 'millilitres', 'milliliters', 'litres', 'liters', 'glasses',
  // Turkish (folded)
  'tansiyon', 'tansiyonum', 'nabiz', 'nabzim', 'oksijen', 'ates', 'atesim', 'seker', 'sekerim', 'uyku', 'uykum', 'kalp', 'kalbimi', 'akciger', 'akcigerler',
  'bobrek', 'bobrekler', 'beyin', 'kemik', 'kemikler', 'radyasyon', 'gecmis', 'ortam', 'antrenman', 'durum', 'uyari', 'uyarilar', 'puan', 'egzersiz', 'mililitre', 'bardak', 'raporu',
  // symptoms of the extended knowledge base (2026-11)
  'diarrhoea', 'diarrhea', 'constipation', 'constipated', 'appendix', 'migraine', 'phlegm', 'nosebleed', 'seizure', 'vertigo', 'palpitations', 'shingles',
  'cellulitis', 'conjunctivitis', 'chilblains', 'toothache', 'heartburn', 'sprain', 'sprained',
  'ishal', 'kabiz', 'migren', 'apandisit', 'balgam', 'nobet', 'zona',
]
const VOCAB_KEYS = VOCAB.map((w) => ({ w, k: phoneticKey(w) }))

/** Real words that sit close to a vocabulary word but must never be "corrected". */
const KEEP = new Set(
  (
    'the this that these those there their they then than them what when where which while with will would could should about after again also always another because before being both each every from have here into just like little many more most much must never only other over please really same some still such sure take tell than thank thanks very want well were your yours you are was is it its for and but not how who why okay ' +
    'weather whether feather leather wetter planet planets favourite favorite there here hear near dear clear year ' +
    'pleasure measure treasure leisure presser pressed press prayer heater heaters hearth earth heart hearts water waiter later latter matter motor model mode modes moon food good wood moody sleepy sleeping slept sweep steep sheep keep ' +
    'version revision decision division story mystery couch coat coast roast lung long longs lunch brains rain train drain grain phones tones cones stones zones bone kidding status statue stature state states statues alert alarm ' +
    'store stores scare scored core more sore sport report reports support resort score scores vision visions mission missions passion fusion ' +
    'pulse pulses false puls impulse purse nurse glass grass class gloss cardiac card cards guard hard harder breath breathe breather bread ' +
    'coach coaches roaster rooster poster toaster water wait watch history histories mood moods immune summer summary summit some ' +
    'radio ration ratio station nation relation radiator remind reminder minute minutes hours hour seconds second degrees degree celsius fahrenheit ' +
    'bir iki uc dort bes alti yedi sekiz dokuz on yirmi otuz kirk elli altmis yetmis seksen doksan yuz bin ' +
    'durum durumu durumum bugun yarin dun nasil nasilim neden simdi saat dakika gun hafta ay yil benim bana sana onu bunu sunu sey cok iyi kotu guzel ' +
    'kalbim kalbi gozum gozler kas kaslar beyni uyu uyudum ates atesi seker sekeri su suyu sular bardak kalp ' +
    'spring springs strain strained sprint sprang single singles migrate migrated migration numb numbness blocks block locked stolen sweeten swallow ' +
    'vertical diary dairy appendices seizes seized vortex zone zones nobel noble'
  ).split(/\s+/),
)
for (const w of VOCAB) KEEP.add(w)

/** Closest domain word for one token, with its (phonetic) distance; null when nothing is close enough. */
export function fuzzyWord(token: string): { word: string; dist: number } | null {
  const t = fold(token).replace(/[^a-z]/g, '')
  if (t.length < 4 || KEEP.has(t)) return null
  if (VOCAB.some((v) => v.length >= 4 && t.startsWith(v))) return null // a known word with a (Turkish) suffix
  const k = phoneticKey(t)
  let best: { word: string; dist: number } | null = null
  for (const v of VOCAB_KEYS) {
    if (v.k[0] !== k[0]) continue // recognisers rarely get the first sound wrong
    const limit = v.w.length <= 5 ? 1 : 2
    if (Math.abs(v.k.length - k.length) > limit) continue
    const d = editDistance(k, v.k)
    if (d <= limit && (!best || d < best.dist)) best = { word: v.w, dist: d }
  }
  return best && best.word !== t ? best : null
}

/* ---------- table of common mis-recognitions ---------- */

const N = '(?:\\d|a |an |one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|hundred|half|my )'

/** [pattern on folded text, replacement]. Order matters: phrases first. */
export const MISHEARD: [RegExp, string][] = [
  // English
  [/\bblood (?:pleasure|presser|presure|pressures|plessure|preassure|preshure|pressor|pressured)\b/g, 'blood pressure'],
  [/\b(?:hard|heat|hurt|art|hot|harte|heard|hearth) (?:rate|race|raid|rates)\b/g, 'heart rate'],
  [/\bheart (?:race|raid|right|great|wait|8)\b/g, 'heart rate'],
  [/\b(?:s\s?p\s?o\s?(?:2|two|to|too)|spo two|sp02|sp o2|esp o2|spa 2|sbo2|s p o2|spo 2|s po2|sp o 2)\b/g, 'spo2'],
  [/\bpulse ox(?:imeter|imetry)?\b/g, 'oxygen'],
  [/\bblood (?:shugar|suger|sugars|shooger|sucre|shuger)\b/g, 'blood sugar'],
  [/\b(?:glue ?coast|glue cos|glucos|glucoses|gluco's|blue coast)\b/g, 'glucose'],
  [/\b(?:temper ?ture|temp rature|temperatur|tempreture|temperture|temper chair)\b/g, 'temperature'],
  [/\b(?:oxigen|oxygens|ox again|oxy gen)\b/g, 'oxygen'],
  [/\b(?:states|stay ?tus|stats|status's|statues) (?:report|update)\b/g, 'status report'],
  [/\bstatus? sport\b/g, 'status report'],
  [new RegExp(`\\b(?:lock|look|block|lug|lodge|logged|clog)\\b(?= ${N})`, 'g'), 'log'],
  [/\b(?:mils|mls|mil|mill|millis)\b(?= (?:of )?water)/g, 'ml'],
  [/\b(?:milli ?litres?|milli ?liters?)\b/g, 'millilitres'],
  [/\b(?:i drunk|i drinked)\b/g, 'i drank'],
  [/\b(?:excercise|exercize|exorcise|exercises|exercized|exorcised)\b/g, 'exercise'],
  [/\b(?:kidney's|kid knees|kid nee)\b/g, 'kidneys'],
  [/\b(?:the long|the lung)s?\b(?= *$)/g, 'the lungs'],
  [/\b(?:dye ?agnostics|diagnostic's|diagnosis page)\b/g, 'diagnostics'],
  [/\b(?:in vironment|environments)\b/g, 'environment'],
  // Turkish heard by either recogniser (folded)
  [/\b(?:tansyon|tansion|tension|tasiyon|tansiyo\b|tancion)(?=\w*\b)/g, 'tansiyon'],
  [/\b(?:nabis|nabes|nabaz)(?=\w*\b)/g, 'nabiz'],
  [/\b(?:oksjen|oxijen|oksigen|oksjin)(?=\w*\b)/g, 'oksijen'],
  [/\bseke rim\b/g, 'sekerim'],
  [/\bdurum rapor\b(?!u)/g, 'durum raporu'],
  // the extended symptom vocabulary as recognisers mishear it
  [/\b(?:dire rhea|die a rear|dia rear)\b/g, 'diarrhoea'],
  [/\b(?:flem|flegm|phlem|phlegms)\b/g, 'phlegm'],
  [/\b(?:sees your|see sure|seasure|seizer|seize your)\b(?! (?:honou?r|eyes))/g, 'seizure'],
  [/\btooth (?:egg|ake|aches)\b/g, 'toothache'],
  [/\bheart burns?\b/g, 'heartburn'],
  [/\bnose bleeds?\b/g, 'nosebleed'],
  [/\bpink (?:i|a)\b(?= *$)/g, 'pink eye'],
  [/\b(?:chill ?blains|chill ?blanes|chill blames)\b/g, 'chilblains'],
  [/\b(?:sell you light is|cellulite is|cellular itis)\b/g, 'cellulitis'],
  [/\b(?:my grain|my grains|migrane)\b(?= (?:headache|attack|again)| *$)/g, 'migraine'],
  [/\b(?:a pen dix|a pendix)\b/g, 'appendix'],
  [/\b(?:conjunct ivitis|con junk tivitis)\b/g, 'conjunctivitis'],
]

/* ---------- fillers ---------- */

const FILLER_LEAD = /^(?:(?:so|well|okay so|ok so|right|alright|now|hey|you know|i mean|like|actually|basically|sey|yani|hani|simdi|bak|peki)[\s,]+)+/
const FILLER_TAIL = /(?:[\s,]+(?:you know|i mean|or something|like that|yani|iste|falan))+$/

/** Remove hesitation sounds and filler words that carry no meaning ("um", "you know", "şey", "yani"). */
export function stripFillers(folded: string): string {
  let t = folded.replace(/[,]/g, ' , ')
  // "i" alone is a word in English; only drop "ı/ıı" style hesitations that fold to repeated i's
  t = t.replace(/\b(?:um+|uh+|uhm+|erm|hm+|mm+|ehm|ah+|ee+|aa+)\b/g, ' ')
  t = t.replace(/\b(?:ii+)\b/g, ' ')
  t = t.replace(/\s+/g, ' ').trim().replace(/^[\s,]+/, '')
  t = t.replace(FILLER_LEAD, '').replace(FILLER_TAIL, '')
  return t.replace(/\s+,\s+/g, ', ').replace(/\s+/g, ' ').replace(/^,\s*|\s*,$/g, '').trim()
}

/* ---------- the corrector ---------- */

export type Fix = { from: string; to: string; kind: 'table' | 'fuzzy'; dist: number }

/** Folded, filler-free text with table and fuzzy corrections applied, plus the list of changes made. */
export function correct(text: string): { text: string; fixes: Fix[] } {
  const fixes: Fix[] = []
  // Turkish suffixes the recogniser split off ("tansiyon um") are joined before "um" could look like a filler
  let t = stripFillers(fold(text).replace(/\b(tansiyon|nabz|ates|seker|oksijen|uyku|ruh hal|nabiz) (um|im|in|m|imi|umu)\b/g, '$1$2'))
  for (const [re, to] of MISHEARD) {
    t = t.replace(re, (m, ...g) => {
      const out = to.replace(/\$(\d)/g, (_, i) => String(g[Number(i) - 1] ?? ''))
      if (out !== m) fixes.push({ from: m, to: out, kind: 'table', dist: 0 })
      return out
    })
  }
  const words = t.split(' ')
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!/^[a-z']+$/.test(w)) continue
    const f = fuzzyWord(w.replace(/'/g, ''))
    if (!f) continue
    fixes.push({ from: w, to: f.word, kind: 'fuzzy', dist: f.dist })
    words[i] = f.word
  }
  return { text: words.join(' ').replace(/\s+/g, ' ').trim(), fixes }
}

/* ---------- wake word ---------- */

/** "AURA" as recognisers hear it (used by intents.ts to strip a leading wake word from a command). */
export const WAKE_WORDS = '(?:aura|aurora|ora|laura|orah|aurah|awra|oura|hora|auro|or a|our a)'

/*
 * Waking AURA from what the always-on listener hears (English and Turkish recognition, interim or final, any case
 * or punctuation). Three strengths, so chatter does not wake it:
 *  - STRONG spellings of the name ("aura", "avra", ...) are not everyday words: they wake anywhere in an utterance;
 *  - WEAK spellings ("ora", "laura", "hora", "aurora", "or a" ...) are real words or names (Turkish "ora" = "there"):
 *    they wake only after a greeting ("hey ora") or at the start of a phrase ("Ora, what's my pulse");
 *  - after a greeting, any word that sounds like the name (phoneticKey within one edit of "aura" / "ora") wakes too:
 *    "hey aira", "hey oara", "selam aurra".
 * A plain "hey" is handled separately (isBareHey + the standalone rule in recognition.ts).
 */
const WAKE_STRONG = new Set(['aura', 'auraa', 'aurah', 'aurra', 'awra', 'avra', 'ahura', 'auras'])
const WAKE_WEAK = new Set(['oprah', 'ora', 'orah', 'orra', 'oura', 'laura', 'lora', 'lorra', 'hora', 'aurora', 'auro', 'ura', 'oora', 'aora'])
/** two-word spellings of the name */
const WAKE_WEAK2 = new Set(['or a', 'our a', 'a ura', 'aw ra', 'o ra', 'au ra'])
/** words in front of the name: "hey", "hi", "ok", "hello", "selam", "merhaba" and how recognisers spell them */
const WAKE_GREET = new Set(['hey', 'heyy', 'heey', 'hay', 'hei', 'hej', 'ey', 'hi', 'ok', 'okay', 'okey', 'hello', 'helo', 'hallo', 'selam', 'merhaba', 'alo'])
/** greeting and name heard as one word: "heyaura", "heyora", "hayora", "okaura" */
const WAKE_JOINED = /^(?:hey|hay|hei|ey|hi|ok|okay)(?:aura|avra|awra|ora|oura|laura|aurora)$/
/** a plain "hey" as recognisers spell it (English: hey, hay; Turkish: hey, ey, hay) */
const HEY = new Set(['hey', 'heyy', 'heey', 'hay', 'hei', 'hej', 'ey'])
const NAME_KEYS = ['aura', 'ora'].map(phoneticKey)

const wakeKey = (w: string) => fold(w).replace(/[^a-z0-9]/g, '')
const soundsLikeName = (w: string) => {
  if (w.length < 3 || w.length > 6 || !/^[aeiouhl]/.test(w)) return false
  const k = phoneticKey(w)
  return NAME_KEYS.some((n) => editDistance(k, n) <= 1) && !/^(?:are|era|our|all|ale|oil|ali|ara|ola|ela|hla|ore|ire)$/.test(w)
}

export type WakeMatch = { how: 'name'; rest: string; at: number }

/** The first spoken "AURA" (with or without a greeting) in `text`, and the words after it; null when there is none. */
export function matchWake(text: string): WakeMatch | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const keys = words.map(wakeKey)
  const rest = (end: number) => words.slice(end).join(' ').replace(/^[\s,.:;!?-]+/, '')
  /** length (in words) of a name starting at i: 1 or 2, 0 = none; weak/fuzzy spellings only when allowed */
  const nameAt = (i: number, weakOk: boolean): number => {
    const k = keys[i]
    if (!k) return 0
    if (WAKE_STRONG.has(k)) return 1
    if (!weakOk) return 0
    if (i + 1 < keys.length && WAKE_WEAK2.has(`${k} ${keys[i + 1]}`)) return 2
    if (WAKE_WEAK.has(k)) return 1
    return 0
  }
  for (let i = 0; i < words.length; i++) {
    const k = keys[i]
    if (!k) continue
    // a greeting, then the name (any strength, or anything that sounds like it)
    if (WAKE_GREET.has(k) && i + 1 < words.length) {
      const n = nameAt(i + 1, true) || (soundsLikeName(keys[i + 1]) ? 1 : 0)
      if (n) return { how: 'name', rest: rest(i + 1 + n), at: i }
    }
    if (WAKE_JOINED.test(k)) return { how: 'name', rest: rest(i + 1), at: i }
    // the start of a phrase: the first word, or the first after . ! ?
    const phraseStart = i === 0 || /[.!?]$/.test(words[i - 1])
    const n = nameAt(i, phraseStart)
    if (n) return { how: 'name', rest: rest(i + n), at: i }
  }
  return null
}

/** Text after the first wake word anywhere in the utterance (wake mode hears chatter before it); null when absent. */
export function afterWake(text: string): string | null {
  return matchWake(text)?.rest ?? null
}

/** One heard phrase that is only a plain "hey" ("Hey!", "hey hey", "Ey.", "hay"): a candidate for the bare wake. */
export function isBareHey(phrase: string): boolean {
  const keys = phrase.trim().split(/\s+/).map(wakeKey).filter(Boolean)
  return keys.length >= 1 && keys.length <= 2 && keys.every((k) => HEY.has(k))
}

/**
 * What the person asked after waking AURA: the words after "hey AURA" / "AURA", or after a leading plain "hey"
 * (the bare wake). Empty when they only said the wake phrase.
 */
export function wakeRest(text: string): string {
  const m = matchWake(text)
  if (m) return m.rest
  const words = text.trim().split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length && i < 2 && HEY.has(wakeKey(words[i]))) i++
  return words.slice(i).join(' ').replace(/^[\s,.:;!?-]+/, '')
}

/* ---------- language guess ---------- */

const TR_WORDS = new Set('ve bir ne nasil nasilim mi mu kac benim bana beni simdi bugun dun evet hayir lutfen tesekkur tesekkurler merhaba selam goster ac nedir misin musun miyim var yok cok iyi kotu biraz neden saat hava gunaydin iyiyim yorgun yorgunum canim sikiliyor sikildim stresliyim yalniz hissediyorum ruh halim espri fikra kimsin adin adim kac eder arti eksi carpi bolu derece kilo kac misin'.split(' '))
const EN_WORDS = new Set('the is are my what whats how please show open you i me and of to it its was can could would do does did tell your am im today yesterday time weather joke who name thanks thank hello hi hey good morning evening feel feeling tired about why more slower calculate convert in into'.split(' '))
const TR_SUFFIX = /(?:yorum|iyor|iyorum|uyor|imiz|lerim|larim|misin|miyim|sin|siniz|dir|dur|mi|mu|lar|ler|dan|den|nin|nun|sun|im|um)$/

/** 'tr' or 'en' for one utterance; `fallback` breaks ties (usually the language setting). */
export function detectLang(text: string, fallback: 'en' | 'tr' = 'en'): 'en' | 'tr' {
  let tr = (text.match(/[ıİşŞğĞçÇöÖüÜ]/g) ?? []).length * 1.5
  let en = 0
  for (const w of fold(text).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (TR_WORDS.has(w)) tr += 1
    else if (EN_WORDS.has(w.replace(/'/g, ''))) en += 1
    else if (w.length > 4 && TR_SUFFIX.test(w) && !/(?:ing|ed|ly|tion|ness)$/.test(w)) tr += 0.4
  }
  if (Math.abs(tr - en) < 0.5) return fallback
  return tr > en ? 'tr' : 'en'
}

/** Phrases sent to the recogniser for biasing (where supported). */
export const BIAS_PHRASES = [
  'AURA', 'hey AURA', 'blood pressure', 'heart rate', 'oxygen saturation', 'SpO2', 'blood sugar', 'glucose', 'temperature', 'status report', 'alerts', 'health score',
  'diagnostics', 'history', 'environment', 'coach', 'overview', 'lungs', 'kidneys', 'radiation', 'millilitres of water', 'over', 'log', 'mood', 'exercise', 'sleep',
  'tansiyon', 'nabız', 'oksijen', 'ateş', 'şeker', 'uyku', 'durum raporu', 'kalp', 'akciğer', 'böbrek', 'geçmiş', 'ortam', 'antrenman', 'ruh halim',
  'press', 'show numbers', 'scroll down', 'go back', 'details', 'diarrhoea', 'migraine', 'toothache', 'nosebleed', 'seizure', 'phlegm', 'ishal', 'migren', 'bas', 'tıkla',
]
