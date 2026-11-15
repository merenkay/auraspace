// Corpus-driven test: for every control on every captured page (role x page x screen size), the natural ways of
// naming it (corpus.ts) must reach that control through the real pipeline (understand -> route -> VoiceControl),
// and symptom / crisis sentences must never press anything. Prints a pass-rate table per page.
import { describe, expect, it } from 'vitest'
import { understand } from '../assistant/route'
import { parseFindings } from '../doctor/parse'
import { parseIntent, pathFor } from '../voice/intents'
import { VoiceControl, type Effects } from './controller'
import { humanLabel, NEVER_PRESS, utterancesFor, type RawControl, type RawPage } from './corpus'
import pagesJson from './fixtures/pages.json'
import type { Box, Control, UiNode } from './scan'

const PAGES = pagesJson as RawPage[]
const ENV = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}) as Record<string, string | undefined>

/* ---------- a fake page built from a captured control list ---------- */

class F implements UiNode {
  tag: string
  attrs: Record<string, string>
  kids: F[]
  txt: string
  up: F | null = null
  raw?: RawControl
  constructor(tag: string, attrs: Record<string, string>, kids: F[] = [], txt = '') {
    this.tag = tag
    this.attrs = attrs
    this.kids = kids
    this.txt = txt
    for (const k of kids) k.up = this
  }
  get ref() {
    return this
  }
  attr(n: string) {
    return this.attrs[n] ?? null
  }
  children() {
    return this.kids
  }
  parent() {
    return this.up
  }
  text(): string {
    return this.kids.length ? this.kids.map((k) => k.text()).join('\n') : this.txt
  }
  rect(): Box {
    return { left: 10, top: this.raw?.inView === false ? 2000 : 10, width: 100, height: 30 }
  }
  style() {
    return { display: 'block', visibility: 'visible' }
  }
  prop(n: string) {
    if (n === 'disabled') return this.raw?.disabled === true
    if (n === 'type') return this.attrs.type
    if (n === 'checked') return this.raw?.checked === true
    if (n === 'value') return ''
    return undefined
  }
  byId() {
    return null
  }
  labels() {
    return []
  }
}

function nodeFor(c: RawControl): F {
  const a: Record<string, string> = {}
  if (c.aria) a['aria-label'] = c.aria
  if (c.title) a.title = c.title
  if (c.voice) a['data-voice-name'] = c.voice
  if (c.expanded !== undefined) a['aria-expanded'] = String(c.expanded)
  if (c.selected) a['aria-selected'] = 'true'
  if (c.checked !== undefined) a['aria-checked'] = String(c.checked)
  if (c.risk === 'destructive') a['data-hand-confirm'] = ''
  let tag = 'button'
  if (c.kind === 'link') {
    tag = 'a'
    a.href = c.href ?? '#'
  } else if (c.kind === 'tab') a.role = 'tab'
  else if (c.kind === 'checkbox') a.role = 'checkbox'
  else if (c.kind === 'switch') a.role = 'switch'
  else if (c.kind === 'radio') a.role = 'radio'
  else if (c.kind === 'menuitem') a.role = 'menuitem'
  else if (c.kind === 'field') {
    tag = 'input'
    a['aria-label'] = c.aria ?? c.name
    a.type = 'text'
  } else if (c.kind === 'select') {
    tag = 'select'
    a['aria-label'] = c.aria ?? c.name
  }
  const kids: F[] = []
  if (tag !== 'input' && tag !== 'select') {
    if (c.heading) kids.push(new F('h3', {}, [], c.heading))
    const lines = c.lines?.length ? c.lines : []
    // the captured innerText: lines first, then whatever else the name holds
    const rest = c.name
    if (lines.length) {
      for (const l of lines) if (l !== c.heading) kids.push(new F('span', {}, [], l))
      const joined = lines.join(' ')
      if (rest.length > joined.length + 1 && rest.startsWith(joined)) kids.push(new F('span', {}, [], rest.slice(joined.length).trim()))
    }
    if (!kids.length) {
      const n = new F('span', {}, [], c.aria ? '' : c.name)
      kids.push(n)
    }
  }
  const n = new F(tag, a, kids)
  n.raw = c
  return n
}

class RecFx implements Effects {
  tree: F
  pressed: UiNode | null = null
  highlighted: UiNode | null = null
  badges: UiNode[] = []
  focused: UiNode | null = null
  navigated = false
  constructor(page: RawPage) {
    this.tree = new F("body", {}, page.controls.map(nodeFor))
  }
  root(): UiNode {
    return this.tree
  }
  viewport() {
    return { w: 1440, h: 900 }
  }
  press(c: Control) {
    this.pressed = c.node
    return 'ok' as const
  }
  focus(c: Control) {
    this.focused = c.node
    return true
  }
  setValue() {
    return true
  }
  value() {
    return ''
  }
  focusedNode() {
    return null
  }
  formOf() {
    return null
  }
  scroll() {
    return true
  }
  scrollTo() {}
  back() {
    this.navigated = true
  }
  closeOverlay() {
    return false
  }
  showBadges(items: { c: Control; n: number }[]) {
    this.badges = items.map((i) => i.c.node)
  }
  hideBadges() {
    this.badges = []
  }
  highlight(c: Control) {
    this.highlighted = c.node
  }
  unhighlight() {}
  visible() {
    return true
  }
}

type Outcome = 'press' | 'confirm' | 'ask' | 'dedicated' | 'wrong' | 'none' | 'other'

function crewOf(path: string): number | null {
  const m = /\/crew\/(\d+)/.exec(path)
  return m ? Number(m[1]) : null
}

const pageCache = new Map<RawPage, { fx: RecFx; names: string[] }>()
function outcome(page: RawPage, target: RawControl, text: string, tag: string): { o: Outcome; detail: string } {
  let pc = pageCache.get(page)
  if (!pc) {
    const f0 = new RecFx(page)
    pc = { fx: f0, names: new VoiceControl(f0).names() }
    pageCache.set(page, pc)
  }
  const fx = pc.fx
  fx.pressed = fx.highlighted = fx.focused = null
  fx.badges = []
  const vc = new VoiceControl(fx)
  const names = pc.names
  const und = understand([{ transcript: text, confidence: 0.9 }], { names })
  const r = und.route
  const isTarget = (n: UiNode | null) => !!n && (n as F).raw === target
  if (r.kind === 'ui') {
    const rep = vc.run(r.cmd)
    if (isTarget(fx.pressed) || isTarget(fx.focused)) return { o: 'press', detail: rep.say }
    if (fx.pressed || fx.focused) return { o: 'wrong', detail: `${r.cmd.kind} -> ${((fx.pressed ?? fx.focused) as unknown as F).raw?.name}` }
    if (isTarget(fx.highlighted) && rep.expectReply) return { o: 'confirm', detail: rep.say }
    if (fx.badges.some(isTarget)) {
      const labels = new Set(fx.badges.map((b) => humanLabel((b as F).raw!).toLowerCase()))
      return { o: labels.size === 1 || fx.badges.length <= 3 ? 'ask' : 'wrong', detail: rep.say }
    }
    return { o: 'none', detail: `${JSON.stringify(r.cmd)} -> ${rep.say}` }
  }
  // a symptom chip named on its own goes to the consultation first (safety rule), which is the right outcome
  if (parseFindings(humanLabel(target)).hits.length && ((r.kind === 'voice' && r.intent.type === 'consult') || (r.kind === 'chat' && r.chat.type === 'feeling'))) return { o: 'dedicated', detail: 'consultation first' }
  if (r.kind === 'voice') {
    const i = r.intent
    const crew = crewOf(page.path)
    if (i.type === 'nav' && target.kind === 'link' && target.href && pathFor(i.target, page.role === 'home' || page.role === 'polar' ? 'member' : page.role, crew) === target.href) return { o: 'dedicated', detail: 'nav' }
    // "close" closes the open dialog; "cancel" with nothing pending presses the Cancel button (useVoiceAgent 'answer' case)
    if ((i.type === 'close' || (i.type === 'answer' && i.answer === 'no')) && /^(?:close|cancel)$/i.test(humanLabel(target))) return { o: 'dedicated', detail: 'close' }
    const self = parseIntent(`show ${humanLabel(target)}`)
    if (i.type === 'system' && self.type === 'system' && self.system === i.system) return { o: 'dedicated', detail: 'system' }
    if (i.type === 'reading' && tag === 'bare' && parseIntent(humanLabel(target)).type === 'reading') return { o: 'dedicated', detail: 'reading' }
    if (i.type === 'nav' && target.kind === 'link') return { o: 'wrong', detail: `nav ${i.target}` }
  }
  return { o: 'other', detail: `${r.kind}${r.kind === 'voice' ? ':' + r.intent.type : r.kind === 'chat' ? ':' + r.chat.type : ''}` }
}

const OK = new Set<Outcome>(['press', 'confirm', 'ask', 'dedicated'])

describe('voice control corpus (captured pages)', () => {
  it('names each control the natural ways and reaches it', { timeout: 300_000 }, () => {
    const rows: string[] = []
    const fails: string[] = []
    let all = 0
    let good = 0
    const byTag = new Map<string, [number, number]>()
    for (const page of PAGES) {
      let n = 0
      let ok = 0
      for (const c of page.controls) {
        if (c.disabled || !c.name.trim()) continue
        for (const u of utterancesFor(c)) {
          const { o, detail } = outcome(page, c, u.text, u.tag)
          n++
          const t = byTag.get(u.tag) ?? [0, 0]
          t[1]++
          if (OK.has(o)) {
            ok++
            t[0]++
          } else fails.push(`${page.role}/${page.size} ${page.path} [${c.kind}] ${humanLabel(c)} <- "${u.text}" => ${o}: ${detail.slice(0, 140)}`)
          byTag.set(u.tag, t)
        }
      }
      all += n
      good += ok
      rows.push(`${page.role.padEnd(10)} ${page.size.padEnd(8)} ${page.path.padEnd(22)} ${String(ok).padStart(4)}/${String(n).padEnd(4)} ${((100 * ok) / Math.max(1, n)).toFixed(1)}%`)
    }
    const tags = [...byTag].map(([k, [a, b]]) => `${k.padEnd(12)} ${a}/${b} ${((100 * a) / b).toFixed(1)}%`)
    const report = [...rows, '', ...tags, '', `TOTAL ${good}/${all} ${((100 * good) / all).toFixed(1)}%`].join('\n')
    if (ENV.VC_CORPUS_VERBOSE) console.log(`${report}\n\n${fails.join('\n')}\n`)
    console.log(report.split('\n').slice(-1)[0])
    expect(good / all).toBeGreaterThan(Number(ENV.VC_CORPUS_MIN ?? 0.95))
  })

  it('never presses anything for symptom or crisis sentences, on any page', () => {
    for (const page of PAGES) {
      for (const text of NEVER_PRESS) {
        const fx = new RecFx(page)
        const vc = new VoiceControl(fx)
        const r = understand([{ transcript: text, confidence: 0.9 }], { names: vc.names() }).route
        if (r.kind === 'ui') vc.run(r.cmd)
        expect(fx.pressed, `${page.path}: "${text}" pressed ${(fx.pressed as F | null)?.raw?.name}`).toBeNull()
      }
    }
  })
})
