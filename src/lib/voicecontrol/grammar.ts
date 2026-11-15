// What a spoken (or typed) sentence asks the page to do, in English and Turkish command forms. Deterministic
// patterns on fold()-ed text; it decides only the verb and the target words. Which control is meant is decided
// against the controls actually on screen (scan.ts resolve).
//
// Speech arrives without punctuation and with the words people really use: politeness ("can you press the
// details button please"), fillers ("um press uh save"), wake words, mis-heard verbs ("prez", "price"), and
// Turkish word order with the verb last ("details butonuna bas", "raporu gönder").
import { fold } from '../doctor/parse'
import { extractNumbers, normalizeNumbers } from '../voice/numbers'
import { roleHint } from './names'

export type ScrollDir = 'up' | 'down' | 'top' | 'bottom' | 'middle'
export type ScrollAmount = 'little' | 'lot' | 'page'
export type RoleWant = 'tab' | 'link' | 'button' | 'checkbox' | 'field' | 'menu'

export type UiCommand =
  /** press a control by name. `soft`: a verb such as "open" or "show" that dedicated intents may claim first. */
  | { kind: 'press'; target: string; ordinal?: number; soft?: boolean; bare?: boolean; want?: RoleWant; verb?: string }
  /** choose number n from the numbered badges (-1 = the last one) */
  | { kind: 'number'; n: number }
  | { kind: 'showNumbers' }
  | { kind: 'hideNumbers' }
  | { kind: 'listControls' }
  | { kind: 'helpPage' }
  | { kind: 'whereAmI' }
  | { kind: 'readPage' }
  | { kind: 'readSection'; which: 'next' | 'previous' | 'this' | 'named'; target?: string }
  | { kind: 'scroll'; dir: ScrollDir; amount?: ScrollAmount }
  | { kind: 'scrollTo'; target: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'closeOverlay' }
  | { kind: 'expand'; target: string; open: boolean }
  | { kind: 'expandAll'; open: boolean }
  | { kind: 'check'; target: string; on: boolean }
  | { kind: 'focus'; target: string }
  | { kind: 'type'; text: string; target?: string }
  | { kind: 'clear'; target?: string }
  | { kind: 'submit' }
  | { kind: 'tabStep'; dir: 1 | -1 }
  /** next / previous / first / last in the current tab group or list (or a control called Next / Previous) */
  | { kind: 'step'; to: 'next' | 'previous' | 'first' | 'last'; what?: 'tab' | 'item' }
  | { kind: 'select'; option: string; target?: string }
  | { kind: 'search'; text: string }
  | { kind: 'setValue'; target: string; value?: number; delta?: number }
  | { kind: 'undo' }
  | { kind: 'again' }
  /** stop listening / pause voice (the agent closes the panel) */
  | { kind: 'sleep' }
  | { kind: 'resume' }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Words that name a kind of control, not a control. */
const ROLE_WORD = /^(?:button|link|tab|page|menu|core|section|butonuna|butonu|dugmesine|sekmesine|sekmesi|linkine|sayfasina|sayfasini|menusunu|home)\b/

/** A recogniser's spelling of a sentence -> the plain command words. */
export function prep(text: string): string {
  let f = fold(text)
    .replace(/[?!.;:"“”,]/g, ' ')
    .replace(/\b(?:um+|uh+|uhm+|erm+|hmm+|mm+|ehm|eh|ah+|ee+|sey|hani|yani)\b/g, ' ')
  f = squash(f)
  for (let i = 0; i < 4; i++) {
    const before = f
    f = f.replace(/^(?:please|pls|ok|okay|now|hey|so|well|right|alright|just|lutfen|also|and then|and|then|oh)\s+/, '')
    // a wake word in front ("aura press details"), but not the label AURA itself ("AURA butonuna bas", "aura link")
    const wake = /^(?:(?:hey|ok|okay|hi)\s+)?(?:aura|ora|aurora|laura|oura)\s+(.+)$/.exec(f)
    if (wake && !ROLE_WORD.test(wake[1]) && !/^(?:bas|tikla|dokun|ac|git|gec|sec)$/.test(wake[1])) f = wake[1]
    f = f.replace(/^(?:can you|could you|would you|will you|can u|could u|would you mind|would you kindly|i want to|i wanna|i'd like to|id like to|i would like to|i want you to|i need to|i need you to|let's|lets|let us|go ahead and|try to|help me|you can|you should|i said)\s+/, '')
    f = f.replace(/\s+(?:please|pls|for me|now|thanks|thank you|lutfen|right now|if you can|real quick)$/, '')
    if (f === before) break
  }
  // mis-heard verbs at the start
  f = f
    .replace(/^(?:prez|prezz|pres|price|prize|prays|preys|bress|brest|crest|presses|pressed|pressing)\s+/, 'press ')
    .replace(/^(?:clique|klick|clicked|clicking|clicks|quick)\s+/, 'click ')
    .replace(/^(?:tapped|taps|top on)\s+/, 'tap ')
    .replace(/^(?:hits|hitting)\s+/, 'hit ')
    .replace(/^(?:open up|opened|opens|bring up|pull up|navigate to|head to|head over to|move to|jump to|go into|let me see|i want to see|get me to|bring me to)\s+/, 'open ')
    .replace(/^(?:go over to|go back to the|go to the)\s+/, (m) => (m.startsWith('go back') ? 'go to the ' : m))
  return squash(f)
}

/* ---------- numbers and ordinals ---------- */

const EN_ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, last: -1, '1st': 1, '2nd': 2, '3rd': 3 }
const TR_ORD: Record<string, number> = { birinci: 1, ilk: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6, yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10, son: -1, sonuncu: -1 }
const ORD_SUFFIX = '(?:ye|yi|ya|yu|si|su|sini|sine|sina|suna|e|i|a|u)?'

/** 1..999 from "3", "three", "üç", "number 3", "3rd", "twelve"; null when it is not a number. */
export function numberOf(w: string): number | null {
  const t = w.trim()
  if (/^\d{1,3}(?:st|nd|rd|th|\.)?$/.test(t)) return parseInt(t, 10)
  if (t === 'on') return null // English "on" far more often than Turkish ten when alone
  if (t === 'to' || t === 'too') return 2
  if (t === 'for') return 4
  const n = normalizeNumbers(t, true).trim()
  if (/^\d{1,3}$/.test(n)) return parseInt(n, 10)
  const n2 = normalizeNumbers(t, false).trim()
  if (/^\d{1,3}$/.test(n2)) return parseInt(n2, 10)
  return null
}

/** "first", "the second one", "ikinci", "ikinciye", "sonuncu" -> 1, 2, 2, 2, -1 */
export function ordinalOf(w: string): number | null {
  const t = w.replace(/^the\s+/, '').replace(/\s+one$/, '').trim()
  if (EN_ORD[t] !== undefined) return EN_ORD[t]
  if (/^\d+(?:st|nd|rd|th)$/.test(t)) return parseInt(t, 10)
  const m = new RegExp(`^(${Object.keys(TR_ORD).join('|')})${ORD_SUFFIX}$`).exec(t)
  return m ? TR_ORD[m[1]] : null
}

function numberCommand(f: string): UiCommand | null {
  let m = /^(?:(?:press|click|tap|choose|select|pick|open|hit)\s+)?(?:number|numero|numara|#)\s*(.+)$/.exec(f)
  if (m) {
    const n = numberOf(m[1]) ?? ordinalOf(m[1])
    if (n !== null) return { kind: 'number', n }
  }
  m = /^(?:(?:press|click|tap|choose|select|pick|hit)\s+)?(?:the\s+)?(\w+)(?:\s+one)?$/.exec(f)
  if (m && m[1] !== 'on') {
    const n = ordinalOf(m[1]) ?? numberOf(m[1])
    if (n !== null) return { kind: 'number', n }
  }
  // "press twenty three", "number twenty three"
  m = /^(?:press|click|tap|choose|select|pick|hit)\s+(.+)$/.exec(f)
  if (m && /^[a-z ]+$/.test(m[1]) && m[1].split(' ').length <= 3) {
    const n = normalizeNumbers(m[1], false).trim()
    if (/^\d{1,3}$/.test(n)) return { kind: 'number', n: parseInt(n, 10) }
  }
  // Turkish: "ikinci", "ikinciye bas", "üç numara", "3 numaraya bas", "beşe bas"
  m = /^(.+?)\s*(?:numara(?:ya|yi|li|da)?)?(?:\s+(?:bas|tikla|dokun|sec|ac))?$/.exec(f)
  if (m && /\b(?:bas|tikla|dokun|sec|numara\w*)\b/.test(f)) {
    const word = m[1].replace(/'?(?:ye|ya|e|a|yi|i)$/, '')
    const n = ordinalOf(m[1]) ?? numberOf(word) ?? numberOf(m[1])
    if (n !== null) return { kind: 'number', n }
  }
  if (ordinalOf(f) !== null) return { kind: 'number', n: ordinalOf(f)! }
  return null
}

/* ---------- targets ---------- */

const ROLE_TAIL = /\s+(?:button|buttons|link|tab|option|item|checkbox|check box|switch|toggle|chip|icon|card|menu|page|section|screen|butonu|butonuna|butonunu|dugmesi|dugmesine|tusu|tusuna|sekmesi|sekmesine|linki|linkine|sayfasi|sayfasina|sayfasini|menusu|menusunu|menuyu|bolumu|bolumunu)$/

function stripTarget(t: string): { target: string; want?: RoleWant } {
  const want = roleHint(t)
  let s = t.replace(/^(?:on\s+)?(?:the|a|an|this|that|my)\s+/, '').trim()
  for (let i = 0; i < 2; i++) s = s.replace(ROLE_TAIL, '').trim()
  s = s.replace(/^(?:the|a|an)\s+/, '').trim()
  return { target: s, want }
}

function withOrdinal(t: string): { target: string; ordinal?: number } {
  const m = /^(?:the\s+)?(\S+)\s+(.+)$/.exec(t)
  if (m) {
    const o = ordinalOf(m[1])
    if (o !== null) return { target: m[2], ordinal: o }
  }
  return { target: t }
}

/* ---------- the grammar ---------- */

const PRESS_EN = /^(?:press|click|click on|tap|tap on|hit|push|activate|toggle|trigger|use)\s+(?:on\s+)?(.+)$/
const SOFT_EN = /^(?:open|choose|pick|select|go to|show me|show|switch to|take me to|view|display|start|launch|visit)\s+(.+)$/
/** Turkish: object then verb ("details butonuna bas", "geçmişe git", "kaydete tıkla"), with polite endings. */
const TR_VERB = /^(.+?)\s+(bas|tikla|dokun|sec|ac|git|gec|calistir|goster)(?:in|iniz|ar misin|er misin|ir misin|abilir misin|ebilir misin|sana|sene|ar mi|er mi)?$/
/** Turkish verbs that are themselves part of an English label: "raporu gönder" = "send report". */
const TR_OBJ_VERB: [RegExp, string][] = [
  [/^gonder/, 'send'],
  [/^ekle/, 'add'],
  [/^kaydet/, 'save'],
  [/^sil/, 'delete'],
  [/^baslat/, 'start'],
  [/^durdur/, 'stop'],
  [/^duraklat/, 'pause'],
  [/^indir/, 'download'],
  [/^yenile/, 'refresh'],
  [/^gizle/, 'hide'],
  [/^olc/, 'measure'],
  [/^yakinlastir/, 'zoom in'],
  [/^uzaklastir/, 'zoom out'],
  [/^dondur/, 'rotate'],
  [/^onayla/, 'confirm'],
  [/^oynat/, 'play'],
  [/^yap/, ''],
  [/^et/, ''],
]
const TR_POLITE = '(?:in|iniz|ar misin|er misin|ir misin|abilir misin|ebilir misin|sana|sene)?'
const TR_FIELD = /^(.+?)\s+(?:alanina|kutusuna|kismina|bolumune|satirina)\s+(.+?)\s+(?:yaz|gir)$/

/** The page command in a sentence, or null when it is not one. */
export function parseUiCommand(text: string): UiCommand | null {
  const f = prep(text)
  if (!f) return null

  // a Turkish press verb at the end decides first ("expand all butonuna bas", "turn on hand control'a tıkla")
  if (/\s(?:bas|tikla|dokun)(?:in|iniz|ar misin|ir misin|abilir misin|ebilir misin)?$/.test(f)) {
    const n = numberCommand(f)
    if (n) return n
    const p = trPress(f)
    if (p) return p
  }

  // numbered badges, help, where am I, reading the page
  if (/^(?:show|display|label|put|turn on)\s+(?:the\s+)?numbers(?:\s+on\s+(?:everything|the page|the screen|it))?$|^numbers(?: on)?$|^(?:show|label) (?:the )?(?:buttons|controls)$|^numaralari\s+(?:goster|ac)$|^numara(?:lari)?\s+goster$/.test(f)) return { kind: 'showNumbers' }
  if (/^(?:hide|clear|remove|turn off)\s+(?:the\s+)?numbers$|^numbers off$|^numaralari\s+(?:gizle|kapat|kaldir)$/.test(f)) return { kind: 'hideNumbers' }
  if (/^(?:help|commands)\s+(?:here|on this page|for this page)$|^what (?:can|could) i (?:say|do) (?:here|on this page)$|^things (?:i|you) can say(?: here)?$|^(?:bu sayfada|burada) ne (?:diyebilirim|soyleyebilirim|yapabilirim)$|^komutlar$/.test(f)) return { kind: 'helpPage' }
  if (/\bwhat (?:can|could) i (?:press|click|tap|choose)\b|\bwhat(?:'s| is) (?:on )?(?:this|the) (?:page|screen)\b|\bwhats on (?:this|the) (?:page|screen)\b|\bwhich (?:buttons|controls)\b|\bwhat buttons\b|\bneye basabilirim\b|\bhangi (?:butonlar|dugmeler|tuslar)\b|\bburada ne var\b|\bsayfada ne var\b/.test(f)) return { kind: 'listControls' }
  if (/^(?:where am i|what page is this|which page is this|what page am i on|which page am i on|what screen is this|neredeyim|hangi sayfadayim|bu hangi sayfa|hangi sayfa bu)$/.test(f)) return { kind: 'whereAmI' }
  if (/^(?:read (?:the |this )?(?:whole )?(?:page|screen)|read (?:it|everything)(?: out)?|sayfayi oku|ekrani oku)$/.test(f)) return { kind: 'readPage' }
  if (/^(?:read (?:the )?next(?: section| part| one)?|next section|continue reading|keep reading|sonraki bolumu oku|sonraki bolum|devam et okumaya|okumaya devam)$/.test(f)) return { kind: 'readSection', which: 'next' }
  if (/^(?:read (?:the )?previous(?: section)?|previous section|onceki bolumu oku)$/.test(f)) return { kind: 'readSection', which: 'previous' }
  if (/^(?:read (?:this|the) section|read (?:this|that)|bu bolumu oku|burayi oku)$/.test(f)) return { kind: 'readSection', which: 'this' }
  let m = /^read (?:the |out )?(?!aloud\b)(.+?)(?: section)?$/.exec(f) ?? /^(.+?) (?:bolumunu|kismini) oku$/.exec(f)
  if (m) return { kind: 'readSection', which: 'named', target: m[1] }

  // listening itself
  if (/^(?:stop listening|pause (?:voice|listening|aura|the voice)|go to sleep|mute (?:yourself|voice|the microphone)|turn off (?:voice|listening|the microphone)|dinlemeyi (?:durdur|birak|kapat)|sesi duraklat|mikrofonu kapat)$/.test(f)) return { kind: 'sleep' }
  if (/^(?:resume|resume listening|start listening|wake up|keep listening|dinlemeye devam(?: et)?|devam et)$/.test(f)) return { kind: 'resume' }

  // undo, again
  if (/^(?:undo(?: that| it| this| the last (?:one|step|press|click))?|cancel that|take (?:that|it) back|revert(?: that)?|put it back|geri al|son islemi geri al|onu geri al)$/.test(f)) return { kind: 'undo' }
  if (/^(?:(?:press|click|tap|hit) (?:it|that|this) again|again|do (?:it|that) again|same again|one more time|tekrar bas|bir daha bas|yine bas|tekrar tikla|bir daha tikla)$/.test(f)) return { kind: 'again' }

  // scrolling
  m = /^(?:scroll|go|page|move)\s+(up|down)(?:\s+(a bit|a little|a little bit|slightly|a tad|a lot|lots|much more|way down|way up|more|again|one page|a page))?$/.exec(f) ?? /^(up|down)$/.exec(f)
  if (m) {
    const a = m[2]
    const amount: ScrollAmount | undefined = !a ? undefined : /bit|little|slightly|tad/.test(a) ? 'little' : /lot|lots|much|way/.test(a) ? 'lot' : /page/.test(a) ? 'page' : undefined
    return { kind: 'scroll', dir: m[1] as 'up' | 'down', amount: f.startsWith('page ') ? 'page' : amount }
  }
  m = /^scroll\s+(?:a\s+)?(little|bit|lot)\s+(up|down)?$/.exec(f)
  if (m) return { kind: 'scroll', dir: (m[2] ?? 'down') as 'up' | 'down', amount: m[1] === 'lot' ? 'lot' : 'little' }
  m = /^(?:scroll|go|jump|move)\s+(?:to\s+)?(?:the\s+)?(top|bottom|start|end|middle|centre|center)(?:\s+of(?: the)? page)?$/.exec(f)
  if (m) return { kind: 'scroll', dir: m[1] === 'top' || m[1] === 'start' ? 'top' : m[1] === 'bottom' || m[1] === 'end' ? 'bottom' : 'middle' }
  if (/^(?:biraz\s+)?(?:asagi|asagiya)(?:\s+(?:kaydir|in|git|in biraz))?$/.test(f)) return { kind: 'scroll', dir: 'down', amount: /^biraz/.test(f) ? 'little' : undefined }
  if (/^(?:biraz\s+)?(?:yukari|yukariya)(?:\s+(?:kaydir|cik|git))?$/.test(f)) return { kind: 'scroll', dir: 'up', amount: /^biraz/.test(f) ? 'little' : undefined }
  if (/^cok\s+(?:asagi|asagiya)(?:\s+\w+)?$/.test(f)) return { kind: 'scroll', dir: 'down', amount: 'lot' }
  if (/^cok\s+(?:yukari|yukariya)(?:\s+\w+)?$/.test(f)) return { kind: 'scroll', dir: 'up', amount: 'lot' }
  if (/^sayfa\s+(?:asagi|asagiya)$/.test(f)) return { kind: 'scroll', dir: 'down', amount: 'page' }
  if (/^sayfa\s+(?:yukari|yukariya)$/.test(f)) return { kind: 'scroll', dir: 'up', amount: 'page' }
  if (/^en\s+(?:uste|basa|yukari)(?:\s+(?:cik|git|kaydir|don))?$/.test(f)) return { kind: 'scroll', dir: 'top' }
  if (/^en\s+(?:alta|sona|asagi)(?:\s+(?:in|git|kaydir))?$/.test(f)) return { kind: 'scroll', dir: 'bottom' }
  if (/^(?:ortaya|sayfanin ortasina)\s+(?:git|kaydir|in)$/.test(f)) return { kind: 'scroll', dir: 'middle' }
  m = /^scroll\s+(?:down\s+|up\s+)?to\s+(?:the\s+)?(.+?)(?:\s+section)?$/.exec(f) ?? /^(.+?)\s+(?:bolumune|kismina)\s+(?:git|kaydir|in)$/.exec(f)
  if (m) return { kind: 'scrollTo', target: m[1] }

  // back, forward, close
  if (/^(?:go\s+)?back(?:\s+(?:a page|one page|to the previous page))?$|^previous page$|^geri(?:\s+(?:git|don|gel))?$|^bir onceki sayfa(?:ya don)?$|^onceki sayfaya (?:don|git)$/.test(f)) return { kind: 'back' }
  if (/^(?:go\s+)?forward(?:\s+(?:a page|one page))?$|^next page$|^ileri(?:\s+git)?$|^sonraki sayfaya git$/.test(f)) return { kind: 'forward' }
  if (/^(?:close|dismiss|exit|hide)\s+(?:this|the|that)?\s*(?:dialog|window|popup|pop up|menu|sheet|form|box|panel|drawer|overlay)$|^(?:pencereyi|menuyu|diyalogu|paneli)\s+kapat$/.test(f)) return { kind: 'closeOverlay' }

  // expand / collapse
  if (/^(?:expand|open|show|unfold)\s+(?:all|everything)(?:\s+sections)?$|^tumunu\s+(?:ac|genislet)$|^hepsini\s+ac$/.test(f)) return { kind: 'expandAll', open: true }
  if (/^(?:collapse|close|fold|hide)\s+(?:all|everything)(?:\s+sections)?$|^tumunu\s+(?:kapat|daralt)$|^hepsini\s+kapat$/.test(f)) return { kind: 'expandAll', open: false }
  m = /^(?:expand|unfold)\s+(.+)$/.exec(f)
  if (m) return { kind: 'expand', target: stripTarget(m[1]).target.replace(/\s+section$/, ''), open: true }
  m = /^(?:collapse|fold)\s+(.+)$/.exec(f)
  if (m) return { kind: 'expand', target: stripTarget(m[1]).target.replace(/\s+section$/, ''), open: false }
  m = /^(.+?)\s+(?:bolumunu\s+)?(?:genislet)$/.exec(f)
  if (m) return { kind: 'expand', target: m[1], open: true }
  m = /^(.+?)\s+(?:bolumunu\s+)?(?:daralt)$/.exec(f)
  if (m) return { kind: 'expand', target: m[1], open: false }

  // tabs and lists: next / previous / first / last
  if (/^(?:next|following)\s+tab$|^(?:bir\s+)?sonraki\s+sekme(?:ye\s+(?:gec|git))?$/.test(f)) return { kind: 'tabStep', dir: 1 }
  if (/^(?:previous|prior)\s+tab$|^(?:bir\s+)?onceki\s+sekme(?:ye\s+(?:gec|git))?$/.test(f)) return { kind: 'tabStep', dir: -1 }
  m = /^(?:go to |select |open |show )?(?:the )?(next|previous|prev|first|last)(?:\s+(tab|item|vital|option|entry|system))?$/.exec(f)
  if (m && (m[1] === 'next' || m[1] === 'previous' || m[1] === 'prev' || m[2])) {
    const to = m[1] === 'prev' ? 'previous' : (m[1] as 'next' | 'previous' | 'first' | 'last')
    return { kind: 'step', to, what: m[2] === 'tab' ? 'tab' : m[2] ? 'item' : undefined }
  }
  m = /^(?:bir\s+)?(sonraki|onceki|ilk|son)(?:\s+(sekme|oge|madde))?(?:ye|ya|e|a)?(?:\s+(?:gec|git))?$/.exec(f)
  if (m && (m[1] === 'sonraki' || m[1] === 'onceki' || m[2])) {
    const to = m[1] === 'sonraki' ? 'next' : m[1] === 'onceki' ? 'previous' : m[1] === 'ilk' ? 'first' : 'last'
    return { kind: 'step', to, what: m[2] === 'sekme' ? 'tab' : m[2] ? 'item' : undefined }
  }

  // checkboxes and switches
  m = /^(?:check|tick|enable|switch on|mark)\s+(.+)$/.exec(f)
  if (m && !/^(?:my|the time|status|how)\b/.test(m[1])) return { kind: 'check', target: stripTarget(m[1]).target, on: true }
  m = /^(?:uncheck|untick|disable|switch off|unmark)\s+(.+)$/.exec(f)
  if (m) return { kind: 'check', target: stripTarget(m[1]).target, on: false }
  m = /^(.+?)\s+(?:isaretle|isaretini koy|etkinlestir)$/.exec(f)
  if (m) return { kind: 'check', target: m[1], on: true }
  m = /^(.+?)\s+(?:isaretini kaldir|isaretini sil|devre disi birak)$/.exec(f)
  if (m) return { kind: 'check', target: m[1], on: false }

  // numeric fields and steppers
  m = /^set\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/.exec(f)
  if (m) {
    const v = extractNumbers(m[2])[0]
    if (v !== undefined) return { kind: 'setValue', target: stripTarget(m[1]).target, value: v }
  }
  m = /^(increase|raise|turn up|bump up|decrease|lower|reduce|turn down)\s+(?:the\s+)?(.+?)(?:\s+by\s+(.+))?$/.exec(f)
  if (m) {
    const up = /increase|raise|up/.test(m[1])
    const by = m[3] ? (extractNumbers(m[3])[0] ?? 1) : 1
    return { kind: 'setValue', target: stripTarget(m[2]).target, delta: up ? by : -by }
  }
  m = /^(.+?)\s+(artir|yukselt|azalt|dusur)$/.exec(f)
  if (m) return { kind: 'setValue', target: m[1].replace(/(?:yi|yu|i|u)$/, ''), delta: /artir|yukselt/.test(m[2]) ? 1 : -1 }
  m = /^(.+?)\s+(\S+)\s+yap$/.exec(f)
  if (m && extractNumbers(m[2], true).length) return { kind: 'setValue', target: m[1].replace(/'?(?:yi|yu|i|u)$/, ''), value: extractNumbers(m[2], true)[0] }

  // search and filter
  m = /^(?:search|filter|look up|look for)\s+(?:for\s+|by\s+)?(.+)$/.exec(f)
  if (m && !/^(?:the|a)\s+(?:button|link|tab)\b/.test(m[1])) return { kind: 'search', text: rawTail(text, m[1]) }
  m = /^(.+?)\s+(?:ara|diye ara|icin ara)$/.exec(f)
  if (m) return { kind: 'search', text: rawTail(text, m[1]) }

  // fields: focus, dictate, clear, submit
  m = TR_FIELD.exec(f)
  if (m) return { kind: 'type', target: m[1], text: rawTail(text, m[2]) }
  m = /^(?:type|write|enter|dictate|input)\s+(.+)$/.exec(f)
  if (m) {
    const into = /^(.+?)\s+(?:into|in|in to|on)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|input))?$/.exec(m[1])
    return into ? { kind: 'type', text: rawTail(text, into[1]), target: into[2] } : { kind: 'type', text: rawTail(text, m[1]) }
  }
  m = /^(?:yaz|gir)\s+(.+)$/.exec(f) ?? /^(.+?)\s+yaz$/.exec(f)
  if (m) return { kind: 'type', text: rawTail(text, m[1]) }
  m = /^(?:focus(?:\s+on)?|go to|click in|click into|click on|select|jump to|open)\s+(?:the\s+)?(.+?)\s+(?:field|box|input|text box)$/.exec(f) ?? /^focus(?:\s+on)?\s+(?:the\s+)?(.+)$/.exec(f)
  if (m) return { kind: 'focus', target: m[1] }
  m = /^(.+?)\s+(?:alanina|kutusuna)\s+(?:git|odaklan|tikla|gec)$/.exec(f)
  if (m) return { kind: 'focus', target: m[1] }
  if (/^(?:clear|erase|empty)(?:\s+(?:it|this|that|the field|the text|this field))?$|^(?:temizle|sil)$|^alani\s+(?:temizle|sil)$/.test(f)) return { kind: 'clear' }
  m = /^(?:clear|erase|empty)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|input))?$/.exec(f) ?? /^(.+?)\s+(?:alanini|kutusunu)\s+(?:temizle|sil|bosalt)$/.exec(f)
  if (m) return { kind: 'clear', target: m[1] }
  if (/^(?:submit|send)(?:\s+(?:it|this|the form|this form))?$|^(?:formu\s+)?gonder$/.test(f)) return { kind: 'submit' }

  // choosing a number (badges, disambiguation)
  const num = numberCommand(f)
  if (num) return num

  // closing alone ("close") is the voice panel's own intent; "close <name>" collapses or presses that control
  m = /^close\s+(.+)$/.exec(f)
  if (m && !/^(?:voice|aura|the voice panel|the panel|yourself|it)$/.test(m[1])) return { kind: 'expand', target: stripTarget(m[1]).target, open: false }
  m = /^(.+?)\s+(?:'?(?:yi|yu|i|u|ı)\s+)?kapat$/.exec(f)
  if (m && !/^(?:sesi|mikrofonu|paneli|seni)$/.test(m[1])) return { kind: 'expand', target: m[1].replace(/'?(?:yi|yu|i|u)$/, ''), open: false }

  // Turkish: the verb comes last ("details butonuna bas", "geçmişe git", "aura'ya tıkla")
  const tr = trPress(f)
  if (tr) return tr
  return trObject(f, text)
}

function trPress(f: string): UiCommand | null {
  const m = TR_VERB.exec(f)
  if (m) {
    const soft = m[2] === 'ac' || m[2] === 'git' || m[2] === 'gec' || m[2] === 'sec' || m[2] === 'goster'
    const { target, want } = stripTarget(m[1].trim())
    const tm = /^(\S+)\s+(.+)$/.exec(target)
    const o = tm ? ordinalOf(tm[1]) : null
    return o !== null && tm ? { kind: 'press', target: tm[2], ordinal: o, soft, want } : { kind: 'press', target, soft, want }
  }
  return null
}

function trObject(f: string, text: string): UiCommand | null {
  let m: RegExpExecArray | null
  for (const [re, en] of TR_OBJ_VERB) {
    const om = new RegExp(`^(.+?)\\s+(${re.source.slice(1)}\\w*?)${TR_POLITE}$`).exec(f)
    if (!om) continue
    const obj = om[1].trim()
    // a Turkish label said whole ("ölçüm ekle", "çıkış yap") is matched through the alias table
    return { kind: 'press', target: en ? `${f}|${en} ${obj.replace(/'?(?:yi|yu|i|u)$/, '')}` : f, soft: true, verb: en || 'tr' }
  }

  // logging a measurement by name, with no value ("log blood pressure", "record sleep"): a menu may hold it
  m = /^(?:log|record|add|enter|measure|new)\s+(?:a\s+|an\s+|my\s+|the\s+)?(.+)$/.exec(f)
  if (m && !extractNumbers(text).length && !/\b(?:and|then|ve|sonra)\b/.test(m[1])) return { kind: 'press', target: f, soft: true, verb: 'log' }

  // pressing by name
  m = PRESS_EN.exec(f)
  if (m) {
    const { target, want } = stripTarget(m[1])
    if (!target) return null
    return { kind: 'press', ...withOrdinal(target), want }
  }
  m = SOFT_EN.exec(f)
  if (m) {
    const { target, want } = stripTarget(m[1])
    if (!target) return null
    return { kind: 'press', ...withOrdinal(target), soft: true, want, verb: /^(?:choose|pick|select)\b/.test(f) ? 'select' : undefined }
  }
  return null
}

/** The words of `folded` as the person said them (keeps case, Turkish letters and digits for dictation). */
function rawTail(raw: string, folded: string): string {
  const words = raw.trim().split(/\s+/)
  const n = folded.split(' ').length
  // the dictated text is at the start (TR "X yaz") or end (EN "type X"); find the run of words that folds to it
  for (let i = 0; i + n <= words.length; i++) {
    const run = words.slice(i, i + n).join(' ')
    if (prep(run) === folded || squash(fold(run).replace(/[?!.;:"“”,]/g, ' ')) === folded) return run.replace(/^["'“]|["'”.,!?]$/g, '')
  }
  return folded
}

/* ---------- chains: "open history and show sleep", "scroll down then press details" ---------- */

const CHAIN_SPLIT = /\s+(?:and then|then|and after that|after that|and also|and|sonra|ondan sonra|daha sonra|ardindan|ve)\s+/
const STARTS_COMMAND = /^(?:(?:please|then|now)\s+)?(?:press|click|tap|hit|push|open|show|go|take|switch|select|choose|pick|scroll|close|expand|collapse|read|type|focus|log|record|search|filter|find|check|uncheck|tick|undo|zoom|turn|set|increase|decrease|next|previous|back|forward|display|view|start|play|pause)\b/
const ENDS_TR_COMMAND = /\s(?:bas|tikla|dokun|sec|ac|git|gec|gonder|kaydet|ekle|kapat|kaydir|in|cik|goster|oku|don)(?:in|iniz)?$/

/**
 * Split a run-on sentence into separate commands, or return null when it is one request. Every part after the
 * first must itself begin like a command ("open history and show sleep"), so names that contain "and"
 * ("Lungs & Oxygen", "Brain and behaviour") are never cut.
 */
export function splitChain(text: string): string[] | null {
  const f = fold(text).replace(/[?!.;:"“”]/g, ' ').replace(/\s*,\s*/g, ' and ').replace(/\s+/g, ' ').trim()
  const parts = f.split(CHAIN_SPLIT).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 4) return null
  const isCmd = (p: string) => STARTS_COMMAND.test(prep(p)) || ENDS_TR_COMMAND.test(` ${p}`) || /^(?:scroll|asagi|yukari|geri)\b/.test(p)
  if (!parts.every(isCmd)) return null
  return parts
}
