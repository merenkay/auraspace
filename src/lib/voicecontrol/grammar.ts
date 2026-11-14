// What a spoken (or typed) sentence asks the page to do, in English and Turkish command forms. Deterministic
// patterns on fold()-ed text; it decides only the verb and the target words. Which control is meant is decided
// against the controls actually on screen (resolve.ts).
import { fold } from '../doctor/parse'
import { normalizeNumbers } from '../voice/numbers'

export type ScrollDir = 'up' | 'down' | 'top' | 'bottom'

export type UiCommand =
  /** press a control by name. `soft`: a verb such as "open" or "show" that dedicated intents may claim first. */
  | { kind: 'press'; target: string; ordinal?: number; soft?: boolean; bare?: boolean; want?: 'tab' | 'link' }
  /** choose number n from the numbered badges (-1 = the last one) */
  | { kind: 'number'; n: number }
  | { kind: 'showNumbers' }
  | { kind: 'hideNumbers' }
  | { kind: 'listControls' }
  | { kind: 'scroll'; dir: ScrollDir }
  | { kind: 'scrollTo'; target: string }
  | { kind: 'back' }
  | { kind: 'closeOverlay' }
  | { kind: 'expand'; target: string; open: boolean }
  | { kind: 'expandAll'; open: boolean }
  | { kind: 'check'; target: string; on: boolean }
  | { kind: 'focus'; target: string }
  | { kind: 'type'; text: string; target?: string }
  | { kind: 'clear'; target?: string }
  | { kind: 'submit' }
  | { kind: 'tabStep'; dir: 1 | -1 }

const clean = (t: string) =>
  fold(t)
    .replace(/[?!.;:"“”]/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:please|ok|okay|now|aura|lutfen|hey)\s+)+/, '')
    .replace(/\s+(?:please|lutfen|for me|now|aura)$/, '')
    .trim()

/* ---------- numbers and ordinals ---------- */

const EN_ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, last: -1, '1st': 1, '2nd': 2, '3rd': 3 }
const TR_ORD: Record<string, number> = { birinci: 1, ilk: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6, yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10, son: -1, sonuncu: -1 }
const ORD_SUFFIX = '(?:ye|yi|ya|yu|si|su|sini|sine|sina|suna|e|i|a|u)?'

/** 1..99 from "3", "three", "üç", "number 3", "3rd"; null when it is not a number. */
export function numberOf(w: string): number | null {
  const t = w.trim()
  if (/^\d{1,3}(?:st|nd|rd|th|\.)?$/.test(t)) return parseInt(t, 10)
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
  let m = /^(?:(?:press|click|tap|choose|select|pick|open)\s+)?(?:number|no|numara|#)\s*(.+)$/.exec(f)
  if (m) {
    const n = numberOf(m[1]) ?? ordinalOf(m[1])
    if (n !== null) return { kind: 'number', n }
  }
  m = /^(?:(?:press|click|tap|choose|select|pick)\s+)?(?:the\s+)?(\w+)(?:\s+one)?$/.exec(f)
  if (m) {
    const n = ordinalOf(m[1]) ?? numberOf(m[1])
    if (n !== null) return { kind: 'number', n }
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

/* ---------- the grammar ---------- */

const PRESS_EN = /^(?:press|click|click on|tap|tap on|hit|push|activate|toggle)\s+(?:on\s+)?(.+)$/
const SOFT_EN = /^(?:open|choose|pick|select|go to|show me|show|switch to|take me to|view)\s+(.+)$/
const TYPE_WORDS = /\s+(?:button|link|tab|option|item|checkbox|check box|switch|toggle|chip)$/
const TR_VERB = /^(.+?)\s+(?:(?:butonuna|dugmesine|tusuna|linkine|baglantisina|sekmesine|secenegine|kutusuna|ogesine)\s+)?(bas|tikla|dokun|sec|ac|git|gec)(?:in|iniz|ar misin|abilir misin|ir misin)?$/
const TR_FIELD = /^(.+?)\s+(?:alanina|kutusuna|kismina|bolumune|satirina)\s+(.+?)\s+(?:yaz|gir)$/

function stripTarget(t: string): { target: string; want?: 'tab' | 'link' } {
  let s = t.replace(/^(?:the|a|an)\s+/, '').trim()
  const want = / tab$/.test(s) ? 'tab' : / link$/.test(s) ? 'link' : undefined
  s = s.replace(TYPE_WORDS, '').replace(/\s+(?:butonu|dugmesi|sekmesi|linki)$/, '').trim()
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

/** The page command in a sentence, or null when it is not one. */
export function parseUiCommand(text: string): UiCommand | null {
  const f = clean(text)
  if (!f) return null

  // numbered badges
  if (/^(?:show|display|label|put)\s+(?:the\s+)?numbers(?:\s+on\s+(?:everything|the page|the screen))?$|^numbers on$|^numaralari\s+(?:goster|ac)$|^numara(?:lari)?\s+goster$/.test(f)) return { kind: 'showNumbers' }
  if (/^(?:hide|clear|remove|turn off)\s+(?:the\s+)?numbers$|^numbers off$|^numaralari\s+(?:gizle|kapat|kaldir)$/.test(f)) return { kind: 'hideNumbers' }
  // what is on the page
  if (/\bwhat (?:can|could) i (?:press|click|tap|choose)\b|\bwhat(?:'s| is) (?:on )?(?:this|the) (?:page|screen)\b|\bwhich (?:buttons|controls)\b|\bwhat buttons\b|\bneye basabilirim\b|\bhangi (?:butonlar|dugmeler|tuslar)\b|\bburada ne var\b|\bsayfada ne var\b/.test(f)) return { kind: 'listControls' }

  // scrolling
  let m = /^(?:scroll|go|page|move)\s+(up|down)(?:\s+(?:a bit|a little|more|again))?$/.exec(f) ?? /^(up|down)$/.exec(f)
  if (m) return { kind: 'scroll', dir: m[1] as 'up' | 'down' }
  m = /^(?:scroll|go|jump|move)\s+(?:to\s+)?(?:the\s+)?(top|bottom|start|end)(?:\s+of the page)?$/.exec(f)
  if (m) return { kind: 'scroll', dir: m[1] === 'top' || m[1] === 'start' ? 'top' : 'bottom' }
  if (/^(?:asagi|asagiya)(?:\s+(?:kaydir|in|git))?$/.test(f)) return { kind: 'scroll', dir: 'down' }
  if (/^(?:yukari|yukariya)(?:\s+(?:kaydir|cik|git))?$/.test(f)) return { kind: 'scroll', dir: 'up' }
  if (/^en\s+(?:uste|basa|yukari)(?:\s+(?:cik|git|kaydir|don))?$/.test(f)) return { kind: 'scroll', dir: 'top' }
  if (/^en\s+(?:alta|sona|asagi)(?:\s+(?:in|git|kaydir))?$/.test(f)) return { kind: 'scroll', dir: 'bottom' }
  m = /^scroll\s+(?:down\s+|up\s+)?to\s+(?:the\s+)?(.+?)(?:\s+section)?$/.exec(f) ?? /^(.+?)\s+bolumune\s+(?:git|kaydir|in)$/.exec(f)
  if (m) return { kind: 'scrollTo', target: m[1] }

  // back, close
  if (/^(?:go\s+)?back(?:\s+(?:a page|one page))?$|^previous page$|^geri(?:\s+(?:git|don|gel))?$|^bir onceki sayfa$/.test(f)) return { kind: 'back' }
  if (/^(?:close|dismiss|exit)\s+(?:this|the|that)?\s*(?:dialog|window|popup|pop up|menu|sheet|form|box)$|^(?:pencereyi|menuyu|diyalogu)\s+kapat$/.test(f)) return { kind: 'closeOverlay' }

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

  // tabs
  if (/^(?:next|following)\s+tab$|^sonraki\s+sekme(?:ye\s+(?:gec|git))?$/.test(f)) return { kind: 'tabStep', dir: 1 }
  if (/^(?:previous|last|prior)\s+tab$|^onceki\s+sekme(?:ye\s+(?:gec|git))?$/.test(f)) return { kind: 'tabStep', dir: -1 }

  // checkboxes and switches
  m = /^(?:check|tick|enable|turn on|switch on)\s+(.+)$/.exec(f)
  if (m) return { kind: 'check', target: stripTarget(m[1]).target, on: true }
  m = /^(?:uncheck|untick|disable|turn off|switch off)\s+(.+)$/.exec(f)
  if (m) return { kind: 'check', target: stripTarget(m[1]).target, on: false }
  m = /^(.+?)\s+(?:isaretle|isaretini koy|etkinlestir)$/.exec(f)
  if (m) return { kind: 'check', target: m[1], on: true }
  m = /^(.+?)\s+(?:isaretini kaldir|isaretini sil|devre disi birak)$/.exec(f)
  if (m) return { kind: 'check', target: m[1], on: false }

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
  m = /^(?:focus(?:\s+on)?|go to|click in|click into|select|jump to)\s+(?:the\s+)?(.+?)\s+(?:field|box|input)$/.exec(f) ?? /^focus(?:\s+on)?\s+(?:the\s+)?(.+)$/.exec(f)
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
  if (m && !/^(?:voice|aura|the voice panel|the panel|yourself)$/.test(m[1])) return { kind: 'expand', target: stripTarget(m[1]).target, open: false }

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
    return { kind: 'press', ...withOrdinal(target), soft: true, want }
  }
  m = TR_VERB.exec(f)
  if (m) {
    const soft = m[2] === 'ac' || m[2] === 'git' || m[2] === 'gec' || m[2] === 'sec'
    const t = m[1].trim()
    const tm = /^(\S+)\s+(.+)$/.exec(t)
    const o = tm ? ordinalOf(tm[1]) : null
    return o !== null && tm ? { kind: 'press', target: tm[2], ordinal: o, soft } : { kind: 'press', target: t, soft }
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
    if (clean(run) === folded) return run.replace(/^["'“]|["'”.,!?]$/g, '')
  }
  return folded
}
