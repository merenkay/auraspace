// Which controls the person can reach right now, and what they are called. Works on a small node interface so the
// rules (hidden, inert, disabled, behind a modal dialog, accessible names, destructive actions) are unit-tested on
// synthetic trees; dom.ts adapts real DOM elements to it.
import { MATCH_MIN, namesScore, normName } from './names'

export type Box = { left: number; top: number; width: number; height: number }

export interface UiNode {
  readonly tag: string
  attr(name: string): string | null
  children(): UiNode[]
  parent(): UiNode | null
  /** textContent */
  text(): string
  rect(): Box
  /** computed display / visibility */
  style(): { display: string; visibility: string }
  /** element.disabled / element.inert / element.checked / element.value / element.type */
  prop(name: 'disabled' | 'inert' | 'checked' | 'value' | 'type'): unknown
  byId(id: string): UiNode | null
  /** <label for=…> elements that point at this node */
  labels(): UiNode[]
  readonly ref: unknown
}

export type ControlKind = 'button' | 'link' | 'tab' | 'checkbox' | 'switch' | 'radio' | 'menuitem' | 'option' | 'disclosure' | 'field' | 'select'
export type Risk = 'none' | 'destructive' | 'dialog-confirm'

export type Control = {
  node: UiNode
  /** the accessible name, as computed for screen readers */
  name: string
  /** what a person reads on it and would say: the first visible line, a data-voice-name, or a cleaned accessible name */
  label: string
  /** every name it can be called by, the label first (heading inside a card, aria-label, title, parts of a long name) */
  names: string[]
  kind: ControlKind
  disabled: boolean
  risk: Risk
  password: boolean
  checked: boolean | null
  expanded: boolean | null
  selected: boolean
  /** inside the open modal dialog (or the page when none is open) vs the voice panel's own controls */
  scope: 'page' | 'dialog' | 'voice'
  /** short context for telling same-named controls apart ("blood pressure") */
  context: string
  rect: Box
  index: number
}

/* ---------- classification (mirrors the hand-control driver: src/components/gesture/driver.ts needsHold) ---------- */

/** Labels that mean "this cannot be undone": the person has to confirm by voice. */
export const DESTRUCTIVE = /\b(delete|remove|erase|reset|clear|discard|wipe|revoke|forget|sign out|log out|sign-out|log-out)\b/i
/** Labels that contain a destructive word but only change what is shown ("Reset view", "Clear selection"). */
export const HARMLESS = /^(?:reset|clear) (?:the )?(?:view|zoom|camera|selection|filters?|search|highlight)\b/i
export const SAFE_IN_DIALOG = /^(cancel|close|back|no|not now|keep|done|ok)\b/i

function hasClass(n: UiNode, c: string) {
  return (` ${n.attr('class') ?? ''} `).includes(` ${c} `)
}

function closest(n: UiNode | null, test: (x: UiNode) => boolean): UiNode | null {
  for (let x = n; x; x = x.parent()) if (test(x)) return x
  return null
}

export function riskOf(n: UiNode, name: string): Risk {
  if (closest(n, (x) => x.attr('data-hand-confirm') !== null)) return 'destructive'
  if (DESTRUCTIVE.test(name) && !HARMLESS.test(name.trim())) return 'destructive'
  if (hasClass(n, 'text-crit')) return 'destructive'
  if (closest(n, (x) => x.attr('data-overlay-part') === 'footer') && !SAFE_IN_DIALOG.test(name.trim())) return 'dialog-confirm'
  return 'none'
}

/* ---------- names ---------- */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

function labelledBy(n: UiNode): string {
  const ids = (n.attr('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  return squash(ids.map((id) => n.byId(id)?.text() ?? '').join(' '))
}

function wrappingLabel(n: UiNode): UiNode | null {
  return closest(n.parent(), (x) => x.tag === 'label')
}

/** The accessible name, close to the browser's own computation for the cases this app uses. */
export function accessibleName(n: UiNode): string {
  const by = labelledBy(n)
  if (by) return by
  const aria = squash(n.attr('aria-label') ?? '')
  if (aria) return aria
  if (n.tag === 'input' || n.tag === 'select' || n.tag === 'textarea') {
    const lab = squash([...n.labels(), ...(wrappingLabel(n) ? [wrappingLabel(n)!] : [])].map((l) => l.text()).join(' '))
    if (lab) return lab
    const type = String(n.prop('type') ?? n.attr('type') ?? '')
    if (/^(?:submit|button|reset)$/.test(type)) return squash(String(n.prop('value') ?? n.attr('value') ?? ''))
    return squash(n.attr('placeholder') ?? n.attr('title') ?? '')
  }
  const own = squash(n.text())
  if (own) return own
  const img = n.children().find((c) => c.tag === 'img' && c.attr('alt'))
  return squash(n.attr('title') ?? img?.attr('alt') ?? '')
}

/* ---------- the names a person would use ---------- */

/** "Lungs & Oxygen98 %" -> "Lungs & Oxygen"; keyboard hints and "(opens in a new tab)" removed. */
export function cleanLabel(s: string): string {
  const t = squash(s.replace(/\s*\((?:alt|ctrl|shift|cmd|opens in)[^)]*\)/gi, ''))
  const first = t.split(/\s+·\s+/)[0]
  const cut = /^(.{2,}?[a-z)])\s*(?=\d)/i.exec(first)
  // keep numbers that are the name itself ("Week 2", "24 h", "15 min", "T2 treadmill walk")
  const label = cut && !/^(?:week|day|tab|step|number|no\.?)$/i.test(cut[1].trim()) && cut[1].split(' ').length > 1 ? cut[1] : first
  return label.split(' ').slice(0, 10).join(' ')
}

function firstLine(n: UiNode): string {
  const lines = n
    .text()
    .split('\n')
    .map(squash)
    .filter(Boolean)
  return lines.find((l) => /[a-z]{2}/i.test(l)) ?? ''
}

function headingIn(n: UiNode, depth = 0): string {
  if (depth > 4) return ''
  for (const c of n.children()) {
    if (/^h[1-6]$/.test(c.tag) || c.attr('role') === 'heading') return squash(c.text())
    const h = headingIn(c, depth + 1)
    if (h) return h
  }
  return ''
}

/**
 * The label and alternative names of a control. A name assembled from several text nodes ("Brain & Behavior 6.4 h
 * · 4 / 5", "Details for Blood pressure 138/86 mmHg") is split into what a person reads first and the rest; an
 * explicit data-voice-name wins (several separated by "|").
 */
export function voiceNames(n: UiNode, acc: string, kind?: ControlKind | null): { label: string; names: string[] } {
  const out: string[] = []
  const add = (x: string | null | undefined) => {
    const t = squash(x ?? '')
    if (t && t.length <= 120 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  const voice = n.attr('data-voice-name')
  if (voice) for (const v of voice.split('|')) add(v)
  const field = kind === 'field' || kind === 'select'
  const line = field ? '' : firstLine(n)
  const accClean = cleanLabel(acc)
  // a run-on duplicate ("ARED session11:00 ARED session11:00")
  const mid = (acc.length - 1) / 2
  const half = acc.length > 8 && acc.length % 2 === 1 && acc.slice(0, mid) === acc.slice(mid + 1) ? acc.slice(0, mid) : ''
  if (half) add(cleanLabel(half))
  if (line && (!n.attr('aria-label') || normName(acc).includes(normName(line)))) add(cleanLabel(line))
  add(accClean)
  add(headingIn(n))
  // "Details for Blood pressure 138/86 mmHg" -> also "Blood pressure details"; "Monday: ARED + T2 walk" -> "Monday"
  const forM = /^(.+?) for (.+)$/i.exec(accClean)
  if (forM) add(forM[2] + " " + forM[1])
  for (const sep of [/:\s/, /\.\s/, /\s[—–-]\s/]) {
    const parts = accClean.split(sep)
    if (parts.length > 1) for (const p of parts) if (p.trim().split(' ').length <= 6) add(cleanLabel(p))
  }
  if (line && n.attr('aria-label')) add(cleanLabel(line))
  add(n.attr('title'))
  if (acc !== accClean) add(acc)
  return { label: out[0] ?? '', names: out }
}

/* ---------- which nodes are controls ---------- */

const ROLE_KIND: Record<string, ControlKind> = {
  button: 'button', link: 'link', tab: 'tab', checkbox: 'checkbox', switch: 'switch', radio: 'radio', menuitem: 'menuitem',
  menuitemcheckbox: 'checkbox', menuitemradio: 'radio', option: 'option', treeitem: 'button', combobox: 'select', textbox: 'field', searchbox: 'field', spinbutton: 'field',
}

export function kindOf(n: UiNode): ControlKind | null {
  const role = n.attr('role')
  if (role && ROLE_KIND[role]) {
    if (ROLE_KIND[role] === 'button' && n.attr('aria-expanded') !== null) return 'disclosure'
    return ROLE_KIND[role]
  }
  switch (n.tag) {
    case 'a':
      return n.attr('href') !== null ? 'link' : null
    case 'button':
      return n.attr('aria-expanded') !== null ? 'disclosure' : 'button'
    case 'summary':
      return 'disclosure'
    case 'select':
      return 'select'
    case 'textarea':
      return 'field'
    case 'input': {
      const type = String(n.prop('type') ?? n.attr('type') ?? 'text').toLowerCase()
      if (type === 'hidden') return null
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (/^(?:submit|button|reset|image)$/.test(type)) return 'button'
      if (type === 'range' || type === 'color' || type === 'file') return null
      return 'field'
    }
  }
  return null
}

/** Hidden from the person: not rendered, hidden, aria-hidden or inert (the node itself; ancestors are checked by the walk). */
function hiddenHere(n: UiNode): boolean {
  if (n.attr('hidden') !== null || n.attr('aria-hidden') === 'true') return true
  if (n.attr('inert') !== null || n.prop('inert') === true) return true
  const s = n.style()
  return s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse'
}

const isVoicePanel = (n: UiNode) => hasClass(n, 'vx-hud') || n.attr('data-voice-panel') !== null
const isOwnLayer = (n: UiNode) => n.attr('data-vc-layer') !== null

/** The topmost open modal dialog, or null. */
export function openModal(root: UiNode): UiNode | null {
  let found: UiNode | null = null
  const walk = (n: UiNode) => {
    if (hiddenHere(n) || isOwnLayer(n)) return
    const role = n.attr('role')
    if ((role === 'dialog' || role === 'alertdialog') && n.attr('aria-modal') === 'true') found = n
    else if (n.tag === 'dialog' && n.attr('open') !== null && n.attr('data-modal') !== null) found = n
    for (const c of n.children()) walk(c)
  }
  walk(root)
  return found
}

function contextOf(n: UiNode, name: string): string {
  const own = normName(name)
  // the nearest enclosing heading or labelled region: a card title, a section name
  for (let x = n.parent(), depth = 0; x && depth < 6; x = x.parent(), depth++) {
    const heading = x.children().find((c) => /^h[1-6]$/.test(c.tag) || c.attr('role') === 'heading')
    const h = heading ? squash(heading.text()) : squash(/^(?:section|article|fieldset|li)$/.test(x.tag) || x.attr('role') === 'group' || x.attr('role') === 'region' ? (x.attr('aria-label') ?? '') : '')
    if (h && normName(h) !== own) return h.slice(0, 60)
  }
  return ''
}

/**
 * Every visible, reachable control: when a modal dialog is open only its contents (plus the voice panel's own
 * controls); never inside hidden, aria-hidden or inert subtrees. Disabled controls are returned (flagged) so AURA
 * can say "Save is not available right now" instead of "not found".
 */
export function collectControls(root: UiNode): Control[] {
  const modal = openModal(root)
  const out: Control[] = []
  const walk = (n: UiNode, scope: Control['scope'], disabledAbove: boolean) => {
    if (hiddenHere(n) || isOwnLayer(n)) return
    const voice = scope === 'voice' || isVoicePanel(n)
    const sc: Control['scope'] = voice ? 'voice' : scope
    const kind = kindOf(n)
    if (kind) {
      const r = n.rect()
      if (r.width > 0 && r.height > 0) {
        const name = accessibleName(n)
        const role = n.attr('role')
        const checkedAttr = n.attr('aria-checked')
        const checked = kind === 'checkbox' || kind === 'switch' || kind === 'radio' ? (checkedAttr !== null ? checkedAttr === 'true' : n.prop('checked') === true) : null
        const exp = n.attr('aria-expanded')
        const type = String(n.prop('type') ?? n.attr('type') ?? '').toLowerCase()
        const ac = (n.attr('autocomplete') ?? '').toLowerCase()
        const vn = voiceNames(n, name, kind)
        out.push({
          node: n,
          name,
          label: vn.label,
          names: vn.names,
          kind,
          disabled: disabledAbove || n.prop('disabled') === true || n.attr('disabled') !== null || n.attr('aria-disabled') === 'true',
          risk: riskOf(n, name),
          password: kind === 'field' && (type === 'password' || /password/.test(ac) || /\bpass(?:word|code)\b/i.test(name)),
          checked,
          expanded: exp === null ? null : exp === 'true',
          selected: n.attr('aria-selected') === 'true' || n.attr('aria-current') === 'page' || (role === 'tab' && n.attr('data-state') === 'active'),
          scope: sc,
          context: '',
          rect: r,
          index: out.length,
        })
      }
    }
    const dis = disabledAbove || (n.tag === 'fieldset' && n.attr('disabled') !== null)
    for (const c of n.children()) walk(c, sc, dis)
  }
  if (modal) {
    walk(modal, 'dialog', false)
    // the voice panel stays usable over a dialog
    const panels: UiNode[] = []
    const find = (n: UiNode) => {
      if (isVoicePanel(n)) panels.push(n)
      else for (const c of n.children()) find(c)
    }
    find(root)
    for (const p of panels) walk(p, 'voice', false)
  } else walk(root, 'page', false)
  for (const c of out) c.context = contextOf(c.node, c.name)
  return out
}

/* ---------- headings (scroll to a section) ---------- */

export function collectHeadings(root: UiNode): { node: UiNode; name: string }[] {
  const modal = openModal(root)
  const out: { node: UiNode; name: string }[] = []
  const walk = (n: UiNode) => {
    if (hiddenHere(n) || isVoicePanel(n) || isOwnLayer(n)) return
    if (/^h[1-6]$/.test(n.tag) || n.attr('role') === 'heading') {
      const name = squash(n.text())
      if (name && n.rect().height > 0) out.push({ node: n, name })
    }
    for (const c of n.children()) walk(c)
  }
  walk(modal ?? root)
  return out
}

/* ---------- resolving a spoken name ---------- */

export type Resolution =
  | { kind: 'one'; control: Control }
  | { kind: 'many'; controls: Control[]; name: string }
  | { kind: 'disabled'; control: Control }
  | { kind: 'none'; closest: string[] }

/**
 * The control a spoken name refers to. Ranking: score tier (exact > prefix > same words > fuzzy), then the open
 * dialog before the page and the page before the voice panel, the role hint ("tab", "link"), enabled before
 * disabled, on screen before scrolled away. Same-named controls give 'many' (or the ordinal one when asked for
 * "the second"); clearly different names that score almost alike also give 'many', so AURA asks.
 */
export function resolve(spoken: string, controls: Control[], o: { ordinal?: number; prefer?: ControlKind[]; only?: ControlKind[]; viewH?: number } = {}): Resolution {
  let pool = controls.filter((c) => c.names?.length || c.name)
  if (o.only) pool = pool.filter((c) => o.only!.includes(c.kind))
  const scored = pool.map((c) => ({ c, s: namesScore(spoken, c.names?.length ? c.names : [c.name]) })).filter((x) => x.s > 0)
  scored.sort((a, b) => b.s - a.s || a.c.index - b.c.index)
  const ok = scored.filter((x) => x.s >= MATCH_MIN)
  if (!ok.length) {
    const closest: string[] = []
    // only names that are at least a little alike; otherwise suggesting "Skip to content" helps nobody
    for (const x of scored.filter((y) => y.s >= 0.3)) {
      const nm = x.c.label || x.c.name
      if (!closest.includes(nm) && x.c.scope !== 'voice') closest.push(nm)
      if (closest.length >= 3) break
    }
    return { kind: 'none', closest }
  }
  let top = ok.filter((x) => x.s >= ok[0].s - 0.04)
  const narrow = (f: (x: { c: Control; s: number }) => boolean) => {
    const n = top.filter(f)
    if (n.length) top = n
  }
  narrow((x) => x.c.scope !== 'voice')
  narrow((x) => x.c.scope === 'dialog')
  if (o.prefer) narrow((x) => o.prefer!.includes(x.c.kind))
  narrow((x) => !x.c.disabled)
  // an exact name beats a partial one
  if (top[0].s >= 0.96) narrow((x) => x.s >= 0.96)
  // different names: the clearly better one wins; nearly tied different names are asked about
  const labelOf = (c: Control) => normName(c.label || c.name)
  if (new Set(top.map((x) => labelOf(x.c))).size > 1) {
    const best = Math.max(...top.map((x) => x.s))
    narrow((x) => x.s >= best - 0.015)
  }
  // same name several times: one on screen and the others scrolled away -> the visible one, unless an ordinal was said
  if (o.ordinal === undefined && o.viewH && top.length > 1 && new Set(top.map((x) => labelOf(x.c))).size === 1) {
    const vis = top.filter((x) => x.c.rect.top < o.viewH! && x.c.rect.top + x.c.rect.height > 0)
    if (vis.length === 1) top = vis
  }
  const list = top.map((x) => x.c).sort((a, b) => a.index - b.index)
  if (o.ordinal !== undefined && list.length) {
    const i = o.ordinal < 0 ? list.length + o.ordinal : o.ordinal - 1
    if (list[i]) return list[i].disabled ? { kind: 'disabled', control: list[i] } : { kind: 'one', control: list[i] }
  }
  if (list.length === 1) return list[0].disabled ? { kind: 'disabled', control: list[0] } : { kind: 'one', control: list[0] }
  return { kind: 'many', controls: list, name: list[0].label || list[0].name }
}
