// Voice control of the page: carries out a UiCommand on the controls the person can see, with the safety rules
// (destructive actions and form submits need a spoken yes; passwords are never typed or read back; nothing hidden,
// inert, behind a dialog or covered is ever pressed). The page itself is reached through `Effects`, so the logic
// is unit-tested on synthetic trees; dom.ts provides the real ones.
import { extractNumbers } from '../voice/numbers'
import type { RoleWant, ScrollAmount, ScrollDir, UiCommand } from './grammar'
import { MATCH_MIN, nameScore, namesScore, normName } from './names'
import { collectControls, collectHeadings, openModal, resolve, type Control, type ControlKind, type UiNode } from './scan'

export type UiSfx = 'tick' | 'select' | 'warn' | 'confirm' | 'close' | 'open'
export type UiReply = { say: string; sfx?: UiSfx; expectReply?: boolean }

export interface Effects {
  root(): UiNode
  viewport(): { w: number; h: number }
  /** Scroll into view, refuse if something covers it, highlight, then click. */
  press(c: Control): 'ok' | 'covered' | 'gone'
  focus(c: Control): boolean
  /** Set a field's value (React-safe). */
  setValue(c: Control, value: string): boolean
  value(c: Control): string
  /** The field that has keyboard focus (outside the voice panel), as a node, or null. */
  focusedNode(): UiNode | null
  /** The enclosing <form> of a node, or null. */
  formOf(n: UiNode): UiNode | null
  scroll(dir: ScrollDir, amount?: ScrollAmount): boolean
  scrollTo(n: UiNode): void
  back(): void
  forward?(): void
  /** Close the open dialog, sheet or menu; false when none is open. */
  closeOverlay(): boolean
  showBadges(items: { c: Control; n: number }[]): void
  hideBadges(): void
  highlight(c: Control): void
  /** Remove a waiting (confirmation) highlight. */
  unhighlight(): void
  /** Not covered by anything (a dialog edge, a sticky header) at its centre right now. */
  visible(c: Control): boolean
  /** Wait for the page to re-render after a press (a menu opening, a lazy route). */
  settle?(ms?: number): Promise<void>
  /** The options of a <select> (their visible text). */
  options?(c: Control): string[]
  /** Readable text under a heading, for "read this section". */
  sectionText?(n: UiNode): string
}

type Pending = { kind: 'choose'; controls: Control[]; act: (c: Control) => UiReply } | { kind: 'confirm'; control: Control; run: () => UiReply }
type Last = { control: Control; kind: ControlKind; label: string; prevTab?: Control; wasOpen?: boolean | null; checked?: boolean | null; overlayBefore: boolean }

/** A control name as it should be spoken: no keyboard hints, no run-on values ("Lungs & Oxygen98 %" -> "Lungs & Oxygen"). */
export function spoken(name: string): string {
  const s = name
    .replace(/\s*\((?:alt|ctrl|shift|cmd|opens in)[^)]*\)/gi, '')
    .split(/\s+·\s+/)[0]
    .trim()
  // a label followed by a value ("Lungs & Oxygen98 %", "Daniel Reyes Pilot 69 69", "Blood pressure 133/88 mmHg"): keep the label
  const cut = /^(.{2,}?[a-z)])\s*(?=\d)/i.exec(s)
  const out = cut && cut[1].split(' ').length > 1 ? cut[1] : s
  return out.split(' ').slice(0, 8).join(' ')
}
const say = (c: Control) => spoken(c.label || c.name)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const q = (s: string) => `“${s.length > 48 ? `${s.slice(0, 46)}…` : s}”`
const list = (xs: string[], and = 'and') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`)
const FIELDS: ControlKind[] = ['field', 'select']
const TOGGLES: ControlKind[] = ['checkbox', 'switch', 'radio']
const WANT_KINDS: Record<RoleWant, ControlKind[]> = { tab: ['tab'], link: ['link'], button: ['button', 'disclosure'], checkbox: ['checkbox', 'switch', 'radio'], field: ['field', 'select'], menu: ['disclosure', 'menuitem', 'button'] }

export class VoiceControl {
  private fx: Effects
  private pending: Pending | null = null
  private numbers: Control[] | null = null
  private lastField: UiNode | null = null
  private last: Last | null = null
  private readAt = -1

  constructor(fx: Effects) {
    this.fx = fx
  }

  /** A question is waiting: which of several, or a yes/no confirmation. */
  hasPending(): boolean {
    return this.pending !== null
  }
  /** A yes/no confirmation is waiting (a chain stops here). */
  confirming(): boolean {
    return this.pending !== null
  }
  numbersShown(): boolean {
    return this.numbers !== null
  }
  reset() {
    this.pending = null
    this.readAt = -1
    this.hideNumbers()
  }

  private controls(): Control[] {
    return collectControls(this.fx.root())
  }
  private usable(): Control[] {
    return this.controls().filter((c) => c.scope !== 'voice')
  }

  /** Every name of the page's enabled controls (for recognising a bare name and biasing recognition). */
  names(): string[] {
    const out = new Set<string>()
    for (const c of this.usable()) if (!c.disabled) for (const n of c.names?.length ? c.names : [c.name]) if (n) out.add(n)
    return [...out]
  }

  /** The labels a person reads on screen, visible ones first (for hints and recognition phrases). */
  labels(max = 40): string[] {
    const vp = this.fx.viewport()
    const cs = this.usable().filter((c) => !c.disabled && (c.label || c.name) && !c.password)
    const inView = (c: Control) => c.rect.top < vp.h && c.rect.top + c.rect.height > 0
    cs.sort((a, b) => Number(inView(b)) - Number(inView(a)) || a.index - b.index)
    return [...new Set(cs.map(say).filter((s) => s.length <= 40))].slice(0, max)
  }

  /** How well a bare phrase matches some control on the page, 0..1. */
  bareScore(text: string): number {
    let best = 0
    for (const n of this.names()) best = Math.max(best, nameScore(text, n))
    return best
  }

  overlayOpen(): boolean {
    return openModal(this.fx.root()) !== null
  }

  /** Example sentences built from the controls actually on this page ("Things you can say here"). */
  examples(max = 6): string[] {
    const vp = this.fx.viewport()
    const cs = this.usable().filter((c) => !c.disabled && (c.label || c.name) && !c.password && say(c).length <= 32 && !/^skip to/i.test(say(c)))
    const inView = (c: Control) => c.rect.top < vp.h && c.rect.top + c.rect.height > 0
    cs.sort((a, b) => Number(inView(b)) - Number(inView(a)) || a.index - b.index)
    const out: string[] = []
    const add = (s: string) => {
      if (!out.includes(s) && out.length < max) out.push(s)
    }
    const pick = (k: ControlKind, f: (n: string) => string) => {
      const c = cs.find((x) => x.kind === k && !out.some((o) => o.includes(say(x))))
      if (c) add(f(say(c)))
    }
    if (this.overlayOpen()) add('Close this dialog')
    pick('tab', (n) => `Open the ${n} tab`)
    pick('button', (n) => `Press ${n}`)
    pick('disclosure', (n) => `Open ${n}`)
    pick('field', (n) => `Type in ${n}`)
    pick('link', (n) => `Go to ${n}`)
    pick('checkbox', (n) => `Tick ${n}`)
    add('Scroll down')
    add('Show numbers')
    add('What’s on this page?')
    return out
  }

  /**
   * The person answered while something is pending. Returns null when the reply is not an answer to it (the
   * pending question is dropped and the sentence is handled as a new request).
   */
  answer(cmd: UiCommand | null, ans: 'yes' | 'no' | 'unsure' | null): UiReply | null {
    const p = this.pending
    if (!p) return null
    if (p.kind === 'confirm') {
      this.pending = null
      if (ans === 'yes') {
        const fresh = this.find(p.control)
        if (!fresh) return { say: 'That control is no longer on the page, so I did nothing.', sfx: 'warn' }
        return p.run()
      }
      this.fx.unhighlight()
      if (ans) return { say: 'Cancelled. Nothing was pressed.', sfx: 'close' }
      return null
    }
    if (ans === 'no') {
      this.pending = null
      this.fx.hideBadges()
      return { say: 'Okay, I did not press anything.', sfx: 'close' }
    }
    if (cmd?.kind === 'number' || (cmd?.kind === 'press' && cmd.ordinal !== undefined && !cmd.target)) {
      const n = cmd.kind === 'number' ? cmd.n : cmd.ordinal!
      const c = p.controls[n < 0 ? p.controls.length + n : n - 1]
      if (!c) return { say: `Please say a number from 1 to ${p.controls.length}.`, expectReply: true }
      this.pending = null
      this.fx.hideBadges()
      const fresh = this.find(c)
      if (!fresh) return { say: 'That control is no longer on the page, so I did nothing.', sfx: 'warn' }
      return p.act(fresh)
    }
    // naming one of the offered controls again ("the sleep one", "blood pressure details")
    if (cmd?.kind === 'press' && cmd.target) {
      const r = resolve(cmd.target, p.controls)
      if (r.kind === 'one') {
        this.pending = null
        this.fx.hideBadges()
        const fresh = this.find(r.control)
        return fresh ? p.act(fresh) : { say: 'That control is no longer on the page, so I did nothing.', sfx: 'warn' }
      }
    }
    this.pending = null
    this.fx.hideBadges()
    return null
  }

  /**
   * Re-find a control in a fresh scan right before acting (it may have moved, been re-rendered, removed or
   * disabled meanwhile): the same element if it is still there, otherwise the one control with the same name,
   * kind and context.
   */
  private find(c: Control): Control | null {
    const all = this.controls()
    const same = all.find((x) => x.node.ref === c.node.ref)
    if (same) return same.disabled ? null : same
    const key = (x: Control) => `${x.kind}|${normName(x.label || x.name)}|${normName(x.context)}`
    const twins = all.filter((x) => key(x) === key(c) && !x.disabled)
    return twins.length === 1 ? twins[0] : null
  }

  /** Several controls fit: number them on screen and ask. `said` is what the person asked for. */
  private ask(controls: Control[], said: string, act: (c: Control, sameName: boolean) => UiReply): UiReply {
    const shown = controls.slice(0, 9)
    const same = new Set(shown.map((c) => normName(say(c)))).size === 1
    this.pending = { kind: 'choose', controls: shown, act: (c) => act(c, same) }
    this.fx.showBadges(shown.map((c, i) => ({ c, n: i + 1 })))
    const title = same ? say(shown[0]) : cap(said.split('|')[0].trim())
    const ctxOf = (c: Control) => c.context || spoken(/ for (.+)$/i.exec(c.name)?.[1] ?? '')
    const parts = shown.map((c, i) => (same ? (ctxOf(c) ? `${i + 1}, ${ctxOf(c)}` : '') : `${i + 1}, ${say(c)}`)).filter(Boolean)
    const hint = parts.length === shown.length && shown.length <= 4 ? ` ${parts.join('; ')}.` : ''
    return { say: `There are ${shown.length} ${same ? 'called' : 'matching'} ${q(title)}. Which one? Say a number.${hint}`, sfx: 'select', expectReply: true }
  }

  private notFound(target: string, closest: string[], what = 'a control'): UiReply {
    const near = [...new Set(closest.filter(Boolean).map((n) => spoken(n)))].slice(0, 3).map(q)
    return { say: `I can’t find ${what} called ${q(target.split('|')[0])} on this page.${near.length ? ` The closest ${near.length === 1 ? 'is' : 'are'} ${list(near, 'or')}.` : ' Say “what can I press” to hear the options, or “show numbers”.'}`, sfx: 'warn' }
  }

  /** Press (or for fields, focus) one control, with the confirmation rules. */
  private activate(c: Control, verb: 'press' | 'expand' | 'collapse' | 'check' | 'uncheck' = 'press', withContext = false): UiReply {
    if (c.disabled) return { say: `${q(say(c))} is not available right now.`, sfx: 'warn' }
    if (FIELDS.includes(c.kind)) return this.focusField(c)
    const label = say(c) || 'that control'
    if (c.risk !== 'none') {
      this.fx.highlight(c)
      const run = () => this.click(c, verb, withContext)
      this.pending = { kind: 'confirm', control: c, run }
      const where = c.context ? ` (${c.context})` : ''
      return c.risk === 'destructive'
        ? { say: `${q(label)}${where} may delete or end something and cannot be undone. Shall I press it? Say yes to confirm, or no to cancel.`, sfx: 'warn', expectReply: true }
        : { say: `This confirms the dialog with ${q(label)}${where}. Shall I press it? Say yes to confirm, or no to cancel.`, sfx: 'warn', expectReply: true }
    }
    return this.click(c, verb, withContext)
  }

  private click(c0: Control, verb: string, withContext = false): UiReply {
    const c = this.find(c0) ?? c0
    const before: Last = {
      control: c,
      kind: c.kind,
      label: say(c),
      wasOpen: c.expanded,
      checked: c.checked,
      overlayBefore: this.overlayOpen(),
      prevTab: c.kind === 'tab' ? this.usable().find((x) => x.kind === 'tab' && x.selected && groupOf(x.node) === groupOf(c.node)) : undefined,
    }
    const r = this.fx.press(c)
    if (r === 'gone') return { say: 'That control is no longer on the page, so I did nothing.', sfx: 'warn' }
    if (r === 'covered') return { say: `${q(say(c))} is covered by something on screen, so I did not press it. Close what is on top, or scroll, and try again.`, sfx: 'warn' }
    this.last = before
    // numbered badges follow the page: a dialog closed, a section opened, a new page
    if (this.numbers) setTimeout(() => this.numbers && this.refreshNumbers(), 450)
    const ctx = withContext && c.context && !normName(c.name).includes(normName(c.context)) ? ` for ${c.context}` : ''
    const where = c.scope === 'dialog' ? ' in the dialog' : ''
    void verb
    if (c.kind === 'tab') return { say: `Opened the ${q(say(c))} tab${where}.`, sfx: 'tick' }
    if (c.kind === 'disclosure') return { say: `${c.expanded ? 'Closed' : 'Opened'} ${q(say(c))}${ctx}.`, sfx: c.expanded ? 'close' : 'open' }
    if (TOGGLES.includes(c.kind)) return { say: `${q(say(c))} is now ${c.checked ? 'off' : 'on'}.`, sfx: 'tick' }
    if (c.kind === 'link') return { say: `Opening ${q(say(c))}.`, sfx: 'tick' }
    return { say: `Pressed ${q(say(c))}${ctx}${where}.`, sfx: 'tick' }
  }

  private focusField(c: Control): UiReply {
    this.fx.focus(c)
    this.lastField = c.node
    if (c.password) return { say: `That is a password field. For your privacy I never type or read passwords, so please type it yourself.`, sfx: 'warn' }
    if (c.kind === 'select') {
      const opts = this.fx.options?.(c) ?? []
      return { say: `${q(say(c))} is selected.${opts.length ? ` Say choose and one of: ${list(opts.slice(0, 5).map(q), 'or')}.` : ' Say choose and the option you want.'}`, sfx: 'tick' }
    }
    return { say: `Ready to type in ${q(say(c))}. Say type, then your words.`, sfx: 'tick' }
  }

  private currentField(target?: string): Control | { miss: UiReply } {
    const fields = this.usable().filter((c) => FIELDS.includes(c.kind))
    if (target) {
      const r = resolve(target, fields)
      if (r.kind === 'one' || r.kind === 'disabled') return r.control
      if (r.kind === 'many') return { miss: this.ask(r.controls, target, (c) => this.focusField(c)) }
      return { miss: this.notFound(target, r.closest, 'a field') }
    }
    const focused = this.fx.focusedNode()
    const ref = focused ?? this.lastField
    const hit = ref ? fields.find((c) => c.node.ref === ref.ref) : undefined
    if (hit) return hit
    const enabled = fields.filter((c) => !c.disabled && !c.password)
    if (enabled.length === 1) return enabled[0]
    return { miss: { say: enabled.length ? 'Which field? Say focus and the field’s name first, for example focus Notes.' : 'There is no text field on this page.', sfx: 'warn' } }
  }

  /** "Log blood pressure": open the menu that holds it ("Log a measurement"), then pick the item. */
  async runAsync(cmd: UiCommand): Promise<UiReply> {
    if (cmd.kind !== 'press' || !this.fx.settle) return this.run(cmd)
    const controls = this.controls()
    const r = resolve(cmd.target, controls, { ordinal: cmd.ordinal, prefer: cmd.want ? WANT_KINDS[cmd.want] : undefined, viewH: this.fx.viewport().h })
    const strong = r.kind === 'one' ? namesScore(cmd.target, r.control.names) >= 0.86 : r.kind !== 'none'
    if (strong || (r.kind !== 'none' && cmd.verb !== 'log')) return this.run(cmd)
    const menu = this.menuFor(cmd.target, controls)
    if (!menu) return this.run(cmd)
    const before = new Set(controls.map((c) => c.node.ref))
    if (this.fx.press(menu.opener) !== 'ok') return this.run(cmd)
    await this.fx.settle(260)
    const fresh = this.controls().filter((c) => !before.has(c.node.ref) && c.scope !== 'voice')
    const r2 = resolve(menu.rest, fresh)
    if (r2.kind === 'one') {
      const reply = this.activate(r2.control)
      return { ...reply, say: `Opened ${q(say(menu.opener))}. ${reply.say}` }
    }
    if (r2.kind === 'many') return this.ask(r2.controls, menu.rest, (c) => this.activate(c))
    const names = fresh.map(say).slice(0, 6)
    return { say: `I opened ${q(say(menu.opener))}${names.length ? `. It offers ${list(names.map(q), 'and')}. Which one?` : ', but I don’t see that item in it.'}`, sfx: 'select', expectReply: names.length > 0 }
  }

  /** A closed menu button whose name shares the first spoken word ("log ..." -> "Log a measurement"). */
  private menuFor(target: string, controls: Control[]): { opener: Control; rest: string } | null {
    const words = normName(target.split('|')[0]).split(' ')
    if (words.length < 2) return null
    const verb = words[0]
    const syn: Record<string, string[]> = { log: ['log', 'add', 'record', 'new'], add: ['add', 'log', 'new'], record: ['record', 'log', 'add'], measure: ['log', 'measure', 'add'], enter: ['log', 'add', 'enter'], new: ['new', 'add', 'log'] }
    const okWords = syn[verb] ?? [verb]
    const openers = controls.filter((c) => !c.disabled && c.scope !== 'voice' && (c.kind === 'disclosure' || c.node.attr('aria-haspopup') !== null) && c.expanded !== true && okWords.includes(normName(c.label || c.name).split(' ')[0]))
    // the same menu twice (a header and a section copy): the one on screen, else the first
    const vh = this.fx.viewport().h
    const labels = new Set(openers.map((c) => normName(c.label || c.name)))
    if (!openers.length || labels.size !== 1) return null
    const opener = openers.find((c) => c.rect.top >= 0 && c.rect.top < vh) ?? openers[0]
    return { opener, rest: words.slice(1).join(' ').replace(/^(?:a|an|my|the)\s+/, '') }
  }

  /** Run one page command. */
  run(cmd: UiCommand): UiReply {
    if (cmd.kind !== 'number') this.pending = null
    const vp = this.fx.viewport()
    switch (cmd.kind) {
      case 'press': {
        const controls = this.controls()
        // a bare number while numbers are shown
        if (this.numbers && /^\d+$/.test(cmd.target)) return this.run({ kind: 'number', n: Number(cmd.target) })
        const r = resolve(cmd.target, controls, { ordinal: cmd.ordinal, prefer: cmd.want ? WANT_KINDS[cmd.want] : undefined, viewH: vp.h })
        if (r.kind === 'one') return this.activate(r.control)
        if (r.kind === 'disabled') return { say: `${q(say(r.control))} is not available right now.`, sfx: 'warn' }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c, same) => this.activate(c, 'press', same))
        // "choose Mars" with a select on the page
        const opt = this.selectOption(cmd.target)
        if (opt) return opt
        return this.notFound(cmd.target, r.closest)
      }
      case 'number': {
        if (this.pending?.kind === 'choose') return this.answer(cmd, null) ?? { say: 'Okay.' }
        if (!this.numbers) {
          const r = cmd.n > 0 ? resolve(String(cmd.n), this.usable(), { viewH: vp.h }) : ({ kind: 'none' } as const)
          if (r.kind === 'one') return this.activate(r.control)
          return { say: 'Nothing is numbered right now. Say “show numbers” first.', sfx: 'warn' }
        }
        const c = this.numbers[cmd.n < 0 ? this.numbers.length + cmd.n : cmd.n - 1]
        if (!c) return { say: `There is no number ${cmd.n} on screen. The numbers go from 1 to ${this.numbers.length}.`, sfx: 'warn' }
        const fresh = this.find(c)
        if (!fresh) return { say: 'That control is no longer on the page.', sfx: 'warn' }
        const reply = this.activate(fresh)
        if (!this.pending) this.refreshNumbers()
        return reply
      }
      case 'showNumbers': {
        const n = this.refreshNumbers()
        if (!n) return { say: 'There is nothing to press on screen right now.', sfx: 'warn' }
        return { say: `Showing numbers on ${n} controls${this.overlayOpen() ? ' in this dialog' : ''}. Say a number to press one, or say hide numbers.`, sfx: 'select' }
      }
      case 'hideNumbers':
        this.hideNumbers()
        return { say: 'Numbers hidden.', sfx: 'close' }
      case 'listControls': {
        const inDialog = this.overlayOpen()
        const names = this.labels(40).map((n) => (n.length > 40 ? `${n.slice(0, 38)}…` : n))
        if (!names.length) return { say: 'There is nothing to press here.' }
        const head = names.slice(0, 8)
        const more = names.length - head.length
        return { say: `${inDialog ? 'In this dialog' : 'On this page'} you can press: ${list(head)}${more > 0 ? `, and ${more} more. Say “show numbers” to see them all` : ''}.` }
      }
      case 'helpPage': {
        const ex = this.examples(6)
        return { say: `Here you can say, for example: ${list(ex.map(q), 'or')}. You can join two with “and”, say “undo” to reverse the last press, and ask about your health at any time.` }
      }
      case 'whereAmI': {
        const hs = collectHeadings(this.fx.root())
        const cur = this.usable().find((c) => c.kind === 'link' && c.selected)
        const title = hs[0]?.name
        const dialog = this.overlayOpen()
        const parts = [cur ? `You are on ${q(say(cur))}` : title ? `You are on ${q(title)}` : 'You are on this page']
        if (dialog) parts.push(`a dialog is open${title ? `: ${q(title)}` : ''}`)
        else if (title && cur && normName(title) !== normName(say(cur))) parts.push(`the page heading is ${q(title)}`)
        return { say: `${parts.join(', and ')}. Say “what’s on this page” to hear what you can press.` }
      }
      case 'readPage': {
        const hs = collectHeadings(this.fx.root()).filter((h) => h.name.length <= 80)
        if (!hs.length) return { say: 'This page has no section headings to read.' }
        this.readAt = -1
        return { say: `This page has ${hs.length} section${hs.length === 1 ? '' : 's'}: ${list(hs.slice(0, 8).map((h) => h.name))}${hs.length > 8 ? `, and ${hs.length - 8} more` : ''}. Say “read the next section”, or “read” and a section’s name.` }
      }
      case 'readSection': {
        const hs = collectHeadings(this.fx.root())
        if (!hs.length) return { say: 'This page has no sections to read.' }
        let i = this.readAt
        if (cmd.which === 'named' && cmd.target) {
          let best = -1
          let bs = 0
          hs.forEach((h, k) => {
            const s = nameScore(cmd.target!, h.name)
            if (s > bs) {
              bs = s
              best = k
            }
          })
          if (bs < MATCH_MIN) return this.notFound(cmd.target, hs.map((h) => h.name).sort((a, b) => nameScore(cmd.target!, b) - nameScore(cmd.target!, a)), 'a section')
          i = best
        } else if (cmd.which === 'next') i = Math.min(hs.length - 1, i + 1)
        else if (cmd.which === 'previous') i = Math.max(0, i - 1)
        else {
          // this section: the last heading above the middle of the screen
          const above = hs.map((h, k) => ({ k, t: h.node.rect().top })).filter((x) => x.t < vp.h / 2)
          i = above.length ? above[above.length - 1].k : 0
        }
        if (cmd.which === 'next' && this.readAt === hs.length - 1) return { say: 'That was the last section.' }
        this.readAt = Math.max(0, i)
        const h = hs[this.readAt]
        this.fx.scrollTo(h.node)
        const body = (this.fx.sectionText?.(h.node) ?? '').replace(/\s+/g, ' ').trim()
        return { say: `${h.name}.${body ? ` ${body.length > 420 ? `${body.slice(0, 417).replace(/\s\S*$/, '')}…` : body}` : ''}` }
      }
      case 'scroll': {
        if (!this.fx.scroll(cmd.dir, cmd.amount)) return { say: cmd.dir === 'down' || cmd.dir === 'bottom' ? 'This is already the end of the page.' : cmd.dir === 'middle' ? 'This page does not scroll.' : 'This is already the top of the page.' }
        if (this.numbers) setTimeout(() => this.numbers && this.refreshNumbers(), 450)
        const a = cmd.amount === 'little' ? ' a little' : cmd.amount === 'lot' ? ' a lot' : ''
        return { say: cmd.dir === 'top' ? 'Top of the page.' : cmd.dir === 'bottom' ? 'End of the page.' : cmd.dir === 'middle' ? 'Middle of the page.' : cmd.dir === 'down' ? `Scrolled down${a}.` : `Scrolled up${a}.` }
      }
      case 'scrollTo': {
        const hs = collectHeadings(this.fx.root())
        let best: { node: UiNode; name: string; s: number } | null = null
        for (const h of hs) {
          const s = nameScore(cmd.target, h.name)
          if (s >= MATCH_MIN && (!best || s > best.s)) best = { ...h, s }
        }
        if (!best) {
          const r = resolve(cmd.target, this.usable())
          if (r.kind === 'one') {
            this.fx.scrollTo(r.control.node)
            return { say: `Here is ${q(say(r.control))}.` }
          }
          return this.notFound(cmd.target, hs.map((h) => h.name).sort((a, b) => nameScore(cmd.target, b) - nameScore(cmd.target, a)), 'a section')
        }
        this.fx.scrollTo(best.node)
        return { say: `Here is ${q(best.name)}.` }
      }
      case 'back': {
        const backBtn = this.usable().find((c) => !c.disabled && /^(?:back|go back)\b/i.test(c.name) && c.kind !== 'link')
        if (backBtn) return this.activate(backBtn)
        if (this.overlayOpen()) {
          this.fx.closeOverlay()
          return { say: 'Closed.', sfx: 'close' }
        }
        this.fx.back()
        return { say: 'Going back.', sfx: 'close' }
      }
      case 'forward':
        if (!this.fx.forward) return { say: 'I can’t go forward here.' }
        this.fx.forward()
        return { say: 'Going forward.', sfx: 'open' }
      case 'closeOverlay':
        return this.fx.closeOverlay() ? { say: 'Closed.', sfx: 'close' } : { say: 'There is no open dialog or menu.' }
      case 'expandAll': {
        const all = this.usable().filter((c) => !c.disabled)
        const btn = all.find((c) => normName(c.label || c.name) === (cmd.open ? 'expand all' : 'collapse all'))
        if (btn) return this.activate(btn)
        const todo = all.filter((c) => c.kind === 'disclosure' && c.expanded === !cmd.open).slice(0, 20)
        if (!todo.length) return { say: cmd.open ? 'Everything here is already open.' : 'Everything here is already closed.' }
        let n = 0
        for (const c of todo) if (this.fx.press(c) === 'ok') n++
        return { say: `${cmd.open ? 'Opened' : 'Closed'} ${n} section${n === 1 ? '' : 's'}.`, sfx: cmd.open ? 'open' : 'close' }
      }
      case 'expand': {
        const cs = this.controls()
        const r = resolve(cmd.target, cs.filter((c) => c.kind === 'disclosure'), { viewH: vp.h })
        if (r.kind === 'one') {
          if (r.control.expanded === cmd.open) return { say: `${q(say(r.control))} is already ${cmd.open ? 'open' : 'closed'}.` }
          return this.activate(r.control, cmd.open ? 'expand' : 'collapse')
        }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c) => (c.expanded === cmd.open ? { say: `${q(say(c))} is already ${cmd.open ? 'open' : 'closed'}.` } : this.activate(c)))
        // "close the menu" style with a dialog open
        if (!cmd.open && /^(?:it|this|that|menu|dialog|window|sheet)$/.test(normName(cmd.target)) && this.fx.closeOverlay()) return { say: 'Closed.', sfx: 'close' }
        // not a section: "open Settings" style, or a tab
        return this.run({ kind: 'press', target: cmd.target })
      }
      case 'check': {
        const r = resolve(cmd.target, this.controls(), { prefer: TOGGLES, viewH: vp.h })
        if (r.kind === 'one') {
          const c = r.control
          if (!TOGGLES.includes(c.kind)) return this.activate(c)
          if (c.checked === cmd.on) return { say: `${q(say(c))} is already ${cmd.on ? 'on' : 'off'}.` }
          return this.activate(c, cmd.on ? 'check' : 'uncheck')
        }
        if (r.kind === 'disabled') return { say: `${q(say(r.control))} is not available right now.`, sfx: 'warn' }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c) => (c.checked === cmd.on ? { say: `${q(say(c))} is already ${cmd.on ? 'on' : 'off'}.` } : this.activate(c)))
        return this.notFound(cmd.target, r.closest, 'a checkbox')
      }
      case 'focus': {
        const f = this.currentField(cmd.target)
        return 'miss' in f ? f.miss : this.focusField(f)
      }
      case 'type': {
        const f = this.currentField(cmd.target)
        if ('miss' in f) return f.miss
        if (f.disabled) return { say: `${q(say(f))} is not available right now.`, sfx: 'warn' }
        if (f.password) return { say: 'For your privacy I never type or read passwords. Please type it yourself.', sfx: 'warn' }
        const type = String(f.node.prop('type') ?? '').toLowerCase()
        const numeric = type === 'number' || f.node.attr('inputmode') === 'numeric' || f.node.attr('inputmode') === 'decimal'
        let value = cmd.text.trim()
        if (numeric) {
          const nums = extractNumbers(value, true)
          if (!nums.length) return { say: `${q(say(f))} takes a number. Say type and the number, for example type 120.`, sfx: 'warn' }
          value = String(nums[0])
        } else if (f.kind !== 'select') {
          const before = this.fx.value(f)
          value = before && !/\s$/.test(before) ? `${before} ${value}` : `${before}${value}`
        }
        this.fx.focus(f)
        this.lastField = f.node
        if (!this.fx.setValue(f, value)) return { say: f.kind === 'select' ? `There is no option called ${q(cmd.text)} in ${q(say(f))}.` : `I could not type in ${q(say(f))}.`, sfx: 'warn' }
        return { say: `Typed ${q(numeric || f.kind === 'select' ? value : cmd.text.trim())} in ${q(say(f))}.`, sfx: 'tick' }
      }
      case 'clear': {
        const f = this.currentField(cmd.target)
        if ('miss' in f) return f.miss
        if (f.disabled) return { say: `${q(say(f))} is not available right now.`, sfx: 'warn' }
        this.fx.focus(f)
        this.lastField = f.node
        this.fx.setValue(f, '')
        return { say: `Cleared ${q(f.password ? 'the password field' : say(f))}.`, sfx: 'close' }
      }
      case 'submit':
        return this.submit()
      case 'tabStep':
        return this.step(cmd.dir > 0 ? 'next' : 'previous', 'tab')
      case 'step':
        return this.step(cmd.to, cmd.what)
      case 'select': {
        const r = this.selectOption(cmd.option, cmd.target)
        return r ?? this.run({ kind: 'press', target: cmd.option, soft: true })
      }
      case 'search': {
        const fields = this.usable().filter((c) => c.kind === 'field' && !c.disabled && !c.password)
        const s = fields.find((c) => String(c.node.prop('type') ?? '').toLowerCase() === 'search' || c.node.attr('role') === 'searchbox' || /\b(?:search|filter|find)\b/i.test(c.names.join(' ')))
        if (!s) return { say: 'This page has no search or filter box.', sfx: 'warn' }
        this.fx.focus(s)
        this.lastField = s.node
        this.fx.setValue(s, cmd.text.trim())
        return { say: `Searching ${q(say(s))} for ${q(cmd.text.trim())}.`, sfx: 'tick' }
      }
      case 'setValue': {
        const fields = this.usable().filter((c) => c.kind === 'field' && !c.disabled && !c.password)
        const r = resolve(cmd.target, fields)
        if (r.kind === 'one') {
          const f = r.control
          const cur = Number(this.fx.value(f).replace(',', '.'))
          const stepAttr = Number(f.node.attr('step')) || 1
          const v = cmd.value ?? (Number.isFinite(cur) ? cur : 0) + (cmd.delta ?? 0) * stepAttr
          const min = f.node.attr('min')
          const max = f.node.attr('max')
          const val = Math.min(max !== null ? Number(max) : Infinity, Math.max(min !== null ? Number(min) : -Infinity, v))
          this.fx.focus(f)
          this.lastField = f.node
          this.fx.setValue(f, String(Math.round(val * 100) / 100))
          return { say: `${q(say(f))} is now ${Math.round(val * 100) / 100}.`, sfx: 'tick' }
        }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c) => this.focusField(c))
        // steppers: "increase the dose" -> a button called "Increase dose" / "+"
        if (cmd.delta !== undefined) {
          const word = cmd.delta > 0 ? 'increase' : 'decrease'
          const rb = resolve(`${word} ${cmd.target}`, this.usable().filter((c) => c.kind === 'button'))
          if (rb.kind === 'one') return this.activate(rb.control)
        }
        return this.notFound(cmd.target, r.kind === 'none' ? r.closest : [], 'a number field')
      }
      case 'undo':
        return this.undo()
      case 'again': {
        if (!this.last) return { say: 'I haven’t pressed anything yet.' }
        const c = this.find(this.last.control)
        if (!c) return { say: `${q(this.last.label)} is no longer on the page.`, sfx: 'warn' }
        return this.activate(c)
      }
      case 'sleep':
        return { say: 'Pausing voice. Press Alt V or say “hey AURA” when you need me.', sfx: 'close' }
      case 'resume':
        return { say: 'I’m listening.', sfx: 'open' }
    }
  }

  /** "Close" / "kapat" right after opening a menu or section by voice: close that, not the voice panel. */
  closeOpened(): UiReply | null {
    const l = this.last
    if (!l || l.kind !== 'disclosure' || l.wasOpen) return null
    const c = this.find(l.control)
    if (!c || c.expanded !== true) return null
    if (this.fx.press(c) !== 'ok') return null
    this.last = null
    return { say: `Closed ${q(l.label)}.`, sfx: 'close' }
  }

  /** "Undo": reverse the last reversible press (toggle back, close what was opened, the previous tab, go back). */
  private undo(): UiReply {
    const l = this.last
    if (!l) return { say: 'There is nothing to undo.' }
    this.last = null
    if (!l.overlayBefore && this.overlayOpen() && this.fx.closeOverlay()) return { say: `Closed what ${q(l.label)} opened.`, sfx: 'close' }
    const c = this.find(l.control)
    if (l.kind === 'tab' && l.prevTab) {
      const p = this.find(l.prevTab)
      if (p && this.fx.press(p) === 'ok') return { say: `Back to the ${q(say(p))} tab.`, sfx: 'tick' }
    }
    if ((l.kind === 'disclosure' || TOGGLES.includes(l.kind) || l.control.node.attr('aria-pressed') !== null) && c) {
      if (c.risk !== 'none') return { say: `${q(l.label)} needs a confirmation, so I won’t press it again by myself.`, sfx: 'warn' }
      if (this.fx.press(c) === 'ok') return { say: l.kind === 'disclosure' ? `${l.wasOpen ? 'Opened' : 'Closed'} ${q(l.label)} again.` : TOGGLES.includes(l.kind) ? `${q(l.label)} is ${l.checked ? 'on' : 'off'} again.` : `Pressed ${q(l.label)} again to undo it.`, sfx: 'tick' }
    }
    if (l.kind === 'link') {
      this.fx.back()
      return { say: 'Went back to the previous page.', sfx: 'close' }
    }
    return { say: `I can’t undo pressing ${q(l.label)} automatically. Check the page, or press the matching button yourself.`, sfx: 'warn' }
  }

  /** next / previous / first / last: a control called Next / Previous, else the tab group (or the vital selector). */
  private step(to: 'next' | 'previous' | 'first' | 'last', what?: 'tab' | 'item'): UiReply {
    const cs = this.usable().filter((c) => !c.disabled)
    if (!what && (to === 'next' || to === 'previous')) {
      const btn = cs.find((c) => c.kind !== 'tab' && c.kind !== 'link' && new RegExp(`^${to === 'next' ? '(?:next|continue)' : '(?:previous|prev|back)'}\\b`, 'i').test(c.label || c.name))
      if (btn) return this.activate(btn)
    }
    const cur = cs.find((c) => c.kind === 'tab' && c.selected) ?? (what === 'item' ? undefined : cs.find((c) => c.kind === 'link' && c.selected))
    if (!cur) return { say: 'There are no tabs or lists to step through here.' }
    const group = cs.filter((c) => c.kind === cur.kind && groupOf(c.node) === groupOf(cur.node))
    const i = group.indexOf(cur)
    const next = to === 'first' ? group[0] : to === 'last' ? group[group.length - 1] : group[i + (to === 'next' ? 1 : -1)]
    if (!next || next === cur) return { say: to === 'next' || to === 'last' ? `Already on the last one, ${q(say(cur))}.` : `Already on the first one, ${q(say(cur))}.` }
    return this.activate(next)
  }

  /** "choose Mars Transit": an option of a select on the page (or of the one named). */
  private selectOption(option: string, target?: string): UiReply | null {
    if (!this.fx.options) return null
    let selects = this.usable().filter((c) => c.kind === 'select' && !c.disabled)
    if (target) {
      const r = resolve(target, selects)
      selects = r.kind === 'one' ? [r.control] : selects
    }
    let best: { c: Control; o: string; s: number } | null = null
    for (const c of selects) for (const o of this.fx.options(c)) {
      const s = nameScore(option, o)
      if (s >= MATCH_MIN && (!best || s > best.s)) best = { c, o, s }
    }
    if (!best) return null
    this.fx.focus(best.c)
    if (!this.fx.setValue(best.c, best.o)) return null
    return { say: `Chose ${q(best.o)} in ${q(say(best.c))}.`, sfx: 'tick' }
  }

  /** "Submit": read back what will be sent, then wait for yes. */
  private submit(): UiReply {
    const f = this.currentField()
    const anchor = 'miss' in f ? null : f.node
    const form = anchor ? this.fx.formOf(anchor) : null
    const cs = this.usable()
    const formId = form?.attr('id')
    const modal = openModal(this.fx.root())
    // buttons inside the form, or outside it but tied to it (form="id", e.g. in a dialog footer), or in the same dialog
    const inForm = (c: Control) => (!!form && within(c.node, form)) || (!!formId && c.node.attr('form') === formId) || (!!modal && !!anchor && within(anchor, modal) && within(c.node, modal) && c.node.attr('form') !== null)
    const submitBtn = cs.find((c) => inForm(c) && !c.disabled && c.kind === 'button' && /^(?:submit|image)$/.test(String(c.node.prop('type') ?? c.node.attr('type') ?? ''))) ?? cs.find((c) => inForm(c) && !c.disabled && c.kind === 'button' && /^(?:save|send|submit|log|add|sign in|log in|continue|create)\b/i.test(c.name))
    if (!submitBtn) return { say: 'I could not find what to submit here. Say press and the button’s name instead.', sfx: 'warn' }
    const values = cs
      .filter((c) => inForm(c) && FIELDS.includes(c.kind))
      .map((c) => (c.password ? `${say(c)}: hidden` : this.fx.value(c) ? `${say(c)} ${this.fx.value(c)}` : ''))
      .filter(Boolean)
      .slice(0, 5)
    this.fx.highlight(submitBtn)
    this.pending = { kind: 'confirm', control: submitBtn, run: () => this.click(submitBtn, 'press') }
    return { say: `This will press ${q(say(submitBtn))}${values.length ? ` and send: ${list(values)}` : ''}. Say yes to confirm, or no to cancel.`, sfx: 'warn', expectReply: true }
  }

  private refreshNumbers(): number {
    const vp = this.fx.viewport()
    const cs = this.usable().filter((c) => !c.disabled && c.rect.top < vp.h && c.rect.top + c.rect.height > 0 && c.rect.left < vp.w && c.rect.left + c.rect.width > 0 && this.fx.visible(c))
    const shown = cs.slice(0, 60)
    this.numbers = shown.length ? shown : null
    if (shown.length) this.fx.showBadges(shown.map((c, i) => ({ c, n: i + 1 })))
    else this.fx.hideBadges()
    return shown.length
  }

  private hideNumbers() {
    this.numbers = null
    this.fx.hideBadges()
  }
}

/** Score helper for routing: how well `target` names some control among `names`. */
export function bestNameScore(target: string, names: readonly string[]): number {
  let best = 0
  for (const n of names) best = Math.max(best, namesScore(target, [n]))
  return best
}

function within(n: UiNode, ancestor: UiNode): boolean {
  for (let x: UiNode | null = n; x; x = x.parent()) if (x.ref === ancestor.ref) return true
  return false
}

function groupOf(n: UiNode): unknown {
  for (let x = n.parent(); x; x = x.parent()) if (x.attr('role') === 'tablist' || x.tag === 'nav') return x.ref
  return null
}
