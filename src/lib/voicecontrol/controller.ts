// Voice control of the page: carries out a UiCommand on the controls the person can see, with the safety rules
// (destructive actions and form submits need a spoken yes; passwords are never typed or read back; nothing hidden,
// inert, behind a dialog or covered is ever pressed). The page itself is reached through `Effects`, so the logic
// is unit-tested on synthetic trees; dom.ts provides the real ones.
import { extractNumbers } from '../voice/numbers'
import type { ScrollDir, UiCommand } from './grammar'
import { MATCH_MIN, nameScore, normName } from './names'
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
  scroll(dir: ScrollDir): boolean
  scrollTo(n: UiNode): void
  back(): void
  /** Close the open dialog, sheet or menu; false when none is open. */
  closeOverlay(): boolean
  showBadges(items: { c: Control; n: number }[]): void
  hideBadges(): void
  highlight(c: Control): void
  /** Remove a waiting (confirmation) highlight. */
  unhighlight(): void
  /** Not covered by anything (a dialog edge, a sticky header, the voice panel) at its centre right now. */
  visible(c: Control): boolean
}

type Pending = { kind: 'choose'; controls: Control[]; act: (c: Control) => UiReply } | { kind: 'confirm'; control: Control; run: () => UiReply }

/** A control name as it should be spoken: no keyboard hints, no run-on values ("Lungs & Oxygen98 %" -> "Lungs & Oxygen"). */
export function spoken(name: string): string {
  const s = name
    .replace(/\s*\((?:alt|ctrl|shift|cmd)[^)]*\)/gi, '')
    .split(/\s+·\s+/)[0]
    .trim()
  // a label followed by a value ("Lungs & Oxygen98 %", "Daniel Reyes Pilot 69 69", "Blood pressure 133/88 mmHg"): keep the label
  const cut = /^(.{2,}?[a-z)])\s*(?=\d)/i.exec(s)
  const out = cut ? cut[1] : s
  return out.split(' ').slice(0, 8).join(' ')
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const q = (s: string) => `“${s.length > 48 ? `${s.slice(0, 46)}…` : s}”`
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const FIELDS: ControlKind[] = ['field', 'select']
const TOGGLES: ControlKind[] = ['checkbox', 'switch', 'radio']

export class VoiceControl {
  private fx: Effects
  private pending: Pending | null = null
  private numbers: Control[] | null = null
  private lastField: UiNode | null = null

  constructor(fx: Effects) {
    this.fx = fx
  }

  /** A question is waiting: which of several, or a yes/no confirmation. */
  hasPending(): boolean {
    return this.pending !== null
  }
  numbersShown(): boolean {
    return this.numbers !== null
  }
  reset() {
    this.pending = null
    this.hideNumbers()
  }

  private controls(): Control[] {
    return collectControls(this.fx.root())
  }
  private usable(): Control[] {
    return this.controls().filter((c) => c.scope !== 'voice')
  }

  /** Names of the page's enabled controls (for recognising a bare name). */
  names(): string[] {
    return [...new Set(this.usable().filter((c) => !c.disabled && c.name).map((c) => c.name))]
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
      return p.act(c)
    }
    this.pending = null
    this.fx.hideBadges()
    return null
  }

  /** Re-find a control in a fresh scan (it may have moved, been removed or disabled meanwhile). */
  private find(c: Control): Control | null {
    return this.controls().find((x) => x.node.ref === c.node.ref && !x.disabled) ?? null
  }

  /** Several controls fit: number them on screen and ask. `said` is what the person asked for. */
  private ask(controls: Control[], said: string, act: (c: Control, sameName: boolean) => UiReply): UiReply {
    const shown = controls.slice(0, 9)
    const same = new Set(shown.map((c) => normName(spoken(c.name)))).size === 1
    this.pending = { kind: 'choose', controls: shown, act: (c) => act(c, same) }
    this.fx.showBadges(shown.map((c, i) => ({ c, n: i + 1 })))
    const title = same ? spoken(shown[0].name) : cap(said.trim())
    const parts = shown.map((c, i) => (same ? (c.context ? `${i + 1}, ${c.context}` : '') : `${i + 1}, ${spoken(c.name)}`)).filter(Boolean)
    const hint = parts.length === shown.length && shown.length <= 4 ? ` ${parts.join('; ')}.` : ''
    return { say: `There are ${shown.length} ${same ? 'called' : 'matching'} ${q(title)}. Which one? Say a number.${hint}`, sfx: 'select', expectReply: true }
  }

  private notFound(target: string, closest: string[], what = 'a control'): UiReply {
    const near = closest.filter(Boolean).slice(0, 2).map((n) => q(spoken(n)))
    return { say: `I can’t find ${what} called ${q(target)} on this page.${near.length ? ` The closest ${near.length === 1 ? 'is' : 'are'} ${list(near)}.` : ' Say “what can I press” to hear the options, or “show numbers”.'}`, sfx: 'warn' }
  }

  /** Press (or for fields, focus) one control, with the confirmation rules. */
  private activate(c: Control, verb: 'press' | 'expand' | 'collapse' | 'check' | 'uncheck' = 'press', withContext = false): UiReply {
    if (c.disabled) return { say: `${q(spoken(c.name))} is not available right now.`, sfx: 'warn' }
    if (FIELDS.includes(c.kind)) return this.focusField(c)
    const label = c.name || 'that control'
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

  private click(c: Control, verb: string, withContext = false): UiReply {
    const r = this.fx.press(c)
    if (r === 'gone') return { say: 'That control is no longer on the page, so I did nothing.', sfx: 'warn' }
    if (r === 'covered') return { say: `${q(spoken(c.name))} is covered by something on screen (perhaps this voice panel), so I did not press it. Scroll, or close what is on top, and try again.`, sfx: 'warn' }
    const ctx = withContext && c.context && !normName(c.name).includes(normName(c.context)) ? ` for ${c.context}` : ''
    if (c.kind === 'tab') return { say: `Opened the ${q(spoken(c.name))} tab.`, sfx: 'tick' }
    if (c.kind === 'disclosure') return { say: `${c.expanded ? 'Closed' : 'Opened'} ${q(spoken(c.name))}.`, sfx: c.expanded ? 'close' : 'open' }
    if (TOGGLES.includes(c.kind)) return { say: `${q(spoken(c.name))} is now ${c.checked ? 'off' : 'on'}.`, sfx: 'tick' }
    if (c.kind === 'link') return { say: `Opening ${q(spoken(c.name))}.`, sfx: 'tick' }
    void verb
    return { say: `Pressed ${q(spoken(c.name))}${ctx}.`, sfx: 'tick' }
  }

  private focusField(c: Control): UiReply {
    this.fx.focus(c)
    this.lastField = c.node
    if (c.password) return { say: `That is a password field. For your privacy I never type or read passwords, so please type it yourself.`, sfx: 'warn' }
    if (c.kind === 'select') return { say: `${q(spoken(c.name))} is selected. Say type and the option you want.`, sfx: 'tick' }
    return { say: `Ready to type in ${q(spoken(c.name))}. Say type, then your words.`, sfx: 'tick' }
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

  /** Run one page command. */
  run(cmd: UiCommand): UiReply {
    if (cmd.kind !== 'number') this.pending = null
    switch (cmd.kind) {
      case 'press': {
        const controls = this.controls()
        // a bare number while numbers are shown
        if (this.numbers && /^\d+$/.test(cmd.target)) return this.run({ kind: 'number', n: Number(cmd.target) })
        const r = resolve(cmd.target, controls, { ordinal: cmd.ordinal, prefer: cmd.want === 'tab' ? ['tab'] : cmd.want === 'link' ? ['link'] : undefined })
        if (r.kind === 'one') return this.activate(r.control)
        if (r.kind === 'disabled') return { say: `${q(spoken(r.control.name))} is not available right now.`, sfx: 'warn' }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c, same) => this.activate(c, 'press', same))
        return this.notFound(cmd.target, r.closest)
      }
      case 'number': {
        if (this.pending?.kind === 'choose') return this.answer(cmd, null) ?? { say: 'Okay.' }
        if (!this.numbers) return { say: 'Nothing is numbered right now. Say “show numbers” first.', sfx: 'warn' }
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
        return { say: `Showing numbers on ${n} controls. Say a number to press one, or say hide numbers.`, sfx: 'select' }
      }
      case 'hideNumbers':
        this.hideNumbers()
        return { say: 'Numbers hidden.', sfx: 'close' }
      case 'listControls': {
        const inDialog = this.overlayOpen()
        const vp = this.fx.viewport()
        const cs = this.usable().filter((c) => !c.disabled && c.name)
        const order: ControlKind[] = ['tab', 'button', 'disclosure', 'link', 'checkbox', 'switch', 'radio', 'menuitem', 'option', 'field', 'select']
        const inView = (c: Control) => c.rect.top < vp.h && c.rect.top + c.rect.height > 0
        cs.sort((a, b) => Number(inView(b)) - Number(inView(a)) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.index - b.index)
        const names = [...new Set(cs.map((c) => (c.password ? 'Password field' : spoken(c.name).length > 40 ? `${spoken(c.name).slice(0, 38)}…` : spoken(c.name))))]
        if (!names.length) return { say: 'There is nothing to press here.' }
        const head = names.slice(0, 8)
        const more = names.length - head.length
        return { say: `${inDialog ? 'In this dialog' : 'On this page'} you can press: ${list(head)}${more > 0 ? `, and ${more} more. Say “show numbers” to see them all` : ''}.` }
      }
      case 'scroll':
        if (!this.fx.scroll(cmd.dir)) return { say: cmd.dir === 'down' || cmd.dir === 'bottom' ? 'This is already the end of the page.' : 'This is already the top of the page.' }
        if (this.numbers) setTimeout(() => this.numbers && this.refreshNumbers(), 450)
        return { say: cmd.dir === 'top' ? 'Top of the page.' : cmd.dir === 'bottom' ? 'End of the page.' : cmd.dir === 'down' ? 'Scrolled down.' : 'Scrolled up.' }
      case 'scrollTo': {
        const hs = collectHeadings(this.fx.root())
        let best: { node: UiNode; name: string; s: number } | null = null
        for (const h of hs) {
          const s = nameScore(cmd.target, h.name)
          if (s >= MATCH_MIN && (!best || s > best.s)) best = { ...h, s }
        }
        if (!best) {
          const sections = this.usable().filter((c) => c.kind === 'disclosure')
          const r = resolve(cmd.target, sections)
          if (r.kind === 'one') {
            this.fx.scrollTo(r.control.node)
            return { say: `Here is ${q(spoken(r.control.name))}.` }
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
      case 'closeOverlay':
        return this.fx.closeOverlay() ? { say: 'Closed.', sfx: 'close' } : { say: 'There is no open dialog or menu.' }
      case 'expandAll': {
        const all = this.usable().filter((c) => !c.disabled)
        const btn = all.find((c) => normName(c.name) === (cmd.open ? 'expand all' : 'collapse all'))
        if (btn) return this.activate(btn)
        const todo = all.filter((c) => c.kind === 'disclosure' && c.expanded === !cmd.open).slice(0, 20)
        if (!todo.length) return { say: cmd.open ? 'Everything here is already open.' : 'Everything here is already closed.' }
        let n = 0
        for (const c of todo) if (this.fx.press(c) === 'ok') n++
        return { say: `${cmd.open ? 'Opened' : 'Closed'} ${n} section${n === 1 ? '' : 's'}.`, sfx: cmd.open ? 'open' : 'close' }
      }
      case 'expand': {
        const cs = this.controls()
        const r = resolve(cmd.target, cs.filter((c) => c.kind === 'disclosure'))
        if (r.kind === 'one') {
          if (r.control.expanded === cmd.open) return { say: `${q(spoken(r.control.name))} is already ${cmd.open ? 'open' : 'closed'}.` }
          return this.activate(r.control, cmd.open ? 'expand' : 'collapse')
        }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c) => (c.expanded === cmd.open ? { say: `${q(spoken(c.name))} is already ${cmd.open ? 'open' : 'closed'}.` } : this.activate(c)))
        // not a section: "open Settings" style, or a tab
        return this.run({ kind: 'press', target: cmd.target })
      }
      case 'check': {
        const r = resolve(cmd.target, this.controls(), { prefer: TOGGLES })
        if (r.kind === 'one') {
          const c = r.control
          if (!TOGGLES.includes(c.kind)) return this.activate(c)
          if (c.checked === cmd.on) return { say: `${q(spoken(c.name))} is already ${cmd.on ? 'on' : 'off'}.` }
          return this.activate(c, cmd.on ? 'check' : 'uncheck')
        }
        if (r.kind === 'disabled') return { say: `${q(spoken(r.control.name))} is not available right now.`, sfx: 'warn' }
        if (r.kind === 'many') return this.ask(r.controls, cmd.target, (c) => (c.checked === cmd.on ? { say: `${q(spoken(c.name))} is already ${cmd.on ? 'on' : 'off'}.` } : this.activate(c)))
        return this.notFound(cmd.target, r.closest, 'a checkbox')
      }
      case 'focus': {
        const f = this.currentField(cmd.target)
        return 'miss' in f ? f.miss : this.focusField(f)
      }
      case 'type': {
        const f = this.currentField(cmd.target)
        if ('miss' in f) return f.miss
        if (f.disabled) return { say: `${q(spoken(f.name))} is not available right now.`, sfx: 'warn' }
        if (f.password) return { say: 'For your privacy I never type or read passwords. Please type it yourself.', sfx: 'warn' }
        const type = String(f.node.prop('type') ?? '').toLowerCase()
        const numeric = type === 'number' || f.node.attr('inputmode') === 'numeric' || f.node.attr('inputmode') === 'decimal'
        let value = cmd.text.trim()
        if (numeric) {
          const nums = extractNumbers(value, true)
          if (!nums.length) return { say: `${q(spoken(f.name))} takes a number. Say type and the number, for example type 120.`, sfx: 'warn' }
          value = String(nums[0])
        } else if (f.kind !== 'select') {
          const before = this.fx.value(f)
          value = before && !/\s$/.test(before) ? `${before} ${value}` : `${before}${value}`
        }
        this.fx.focus(f)
        this.lastField = f.node
        if (!this.fx.setValue(f, value)) return { say: f.kind === 'select' ? `There is no option called ${q(cmd.text)} in ${q(spoken(f.name))}.` : `I could not type in ${q(spoken(f.name))}.`, sfx: 'warn' }
        return { say: `Typed ${q(numeric || f.kind === 'select' ? value : cmd.text.trim())} in ${q(spoken(f.name))}.`, sfx: 'tick' }
      }
      case 'clear': {
        const f = this.currentField(cmd.target)
        if ('miss' in f) return f.miss
        if (f.disabled) return { say: `${q(spoken(f.name))} is not available right now.`, sfx: 'warn' }
        this.fx.focus(f)
        this.lastField = f.node
        this.fx.setValue(f, '')
        return { say: `Cleared ${q(f.password ? 'the password field' : f.name)}.`, sfx: 'close' }
      }
      case 'submit':
        return this.submit()
      case 'tabStep': {
        const cs = this.usable().filter((c) => !c.disabled && (c.kind === 'tab' || c.kind === 'link'))
        const cur = cs.find((c) => c.kind === 'tab' && c.selected) ?? cs.find((c) => c.kind === 'link' && c.selected)
        if (!cur) return { say: 'There are no tabs to switch on this page.' }
        const group = cs.filter((c) => c.kind === cur.kind && groupOf(c.node) === groupOf(cur.node))
        const i = group.indexOf(cur)
        const next = group[i + cmd.dir]
        if (!next) return { say: cmd.dir > 0 ? 'Already on the last tab.' : 'Already on the first tab.' }
        return this.activate(next)
      }
    }
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
      .map((c) => (c.password ? `${c.name}: hidden` : this.fx.value(c) ? `${c.name} ${this.fx.value(c)}` : ''))
      .filter(Boolean)
      .slice(0, 5)
    this.fx.highlight(submitBtn)
    this.pending = { kind: 'confirm', control: submitBtn, run: () => this.click(submitBtn, 'press') }
    return { say: `This will press ${q(spoken(submitBtn.name))}${values.length ? ` and send: ${list(values)}` : ''}. Say yes to confirm, or no to cancel.`, sfx: 'warn', expectReply: true }
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

function within(n: UiNode, ancestor: UiNode): boolean {
  for (let x: UiNode | null = n; x; x = x.parent()) if (x.ref === ancestor.ref) return true
  return false
}

function groupOf(n: UiNode): unknown {
  for (let x = n.parent(); x; x = x.parent()) if (x.attr('role') === 'tablist' || x.tag === 'nav') return x.ref
  return null
}
