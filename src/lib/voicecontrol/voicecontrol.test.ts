// Voice control of the page on synthetic DOM trees: names, Turkish forms, ambiguity and numbering, hidden / inert /
// modal scoping, destructive confirmation, passwords, dictation, and the symptom-before-button precedence.
import { describe, expect, it } from 'vitest'
import { route } from '../assistant/route'
import { spoken, VoiceControl, type Effects } from './controller'
import { parseUiCommand } from './grammar'
import { nameScore } from './names'
import { collectControls, resolve, type Box, type UiNode } from './scan'

/* ---------- a tiny fake DOM ---------- */

type Attrs = Record<string, string | boolean | undefined>
class N implements UiNode {
  tag: string
  attrs: Attrs
  kids: (N | string)[]
  up: N | null = null
  root: N = this
  value = ''
  constructor(tag: string, attrs: Attrs, kids: (N | string)[]) {
    this.tag = tag
    this.attrs = attrs
    this.kids = kids
    if (typeof attrs.value === 'string') this.value = attrs.value
    for (const k of kids) if (k instanceof N) k.up = this
  }
  get ref() {
    return this
  }
  attr(name: string) {
    const v = this.attrs[name]
    return v === undefined || v === false ? null : v === true ? '' : v
  }
  children() {
    return this.kids.filter((k): k is N => k instanceof N)
  }
  parent() {
    return this.up
  }
  text(): string {
    return this.kids.map((k) => (k instanceof N ? k.text() : k)).join(' ')
  }
  rect(): Box {
    const r = this.attrs['data-r']
    if (r === '0') return { left: 0, top: 0, width: 0, height: 0 }
    if (typeof r === 'string') {
      const [left, top, width, height] = r.split(',').map(Number)
      return { left, top, width, height }
    }
    return { left: 10, top: 10, width: 100, height: 30 }
  }
  style() {
    const s = String(this.attrs.style ?? '')
    return { display: /display:\s*none/.test(s) ? 'none' : 'block', visibility: /visibility:\s*hidden/.test(s) ? 'hidden' : 'visible' }
  }
  prop(name: 'disabled' | 'inert' | 'checked' | 'value' | 'type') {
    if (name === 'value') return this.value
    if (name === 'type') return this.attrs.type ?? (this.tag === 'input' ? 'text' : undefined)
    return this.attrs[name] === true || this.attrs[name] === ''
  }
  top(): N {
    let x: N = this
    while (x.up) x = x.up
    return x
  }
  all(): N[] {
    return [this, ...this.children().flatMap((c) => c.all())]
  }
  byId(id: string) {
    return this.top().all().find((n) => n.attrs.id === id) ?? null
  }
  labels() {
    const id = this.attrs.id
    return id ? this.top().all().filter((n) => n.tag === 'label' && n.attrs.for === id) : []
  }
}
const h = (tag: string, attrs: Attrs = {}, ...kids: (N | string)[]) => new N(tag, attrs, kids)

class FakeFx implements Effects {
  rootNode: N
  pressed: string[] = []
  focused: N | null = null
  badges: number[] = []
  scrolled: string[] = []
  closed = 0
  constructor(root: N) {
    this.rootNode = root
  }
  root() {
    return this.rootNode
  }
  viewport() {
    return { w: 1440, h: 900 }
  }
  press(c: Parameters<Effects['press']>[0]) {
    const n = c.node as N
    if (n.attrs['data-covered']) return 'covered' as const
    this.pressed.push(c.name)
    if (n.attrs.type === 'checkbox' || n.attrs.role === 'checkbox') n.attrs.checked = !n.attrs.checked
    return 'ok' as const
  }
  focus(c: Parameters<Effects['focus']>[0]) {
    this.focused = c.node as N
    return true
  }
  setValue(c: Parameters<Effects['setValue']>[0], v: string) {
    ;(c.node as N).value = v
    return true
  }
  value(c: Parameters<Effects['value']>[0]) {
    return (c.node as N).value
  }
  focusedNode() {
    return this.focused
  }
  formOf(n: UiNode) {
    let x = n as N | null
    while (x && x.tag !== 'form') x = x.up
    return x
  }
  scroll(dir: string) {
    this.scrolled.push(dir)
    return true
  }
  scrollTo(n: UiNode) {
    this.scrolled.push(`to:${(n as N).text().trim()}`)
  }
  back() {
    this.scrolled.push('back')
  }
  closeOverlay() {
    this.closed++
    return true
  }
  showBadges(items: { n: number }[]) {
    this.badges = items.map((i) => i.n)
  }
  hideBadges() {
    this.badges = []
  }
  highlight() {}
  unhighlight() {}
  visible(c: Parameters<Effects['visible']>[0]) {
    return !(c.node as N).attrs['data-covered']
  }
}

const page = () =>
  h(
    'body',
    {},
    h('nav', { 'aria-label': 'Main' }, h('a', { href: '/crew/1', 'aria-current': 'page' }, 'Overview'), h('a', { href: '/crew/1/history' }, 'History'), h('a', { href: '/crew/1/aura' }, 'AURA')),
    h('main', {},
      h('section', {}, h('h2', {}, 'Blood pressure'), h('button', {}, 'Details')),
      h('section', {}, h('h2', {}, 'Heart rate'), h('button', {}, 'Details')),
      h('section', {}, h('h2', {}, 'Sleep'), h('button', {}, 'Details')),
      h('button', {}, 'Save'),
      h('button', {}, 'Save draft'),
      h('button', { class: 'text-crit' }, 'Delete account'),
      h('button', { 'aria-label': 'Close AURA voice (Alt+V)' }),
      h('button', { disabled: true }, 'Export'),
      h('button', { style: 'display: none' }, 'Hidden thing'),
      h('div', { hidden: true }, h('button', {}, 'Ghost')),
      h('div', { 'aria-hidden': 'true' }, h('button', {}, 'Decoration')),
      h('div', { inert: true }, h('button', {}, 'Inert button')),
      h('button', { 'data-r': '0' }, 'Zero size'),
      h('button', { 'data-covered': true }, 'Under the header'),
      h('h2', {}, h('button', { 'aria-expanded': 'false' }, 'Sources ', h('span', {}, '4 sources'))),
      h('button', { 'aria-expanded': 'true' }, 'Medicines'),
      h('label', {}, h('input', { type: 'checkbox', checked: true }), 'Speak replies aloud'),
      h('form', {},
        h('label', { for: 'sys' }, 'Systolic'), h('input', { id: 'sys', type: 'number' }),
        h('label', { for: 'note' }, 'Notes'), h('textarea', { id: 'note' }),
        h('input', { type: 'password', 'aria-label': 'Password', value: 'hunter2' }),
        h('button', { type: 'submit' }, 'Save reading'),
      ),
      h('span', { id: 'lbl' }, 'Pressure'), h('button', { 'aria-labelledby': 'lbl' }, 'P'),
      h('div', { role: 'tablist' }, h('button', { role: 'tab', 'aria-selected': 'true' }, 'Trends'), h('button', { role: 'tab', 'aria-selected': 'false' }, 'Log')),
    ),
    h('section', { class: 'vx-hud', 'aria-label': 'AURA voice' }, h('button', { 'aria-label': 'Close voice' }), h('button', { 'aria-label': 'Voice settings' })),
  )

const names = (root: N) => collectControls(root).map((c) => c.name)

describe('names and Turkish forms', () => {
  it('scores partial, phonetic and Turkish forms', () => {
    expect(nameScore('details', 'Details for blood pressure')).toBeGreaterThanOrEqual(0.72)
    expect(nameScore('detials', 'Details')).toBeGreaterThanOrEqual(0.72) // mis-heard
    expect(nameScore("Details'e", 'Details')).toBe(1)
    expect(nameScore('saveye', 'Save')).toBeGreaterThanOrEqual(0.72)
    expect(nameScore('kaydet', 'Save')).toBeGreaterThanOrEqual(0.72)
    expect(nameScore('ayrıntılara', 'Details')).toBeGreaterThanOrEqual(0.72)
    expect(nameScore('iptal', 'Cancel')).toBeGreaterThanOrEqual(0.72)
    expect(nameScore('banana', 'Details')).toBeLessThan(0.72)
    expect(nameScore('close voice', 'Close AURA voice (Alt+V)')).toBeGreaterThanOrEqual(0.72)
  })
  it('speaks names without keyboard hints or run-on values', () => {
    expect(spoken('Lungs & Oxygen98 %')).toBe('Lungs & Oxygen')
    expect(spoken('Brain & Behavior6.1 h · 4 / 5')).toBe('Brain & Behavior')
    expect(spoken('Close AURA voice (Alt+V)')).toBe('Close AURA voice')
    expect(spoken('Details for Blood pressure 133/88 mmHg')).toBe('Details for Blood pressure')
    expect(spoken('Review first PLT Daniel Reyes Pilot 69 69')).toBe('Review first PLT Daniel Reyes Pilot')
    expect(spoken('MS1 Aiko Tanaka Mission Specialist 100 100 of')).toBe('MS1 Aiko Tanaka Mission Specialist')
  })
  it('parses English and Turkish command forms', () => {
    expect(parseUiCommand('press Details')).toEqual({ kind: 'press', target: 'details' })
    expect(parseUiCommand('click the second Details button')).toMatchObject({ kind: 'press', target: 'details', ordinal: 2, want: 'button' })
    expect(parseUiCommand("Details'e bas")).toMatchObject({ kind: 'press', target: "details'e" })
    expect(parseUiCommand("Save'e tıkla")).toMatchObject({ kind: 'press' })
    expect(parseUiCommand("ikinci Details'e bas")).toMatchObject({ kind: 'press', ordinal: 2 })
    expect(parseUiCommand('kaydet butonuna bas')).toMatchObject({ kind: 'press', target: 'kaydet' })
    expect(parseUiCommand('number 2')).toEqual({ kind: 'number', n: 2 })
    expect(parseUiCommand('the second one')).toEqual({ kind: 'number', n: 2 })
    expect(parseUiCommand('ikinci')).toEqual({ kind: 'number', n: 2 })
    expect(parseUiCommand('üç numaraya bas')).toEqual({ kind: 'number', n: 3 })
    expect(parseUiCommand('show numbers')).toEqual({ kind: 'showNumbers' })
    expect(parseUiCommand('numaraları göster')).toEqual({ kind: 'showNumbers' })
    expect(parseUiCommand('scroll down')).toEqual({ kind: 'scroll', dir: 'down' })
    expect(parseUiCommand('aşağı kaydır')).toEqual({ kind: 'scroll', dir: 'down' })
    expect(parseUiCommand('en üste çık')).toEqual({ kind: 'scroll', dir: 'top' })
    expect(parseUiCommand('scroll to Sources')).toEqual({ kind: 'scrollTo', target: 'sources' })
    expect(parseUiCommand('go back')).toEqual({ kind: 'back' })
    expect(parseUiCommand('geri git')).toEqual({ kind: 'back' })
    expect(parseUiCommand('close the dialog')).toEqual({ kind: 'closeOverlay' })
    expect(parseUiCommand('expand all')).toEqual({ kind: 'expandAll', open: true })
    expect(parseUiCommand('tümünü aç')).toEqual({ kind: 'expandAll', open: true })
    expect(parseUiCommand('expand Sources')).toEqual({ kind: 'expand', target: 'sources', open: true })
    expect(parseUiCommand('uncheck speak replies aloud')).toEqual({ kind: 'check', target: 'speak replies aloud', on: false })
    expect(parseUiCommand('type Feeling better today into notes')).toEqual({ kind: 'type', text: 'Feeling better today', target: 'notes' })
    expect(parseUiCommand('notlar alanına merhaba yaz')).toMatchObject({ kind: 'type', target: 'notlar', text: 'merhaba' })
    expect(parseUiCommand('what can I press here?')).toEqual({ kind: 'listControls' })
    expect(parseUiCommand('next tab')).toEqual({ kind: 'tabStep', dir: 1 })
    expect(parseUiCommand('submit')).toEqual({ kind: 'submit' })
    expect(parseUiCommand('how is my blood pressure')).toBeNull()
  })
})

describe('what can be reached', () => {
  it('skips hidden, aria-hidden, inert and zero-size controls; flags disabled ones; reads accessible names', () => {
    const n = names(page())
    for (const gone of ['Hidden thing', 'Ghost', 'Decoration', 'Inert button', 'Zero size']) expect(n).not.toContain(gone)
    expect(n).toContain('Close AURA voice (Alt+V)')
    expect(n).toContain('Pressure') // aria-labelledby wins over the text
    expect(n).toContain('Systolic') // <label for>
    expect(n).toContain('Speak replies aloud') // wrapping <label>
    const cs = collectControls(page())
    expect(cs.find((c) => c.name === 'Export')?.disabled).toBe(true)
    expect(cs.find((c) => c.name === 'Delete account')?.risk).toBe('destructive')
    expect(cs.find((c) => c.name === 'Password')?.password).toBe(true)
    expect(cs.find((c) => c.name.startsWith('Sources'))?.kind).toBe('disclosure')
    expect(cs.find((c) => c.name === 'Close voice')?.scope).toBe('voice')
    expect(cs.filter((c) => c.name === 'Details').map((c) => c.context)).toEqual(['Blood pressure', 'Heart rate', 'Sleep'])
  })
  it('with a modal dialog open, only the dialog and the voice panel are reachable', () => {
    const root = page()
    const dialog = h('div', { role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, 'Delete your account?'), h('div', { 'data-overlay-part': 'footer' }, h('button', {}, 'Cancel'), h('button', {}, 'Delete')))
    root.kids.push(dialog)
    dialog.up = root
    const cs = collectControls(root)
    expect(cs.map((c) => c.name).sort()).toEqual(['Cancel', 'Close voice', 'Delete', 'Voice settings'])
    expect(cs.find((c) => c.name === 'Delete')?.risk).toBe('destructive')
    expect(cs.find((c) => c.name === 'Cancel')?.risk).toBe('none')
    // a non-destructive dialog confirmation still needs a yes
    const edit = h('div', { role: 'dialog', 'aria-modal': 'true' }, h('div', { 'data-overlay-part': 'footer' }, h('button', {}, 'Cancel'), h('button', {}, 'Save')))
    const r2 = h('body', {}, h('button', {}, 'Behind'), edit)
    expect(collectControls(r2).find((c) => c.name === 'Save')?.risk).toBe('dialog-confirm')
    expect(collectControls(r2).some((c) => c.name === 'Behind')).toBe(false)
  })
  it('exact names beat partial ones; same names are ambiguous', () => {
    const cs = collectControls(page())
    expect(resolve('save', cs)).toMatchObject({ kind: 'one', control: { name: 'Save' } })
    const many = resolve('details', cs)
    expect(many.kind).toBe('many')
    expect(resolve('details', cs, { ordinal: 2 })).toMatchObject({ kind: 'one', control: { context: 'Heart rate' } })
    expect(resolve('export', cs).kind).toBe('disabled')
    const none = resolve('banana split', cs)
    expect(none.kind).toBe('none')
    if (none.kind === 'none') expect(none.closest).toEqual([]) // nothing alike: no misleading suggestions
    const near = resolve('save drift', cs)
    if (near.kind === 'none') expect(near.closest[0]).toBe('Save draft')
  })
})

describe('pressing by voice', () => {
  const setup = () => {
    const root = page()
    const fx = new FakeFx(root)
    return { root, fx, vc: new VoiceControl(fx) }
  }
  it('presses a uniquely named control and says what it did', () => {
    const { fx, vc } = setup()
    expect(vc.run({ kind: 'press', target: 'save draft' }).say).toMatch(/Pressed “Save draft”/)
    expect(fx.pressed).toEqual(['Save draft'])
    expect(vc.run({ kind: 'press', target: 'Trends' }).say).toMatch(/Opened the “Trends” tab/)
  })
  it('asks which one when several share a name, numbers them, and takes a number', () => {
    const { fx, vc } = setup()
    const r = vc.run({ kind: 'press', target: 'details' })
    expect(r.say).toMatch(/There are 3 called “Details”\. Which one\? Say a number\. 1, Blood pressure; 2, Heart rate; 3, Sleep\./)
    expect(r.expectReply).toBe(true)
    expect(fx.badges).toEqual([1, 2, 3])
    expect(fx.pressed).toEqual([])
    const a = vc.answer(parseUiCommand('ikinci'), null)!
    expect(a.say).toMatch(/Pressed “Details” for Heart rate/)
    expect(fx.pressed).toEqual(['Details'])
    expect(fx.badges).toEqual([])
    // ordinal + name presses directly
    vc.run({ kind: 'press', target: 'details', ordinal: 3 })
    expect(fx.pressed.length).toBe(2)
  })
  it('“show numbers” labels every control in view, and a number presses it', () => {
    const { fx, vc } = setup()
    expect(vc.run({ kind: 'number', n: 1 }).say).toMatch(/show numbers/)
    expect(vc.run({ kind: 'showNumbers' }).say).toMatch(/^Showing numbers on \d+ controls/)
    expect(fx.badges.length).toBeGreaterThan(10)
    const n = collectControls(fx.root()).filter((c) => c.scope !== 'voice' && !c.disabled).findIndex((c) => c.name === 'History') + 1
    vc.run({ kind: 'number', n })
    expect(fx.pressed).toEqual(['History'])
    expect(vc.run({ kind: 'hideNumbers' }).say).toBe('Numbers hidden.')
    expect(fx.badges).toEqual([])
  })
  it('never presses a destructive control without a spoken yes', () => {
    const { fx, vc } = setup()
    const r = vc.run({ kind: 'press', target: 'delete account' })
    expect(r.say).toMatch(/cannot be undone\. Shall I press it\? Say yes to confirm, or no to cancel/)
    expect(fx.pressed).toEqual([])
    expect(vc.answer(null, 'no')!.say).toBe('Cancelled. Nothing was pressed.')
    expect(fx.pressed).toEqual([])
    vc.run({ kind: 'press', target: 'delete account' })
    expect(vc.answer(null, 'yes')!.say).toMatch(/Pressed “Delete account”/)
    expect(fx.pressed).toEqual(['Delete account'])
    // anything else drops the question without pressing
    vc.run({ kind: 'press', target: 'delete account' })
    expect(vc.answer(parseUiCommand('scroll down'), null)).toBeNull()
    expect(vc.hasPending()).toBe(false)
    expect(fx.pressed).toEqual(['Delete account'])
  })
  it('does not press what is covered, disabled or missing, and names the closest controls', () => {
    const { fx, vc } = setup()
    expect(vc.run({ kind: 'press', target: 'under the header' }).say).toMatch(/covered/)
    expect(vc.run({ kind: 'press', target: 'export' }).say).toMatch(/not available right now/)
    expect(vc.run({ kind: 'press', target: 'ghost' }).say).toMatch(/^I can’t find a control called “ghost” on this page\. Say “what can I press”/)
    expect(vc.run({ kind: 'press', target: 'inert button' }).say).toMatch(/can’t find/)
    expect(fx.pressed).toEqual([])
  })
  it('expands and collapses sections, toggles checkboxes, steps through tabs', () => {
    const { fx, vc } = setup()
    expect(vc.run({ kind: 'expand', target: 'sources', open: true }).say).toMatch(/Opened “Sources/)
    expect(vc.run({ kind: 'expand', target: 'medicines', open: true }).say).toMatch(/already open/)
    expect(vc.run({ kind: 'check', target: 'speak replies aloud', on: true }).say).toMatch(/already on/)
    expect(vc.run({ kind: 'check', target: 'speak replies aloud', on: false }).say).toMatch(/is now off/)
    expect(vc.run({ kind: 'tabStep', dir: 1 }).say).toMatch(/Opened the “Log” tab/)
    expect(fx.pressed).toEqual(['Sources 4 sources', 'Speak replies aloud', 'Log'])
  })
  it('dictates into fields (numbers through the number parser), never into passwords, and confirms a submit', () => {
    const { fx, vc } = setup()
    expect(vc.run({ kind: 'type', text: 'one hundred twenty', target: 'systolic' }).say).toBe('Typed “120” in “Systolic”.')
    expect(vc.run({ kind: 'focus', target: 'notes' }).say).toMatch(/Ready to type in “Notes”/)
    vc.run({ kind: 'type', text: 'Feeling better' })
    vc.run({ kind: 'type', text: 'after lunch' })
    const notes = collectControls(fx.root()).find((c) => c.name === 'Notes')!
    expect(fx.value(notes)).toBe('Feeling better after lunch')
    expect(vc.run({ kind: 'type', text: 'secret', target: 'password' }).say).toMatch(/never type or read passwords/)
    const pw = collectControls(fx.root()).find((c) => c.name === 'Password')!
    expect(fx.value(pw)).toBe('hunter2')
    const s = vc.run({ kind: 'submit' })
    expect(s.say).toMatch(/This will press “Save reading” and send: Systolic 120, Notes Feeling better after lunch and Password: hidden\. Say yes/)
    expect(s.say).not.toMatch(/hunter2/)
    expect(fx.pressed).toEqual([])
    vc.answer(null, 'yes')
    expect(fx.pressed).toEqual(['Save reading'])
    expect(vc.run({ kind: 'clear', target: 'notes' }).say).toBe('Cleared “Notes”.')
  })
  it('lists what can be pressed without reading a password', () => {
    const { vc } = setup()
    const s = vc.run({ kind: 'listControls' }).say
    expect(s).toMatch(/^On this page you can press: /)
    expect(s).not.toMatch(/hunter2/)
  })
  it('scrolls, goes back and closes dialogs', () => {
    const { fx, vc } = setup()
    vc.run({ kind: 'scroll', dir: 'down' })
    vc.run({ kind: 'scrollTo', target: 'heart rate' })
    vc.run({ kind: 'back' })
    expect(fx.scrolled).toEqual(['down', 'to:Heart rate', 'back'])
    expect(vc.run({ kind: 'closeOverlay' }).say).toBe('Closed.')
  })
})

describe('precedence: symptoms first, dedicated intents next, then the page', () => {
  const names = ['Pressure', 'Details', 'History', 'Chest pain', 'Save', 'Blood pressure']
  it('a symptom statement is never a button press', () => {
    for (const t of ['I have pressure in my chest', 'My chest hurts', 'göğsüm ağrıyor', 'chest pain']) {
      const r = route(t, { lang: 'en-US', names })
      expect(r.kind, t).toBe('voice')
      if (r.kind === 'voice') expect(r.intent.type, t).toBe('consult')
    }
    expect(route('I want to die, press details', { names }).kind).toBe('crisis')
  })
  it('explicit verbs press; dedicated intents keep working', () => {
    expect(route('press Pressure', { names })).toEqual({ kind: 'ui', cmd: { kind: 'press', target: 'pressure' } })
    expect(route('click chest pain', { names })).toMatchObject({ kind: 'ui', cmd: { kind: 'press', target: 'chest pain' } })
    expect(route("Save'e bas", { names })).toMatchObject({ kind: 'ui', cmd: { kind: 'press' } })
    expect(route('kaydet butonuna bas', { names })).toMatchObject({ kind: 'ui' })
    expect(route('open history', { names: names.filter((n) => !/history/i.test(n)) })).toEqual({ kind: 'voice', intent: { type: 'nav', target: 'history' } })
    expect(route('check my blood pressure', { names })).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'bp' } })
    expect(route('blood pressure', { names })).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'bp' } })
    expect(route('show me a joke', { names })).toMatchObject({ kind: 'chat' })
    expect(route('scroll down', { names })).toEqual({ kind: 'ui', cmd: { kind: 'scroll', dir: 'down' } })
    expect(route('show numbers', { names })).toEqual({ kind: 'ui', cmd: { kind: 'showNumbers' } })
  })
  it('a bare name presses only when it clearly matches a control on screen', () => {
    expect(route('Details', { names })).toMatchObject({ kind: 'ui', cmd: { kind: 'press', bare: true } })
    expect(route('Ayrıntılar', { names })).toMatchObject({ kind: 'ui', cmd: { kind: 'press', bare: true } })
    expect(route('Details', {}).kind).toBe('unknown')
    expect(route('banana', { names }).kind).toBe('unknown')
  })
  it('yes / no stay answers', () => {
    expect(route('yes', { names })).toEqual({ kind: 'voice', intent: { type: 'answer', answer: 'yes' } })
    expect(route('evet', { names })).toEqual({ kind: 'voice', intent: { type: 'answer', answer: 'yes' } })
  })
})
