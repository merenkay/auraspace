# AURA design handbook — "Quiet Cockpit"

Read this before styling anything. It takes ten minutes. Everything here is implemented in `src/index.css` (tokens) and `src/components/ui.tsx` (primitives); the shell and the three auth pages are the reference implementation.

**See it live:** `http://localhost:5173/login?kit` (dev server only) renders every primitive in every state. Reference pages: `/login`, `/register`, `/forgot`, and the shell around any page.

## 1. Point of view

1. **AURA is an instrument, not a dashboard.** Like a flight deck built on the dark-cockpit rule, the screen is quiet graphite and off-white type while everything is normal; colour appears only when a reading needs you.
2. **Numbers are the heroes.** They are set large in tabular figures with a plain sentence beside them, on flat surfaces separated by hairlines and space. Nothing glows, blurs, shines or decorates.
3. **Motion explains cause and effect** — where you came from, what just changed, what is live — and then stops.

When in doubt, remove. If an element carries no information and triggers no action, it does not ship.

## 2. Tokens

Token *names* are an API (other code depends on them). Use the Tailwind class; never paste a hex value.

| Class suffix | Hex | Job | Contrast on `space` |
|---|---|---|---|
| `deep` | `#0C0B09` | Wells: inputs, chart plot areas | — |
| `space` | `#12110F` | The page | — |
| `panel` | `#1A1916` | A surface on the page (`Card`) | — |
| `panel2` | `#22211E` | Hover, **selected**, overlays | — |
| `line` | `#2F2E2A` | Hairlines, surface borders (decorative) | 1.4 |
| `edge` | `#716E69` | Borders of controls (inputs, secondary buttons) | 3.7 |
| `ink` | `#F3F0EA` | Primary text, numbers, primary button fill | 16.6 |
| `soft` | `#C7C4BD` | Secondary text | 10.8 |
| `dim` | `#9B9891` | Labels, metadata (5.6 even on `panel2`) | 6.5 |
| `accent` (`cyan`) | `#92C1FD` | Interaction only — see below | 10.1 |
| `accent-hi` (`ice`) | `#B9DAFF` | Accent on hover | 13.1 |
| `ok` | `#4DC588` | Status: normal | 8.7 |
| `warn` | `#FAC547` | Status: attention | 11.8 |
| `crit` | `#F75D59` | Status: urgent | 6.0 |

Rules:
- **Greys do the layout.** Hierarchy comes from `ink` → `soft` → `dim` and from size, not from colour.
- **Accent has four jobs only:** keyboard focus ring, text links (`.link`), the active-navigation underline, and "live" (`LiveDot`). It is not a fill colour. *Selected* is `bg-panel2` (plus `border-ink` for choice cards), not accent. The primary button is `ink`, not accent.
- **Contextual accent.** The accent hue shifts with the profile — space `#92C1FD` (horizon blue), polar `#84D3E1` (glacier), home `#CBAFED` (heather) — same lightness, same jobs. The shell sets it (`useContextAccent`); you get it for free by using `accent`. To show one context's accent inside another, put `data-accent="polar"` on an element. Do not build per-context layouts or colours beyond this.
- **Status colours are reserved for health status** (§7). No green "success" buttons, no amber decoration.
- `cyan` / `ice` still work as aliases of the accent for old code. New code writes `accent` / `accent-hi`.
- **Radius:** controls `rounded-lg` (8), surfaces `rounded-2xl` (12), `rounded-full` only for avatars, dots and status pills. (`rounded-3xl` now equals `rounded-2xl`.)
- **Shadow:** only overlays (`shadow-overlay`, applied by `Dialog`/`Sheet`/`Tooltip`). No blur anywhere.

## 3. Type

**IBM Plex Sans** for everything a person reads, including hero numbers (tabular figures are on globally). **IBM Plex Mono** (`font-mono` / `.meta`) only for machine-written metadata: timestamps, day counters, sources, ids, axis ticks, codes. Weights 400 / 500 / 600 only — `font-bold` renders as 600.

| Class | Size / line | Use |
|---|---|---|
| `text-display` | 44 / 1.05, 600 | Auth headline only |
| `text-title` | 28 / 1.15, 600 | The one page title (`PageHeader`) |
| `text-heading` | 18 / 1.35, 600 | Section headings (`Section`) |
| `text-[15px] font-semibold` | 15 | Card titles, row titles, notice titles |
| `text-base` | 16 / 1.5 | Body |
| `text-sm` | 14 | Secondary text (`text-soft` or `text-dim`) |
| `.label` | 13, 500, `dim` | Field labels, captions above numbers |
| `.meta` / `text-xs` | 12 | Metadata. **Nothing is smaller than 12 px** |
| `text-metric-xl` / `-lg` / `-md` | 56 / 36 / 24, 500 | Numbers (use `Metric`) |

Sentence case everywhere ("Blood pressure", "No data"). No uppercase, no letter-spacing, no gradient text. `font-display` is now the same family: delete the class when you touch a line.

## 4. Layout

- **The shell owns the frame**: max width 1500, gutters 16 (phone) / 24, the sticky header, the phone bottom bar and the footer disclaimer. Pages add **no** outer padding, max-width, background or min-height. For running text use `max-w-2xl` / `max-w-prose`.
- **Page skeleton:** `<PageHeader>` then sections in a `space-y-10` stack. Inside a section: `gap-6` between surfaces (`gap-4` on phones), `gap-3` between small items.
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 40 · 64 (`1 2 3 4 6 10 16`). Avoid in-between values.
- **Group with space and hairlines first** (`Section`, `List`). Use a `Card` only for a discrete object (one vital, one device, one report). Never nest cards; never put every section in a card.
- **Breakpoints:** design at 390 first. `md` (768) switches the shell to desktop navigation; `lg` (1024) is where pages go multi-column (`lg:grid-cols-12`).
- **Touch:** every target ≥ 44 px. `Button` md/lg, `Row`, `Tabs`, `IconButton` already comply (`sm` sizes extend their hit area invisibly).
- **Phone bottom bar** is 64 px and fixed. The shell already pads for it. Anything you pin to the bottom must sit above it: `bottom-16 md:bottom-0`.
- **Layers:** header 30, staff subject bar 20, tooltip 40, overlays 50. Do not invent z-indexes above 30 in pages.

## 5. Components

All from `src/components/ui.tsx`. If something is missing, ask for it rather than hand-rolling a variant.

```tsx
import { PageHeader, Section, Card, List, Row, Metric, StatusPill, Button, Notice, Stagger, StaggerItem } from '../components/ui'

<PageHeader eyebrow="Good afternoon" title="Mira Okafor" status={<StatusPill status={ev.overall} announce />}
  actions={<Button variant="primary" icon={Plus}>Log a measurement</Button>} />

<div className="space-y-10">
  {ev.alerts.map((a) => (                      /* alerts render immediately, never inside Stagger/Reveal */
    <Notice key={a.key} tone={a.level} title={a.title} role={a.level === 'crit' ? 'alert' : undefined}>{a.detail}</Notice>
  ))}
  <Section title="Latest measurements" description="Simulated data" action={<Button size="sm">See history</Button>}>
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      <StaggerItem><Card><Metric label="Heart rate" value={67} unit="bpm" status="ok" hint="today 09:06" /></Card></StaggerItem>
    </Stagger>
  </Section>
</div>
```

| Need | Use | Notes |
|---|---|---|
| Page title | `PageHeader` `{title, eyebrow?, description?, status?, actions?}` | One per page, one `h1` |
| Group | `Section` `{title, description?, action?}` | Unboxed: heading + hairline |
| Surface | `Card` `{tone?: 'surface'\|'raised'\|'well'\|'plain', pad?: 'none'\|'sm'\|'md', as?}` | `Panel {title, action}` is the legacy equivalent, still fine |
| List | `List` + `Row` `{title, description?, leading?, trailing?, to?\|onClick?, selected?, disabled?}` | Rows, not stacks of cards |
| Number | `Metric` `{label, value, unit?, decimals?, size?: 'md'\|'lg'\|'xl', status?, hint?}` | `value={null}` shows "—"; `status={null}` shows "No data". One `xl` per view |
| Changing number | `AnimatedNumber` `{value, decimals?, format?}` | `CountUp` is the old name |
| Scale / progress | `Meter` `{value, min?, max?, marks?: {at, status?}[], status?, label}` | Replaces progress bars; `label` is for screen readers |
| Score | `ScoreRing` `{score, status, size?}` | |
| Trend | `Sparkline` `{data: {day, value}[], color, height?}` | |
| Status | `StatusPill` `{status, small?, label?, announce?}`, `StatusText` `{status, children?}`, `StatusIcon` `{status, size?}`, `statusLabel(status)` | §7 |
| Metadata tag | `Badge` `{tone?: 'neutral'\|'accent'\|'ok'\|'warn'\|'crit', icon?}` | "Device", "Manual", "Simulated", counts |
| Live data | `LiveDot` `{label?}` | Only while data is actually streaming |
| Message | `Notice` `{tone?: 'info'\|'ok'\|'warn'\|'crit', title?, action?, role?}` | Alerts, demo notes, errors |
| Action | `Button` `{variant?: 'primary'\|'secondary'\|'quiet'\|'danger', size?: 'sm'\|'md'\|'lg', loading?, icon?, iconRight?, full?, to?, href?}` | Default is `secondary`. **One primary per view.** Keep the label while `loading` |
| Icon action | `IconButton` `{icon, label, variant?, size?}` | `label` is mandatory |
| Form | `Field` `{label, hint?, error?, optional?}` wrapping one `Input` / `PasswordInput` / `Select` / `Textarea`; `Checkbox` `{label}` | `Field` wires label, hint and error for screen readers. `controlCls` for exotic controls |
| Pick one | `Tabs` `{value, onChange, options: {value, label, icon?, status?, disabled?}[], variant?: 'pill'\|'line', label, full?}` | `pill` = filter / segmented; `line` = sections. Scrolls sideways, arrow keys work |
| Blocking question | `Dialog` `{open, onClose, title, description?, footer?, wide?}` | Bottom sheet on phones. Put `data-autofocus` on the element to focus |
| Side detail / long form | `Sheet` `{open, onClose, title, description?, footer?}` | Right on desktop, bottom on phones |
| Fold away detail | `Disclosure` `{title, meta?, summary?, id?, defaultOpen?, size?: 'section'|'row', onToggle?}`, `ShowMore` `{lines?, short?, id?}`, `DisclosureGroup` + `ExpandAll` | §12. `id` remembers open/closed on the device |
| Confirm a save | `Button done`, `<Saved show />`, `useFlash()` | §12 |
| Hint | `Tooltip` `{label, side?, align?}` | Never for essential information |
| Loading | `Skeleton` `{className}` (shape of the content), `Spinner` `{label}` | Prefer skeletons for page content |
| Nothing yet | `EmptyState` `{icon?, title, description?, action?}` | Say why, offer the one fix |
| Citation | `SourceLink` `{href, org, title?}` | Every sourced claim |
| Person | `Avatar` `{name, text?, size?}` | Neutral. No personal colours |
| Brand | `Logo` `{size?, wordmark?}` | |
| Icons | `VITAL_ICON[key]`, `SYSTEM_ICON[id]`, `CONTEXT_ICON[context]` | §8 |
| Helpers | `cx(...)`, `useMedia(query)`, `useContextAccent(ctx)`, `MotionRoot` | The shell already wraps pages in `MotionRoot` |

```tsx
<Field label="Systolic" hint="Upper number, in mmHg." error={err}>
  <Input inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value)} />
</Field>

<Tabs label="Measurement" variant="pill" value={key} onChange={setKey}
  options={vitals.map((v) => ({ value: v.key, label: v.label, status: ev.status[v.key] }))} />

<Dialog open={open} onClose={() => setOpen(false)} title="Send report to flight surgeon?"
  description="It arrives after the 14-minute signal delay."
  footer={<><Button onClick={() => setOpen(false)}>Cancel</Button>
           <Button variant="primary" loading={busy} onClick={send} data-autofocus>Send report</Button></>}>
  …
</Dialog>
```

## 6. Motion

Tokens: `DUR` (seconds) `instant .09 · fast .16 · base .24 · slow .4 · draw .7`; `EASE.out` (entering, responding) / `EASE.in` (leaving) / `EASE.inOut` (moving between two places); `SPRING.snappy` (indicators following a tap) / `SPRING.soft` (sheets). Never write a raw duration or bezier in a page.

| Event | What happens | How |
|---|---|---|
| Route change | Old page fades out in 90 ms without moving; new page settles in 16 px from the side its tab lives on (or rises 8 px when unrelated); the nav underline slides to the new tab | Done by the shell. For in-page steps: `<PageTransition routeKey={step} direction={1}>` |
| First appearance | Block fades in and rises 8 px, once | `<Reveal>`; lists/grids `<Stagger><StaggerItem>` (40 ms apart) |
| Number changes | Tweens from the old value to the new in 400 ms. **Never counts up from zero** — a measurement must not be shown as something it is not | `AnimatedNumber` / `Metric` |
| Status changes | Colour and icon switch instantly; one ring expands once around the icon; the page's overall pill is spoken | Built into `StatusIcon`; `StatusPill announce` once per page |
| Chart first draws | Line draws left to right in 700 ms, once | `chart.line` / `chart.bar` |
| Meter / ring | Fill grows once in 700 ms | Built in |
| Selection moves | Thumb or underline slides with `SPRING.snappy` | `Tabs` |
| Dialog / sheet | Scrim fades 160 ms; dialog rises 10 px; sheet slides with `SPRING.soft`; exit is faster than entry | `Dialog`, `Sheet` |
| Press | Scales to 97 % while held (rows and section headers 99 %), a soft highlight starts where the finger touched and fades in 200 ms; a save shows a check that pops in once | `.press` (built into `Button`, `IconButton`, `Tabs`, `Row`, `Disclosure`, nav), `Button done`, `<Saved>` — see §12 |
| Open / close a section | Height grows in 240 ms, closes in 160 ms; chevron turns | `Disclosure` (§12) |
| Refused input | One 320 ms horizontal shake | `CodeInput invalid`; `animate-shake` |

```tsx
<Stagger as="ul" className="…">{items.map((i) => <StaggerItem as="li" key={i.id}>…</StaggerItem>)}</Stagger>
<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE.out }} />
```

**Never animates:** urgent alerts and their text (they appear instantly — no stagger, no delay, no typewriter); status colour; layout of things the user is reading; hover lift or scale on cards; anything decorative. **Nothing loops** except `LiveDot` (data is streaming now) and `Skeleton` / `Spinner` (ends when loading ends). A critical state announces itself with three pulses, then holds still.

**Reduced motion** is handled globally (`MotionRoot` + a CSS rule): movement is removed, state changes still happen. Custom CSS animations must also be safe when their duration is ~0.

## 7. Status

Three states plus "no data". Each is **icon shape + word + colour**, never colour alone.

| State | Word | Icon (shape) | Colour | L\* |
|---|---|---|---|---|
| `ok` | Normal | `CircleCheck` (circle) | `ok` `#4DC588` | 72 |
| `warn` | Attention | `TriangleAlert` (triangle) | `warn` `#FAC547` | 82 |
| `crit` | Urgent | `OctagonAlert` (octagon) | `crit` `#F75D59` | 60 |
| `null` | No data | `CircleDashed` | `dim` | — |

- **Normal is quiet.** A normal number is `ink`, not green; `StatusPill` for `ok` is a neutral outline with a small green check. Warn / crit tint the number and the pill. This is the whole idea: a glance at a calm screen means "nothing needs you".
- **Missing data is never normal.** Pass `null`: `Metric value={null} status={null}`, `StatusPill status={null}`. Never default a missing status to `'ok'`.
- In JS (charts, 3D, inline styles) use `STATUS_COLOR[status]` from `src/data/vitals.ts`. In classes use `text-warn`, `bg-warn/10`, `border-warn/30`. Never type the hex.
- `STATUS_LABEL` in the data layer is uppercase; display `statusLabel(status)` or a status component instead.
- Those three icons are **reserved** for health status. Use `Check` for "done / selected", `Info` for notes.
- Where a mark cannot carry a word (a chart band, a highlighted organ), a caption or legend next to it says what the colour means.
- Estimates, simulated and sample data are labelled as such next to the value: `<Badge>Simulated</Badge>`, `<Badge>Estimate</Badge>`.

## 8. Icons

- `lucide-react` only. **No emoji anywhere** in the UI (they render differently on every device and read as decoration). Common swaps: 🚀🧊🏡 → `CONTEXT_ICON`; 🩺 `Stethoscope`; 🛰 `RadioTower`; 🔥 `Flame`; ▶ `Play`; ❚❚ `Pause`; ✓ `Check`; ← `ArrowLeft`; + `Plus`; 📚 `Library`; 🔌 `Plug`; mood faces → `Angry` `Frown` `Meh` `Smile` `Laugh`.
- Sizes: `h-4 w-4` inline and in buttons, `h-5 w-5` leading a row or in navigation. Default stroke. Colour `text-dim` or inherited; never a status colour unless it *is* status.
- Use the shared maps so the same thing looks the same on every page: `VITAL_ICON` (bp `Gauge`, hr `HeartPulse`, spo2 `Wind`, temp `Thermometer`, glucose `Droplet`, sleep `Moon`, mood `Smile`, exercise `Dumbbell`, vision `Eye`, water `GlassWater`), `SYSTEM_ICON`, `CONTEXT_ICON`.
- Decorative icons get `aria-hidden="true"`. An icon that is the only content of a control must be an `IconButton` with a `label`. No icon without a job; no `Sparkles`.

## 9. Charts (recharts)

Spread the shared theme; do not pick colours per chart.

```tsx
import { chart, ChartTooltip } from '../components/ui'

<div className="h-64 rounded-xl border border-line bg-deep p-3">
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={rows} margin={chart.margin}>
      <CartesianGrid {...chart.grid} />
      <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(d) => `D${d}`} {...chart.xAxis} />
      <YAxis domain={['auto', 'auto']} {...chart.yAxis} />
      <ReferenceArea y1={lo} y2={hi} {...chart.band('ok')} />        {/* reference range */}
      <ReferenceLine y={130} {...chart.refLine('warn')} />            {/* threshold */}
      <ReferenceLine y={baseline} {...chart.refLine()} />             {/* neutral baseline */}
      <Tooltip {...chart.tooltip} content={<ChartTooltip unit="mmHg" formatLabel={(l) => `Day ${l}`} />} />
      <Line dataKey="sys" name="Systolic" {...chart.line} />
      <Line dataKey="dia" name="Diastolic" {...chart.line} stroke={chart.series[1]} />
    </LineChart>
  </ResponsiveContainer>
</div>
<p className="mt-2 text-sm text-dim">Green band: normal range. Dashed amber: attention threshold. Dashed grey: your baseline.</p>
```

- **Data is ink.** Series colours come from `chart.series` (ink, dim, accent) — at most three series per chart. Status colours appear only as bands, threshold lines, or a marker on an out-of-range point.
- **Straight segments** (`type="linear"`, already in `chart.line`). A smoothed curve invents values between measurements. With fewer than ~15 points add `dot={{ r: 2.5 }}` so real readings are visible.
- Horizontal hairline grid only; mono 12 px ticks in `dim`; no vertical grid, tick marks, y-axis line, gradients, area fills under lines, glows or legends-in-a-box (name series in the caption or with direct labels).
- Plot area sits in a `bg-deep` well. Every band and dashed line is explained in a `text-sm text-dim` caption under the chart.
- Time on the x-axis is true time (`type="number"`), not evenly spaced categories.
- Animate the first draw only (`chart.line` does it). Live charts: `isAnimationActive={false}` and a `LiveDot` beside the title.
- Bars: `{...chart.bar}`; colour a bar by status only when the bar itself has a status.
- Outside React (canvas, three.js) read colours from the CSS variables (`--color-ink`, `--color-line`, `--color-dim`, `--color-ok`…) or `STATUS_COLOR`, never hard-coded.

## 10. Migration checklist

Work top to bottom on your page; search for each pattern.

**Structure**
1. Remove page-level `max-w-*`, `px-*`, `min-h-screen`, backgrounds and `.aurora`. Start with `<PageHeader>`, then `<div className="space-y-10">` of `<Section>`s.
2. `glass rounded-3xl p-5` and hand-made boxes → `<Section>` (default) or `<Card>`. Flatten nested boxes: inner boxes become rows (`List`/`Row`) or plain grid cells separated by hairlines (`border-t border-line`, `divide-y divide-line`).
3. `<h2 className="label">` section titles → `Section title`. Keep `.label` only for field labels and captions above numbers.

**Classes**
4. Delete `font-display`, `uppercase`, every `tracking-*`, `backdrop-blur*`, `bg-gradient*`, `shadow-*`, `drop-shadow*`, glows, `bg-*/70`-style translucency over the page, `text-[10px]` / `text-[11px]` (→ `text-xs` or `.meta`).
5. `text-cyan` on links → `className="link"` or `<SourceLink>`. `border-cyan` / `bg-cyan/10` for *selected* → `bg-panel2` (+ `border-ink` on choice cards). `bg-cyan text-space` → `<Button variant="primary">` or `<Tabs>`. Remaining `cyan` / `ice` → `accent` / `accent-hi`, and only for its four jobs.
6. Hard-coded hex (`#53D7FF`, `#91A9BD`, `#1E3A55`, `#07111F`, `#35D399`, `#F6BD60`, `#F06464`, `#162D42` …) → tokens, `chart.*`, CSS variables or `STATUS_COLOR`.
7. `rounded-xl` on buttons/inputs → primitives; `rounded-full` buttons → `Button`. Coloured left borders (`border-l-4 border-warn`) → `<Notice tone>`.

**Components**
8. Every `<button className=…>` → `Button` / `IconButton`; every raw `<input>` / `<select>` / `<textarea>` → `Field` + control; pill-button groups → `Tabs`; hand-made modals → `Dialog` / `Sheet` (delete your own scrim, Esc and focus code).
9. Numbers with units → `Metric`. Progress bars → `Meter`. `CountUp` → `AnimatedNumber`. Crew colour dots / coloured initials (`c.color`) → `<Avatar name text={callsign}>`.
10. Status: coloured dots, uppercase `STATUS_LABEL`, hand-made pills → `StatusPill` / `StatusText`. Check every place a missing value falls back to `'ok'` and pass `null` instead.
11. Emoji → lucide (§8). `CONTEXTS[x].icon` and the mood emoji in the data layer are strings: render `CONTEXT_ICON[x]` / lucide faces instead of the string.
12. Loading: one `<Spinner>` for the whole page → skeletons shaped like the content where you can. Empty arrays → `EmptyState`.

**Motion**
13. Ad-hoc `motion.div initial/animate` → `Reveal` / `Stagger`. Delete `whileHover` scale/lift, `repeat: Infinity`, long delays, count-up-on-load, and raw durations/easings (use `DUR` / `EASE` / `SPRING`). Alerts come out of any stagger.

**Charts**
14. Apply §9: spread `chart.*`, remove `<defs>` gradients and `type="monotone"`, add the caption.

**Patterns specific to current features**
- **Live readouts and alarms (Environment sensor station):** each reading is a `Card` with `Metric` (`value={null} status={null}` until the first sample); connection state is a `Badge` (`Not connected`) or `LiveDot` (`Live · last 5 min`) — never a pulsing dot when nothing streams. Sample / simulated readings carry `<Badge>Sample</Badge>`. An alarm is `<Notice tone="crit" role="alert">` pinned at the top of the section, appearing instantly, with the action steps as a numbered list inside it; no flashing, no looping animation, sound optional and user-controlled. Thresholds: `Meter` with `marks`. Range selector: `Tabs variant="pill"`. Demo thresholds say "demo threshold" in the caption.
- **Consultation thread (AURA chat):** a single column `max-w-2xl`, not bubbles with tails and not two colours of balloon. The person's message: right-aligned `bg-panel2 rounded-2xl px-4 py-3`. AURA's answer: left-aligned plain text on the page with a `Logo size={20}` and the name in `.label` above it; sources as `SourceLink`s under the answer. **Urgency banner:** `<Notice tone="crit" role="alert" title="…">` rendered above the answer text, immediately, and produced by the deterministic rules (say so: "Rule-based alert"). **Medication / action cards:** `<Card tone="well">` with a `text-[15px] font-semibold` title, a `List` of plain rows (dose, timing, cautions) and a `Notice tone="info"` for "decision support, confirm with your {contact}". Waiting for an answer: `Spinner label="AURA is reading your measurements"` — no typing dots, no typewriter text. Composer: `Textarea` + one primary `Button`; suggested questions are `Button size="sm"` (secondary), not gradient chips.
- **Multi-step wizard (Samsung import):** one `Sheet` (or `Dialog wide`) for the whole flow; title = current step, `description` = "Step 2 of 4"; steps switch with `<PageTransition routeKey={step} direction={±1}>`; footer has `Back` (quiet) left of the single primary action. File drop zone: `border border-dashed border-edge rounded-xl bg-deep` with an icon, one sentence and a secondary `Button` — no animated dashes. Progress: `Meter` + a sentence ("1,204 of 5,880 rows"). Preview of what will be imported: `List` rows with counts as `Badge`s. Result: `Notice tone="ok"`; problems: `Notice tone="warn"` listing what was skipped and why. Synthetic sample files are labelled `<Badge>Synthetic sample</Badge>`.
- **3D viewer overlay (BodyViewer):** the canvas sits directly on `bg-panel` inside a `Card pad="none"` — no grid floor, rings, halos or scan lines in new work; highlight colours come from `STATUS_COLOR` only, everything healthy stays neutral. Overlay controls are real primitives placed over the canvas: layer toggles = `Tabs variant="pill"` or `Button size="sm"` with `aria-pressed` (selected = `bg-panel2 border-edge`), view actions = `IconButton variant="secondary"` (`RotateCcw` reset, `Pause`/`Play`) on an opaque `bg-panel` backing so they stay legible over the model. The help line ("Drag to rotate · scroll to zoom") is `text-xs text-dim`; the attribution stays visible as `.meta`. Auto-rotation is off by default (nothing loops); selecting an organ moves the camera with `DUR.slow`. A legend states what highlight colours mean, and the list of systems beside the viewer offers the same selection for keyboard and screen-reader users.

**Before you finish:** look at your page at 1440×900 and 390×844 for every role that can see it; tab through it (the focus ring must always be visible); check it with the OS reduce-motion setting on; `npx tsc --noEmit`.

## 11. Do not

| Banned | Why |
|---|---|
| Navy + cyan, glows, neon, `drop-shadow` halos | Signals "generic AI dashboard"; glow lowers contrast at the edges of text and marks |
| Glassmorphism, `backdrop-blur`, translucent panels | Costs legibility and frame rate for no information |
| Gradient text, gradient fills, gradient buttons | Colour must mean something here; gradients mean nothing |
| Emoji as icons | Inconsistent across devices, cannot be styled, read as toys in a medical tool |
| Everything in identical rounded cards; cards inside cards | Flattens hierarchy; the eye cannot find what matters |
| Tiny uppercase letter-spaced labels | Slower to read, shouts, and was on everything |
| Text under 12 px, body text in `dim` | Older adults and stressed readers are the users |
| Colour-only status; green numbers when all is fine | Fails colour-blind users; and a screen full of green hides the one amber |
| Status hues for decoration, identity colours for people | Destroys the meaning of the three status colours |
| Showing missing data as Normal or as 0 | A false "normal" is the most dangerous thing this product can say |
| Count-up from zero, typewriter text, typing dots | Shows values that are not the measurement; delays reading |
| Infinite animation, auto-rotating models, hover lift/scale, parallax, scan lines | Motion without a cause steals attention from readings |
| Delayed or staggered alerts | Urgent information is never held back for choreography |
| Smoothed chart curves, area gradients under lines | Invents data between measurements; decoration |
| More than one primary button per view; accent-coloured buttons | The next step must be unambiguous; accent is for interaction feedback only |
| Tooltips for essential information | Touch users never see them |
| Raw hex values, raw durations and beziers, `z-50` in pages | Bypasses the system; the next change will miss them |
| New fonts, weights 700+, italics for emphasis | Three weights of one family is the whole typographic voice (italic is for quotations only) |
| NASA or agency insignia | Not affiliated with NASA |

## 12. Progressive disclosure and press feedback

**Show first, fold the rest.** Each page opens on what the person needs to act: status, alerts, the one next action and the key numbers. Everything that explains is folded and one tap away.

| Always visible | Folded by default |
|---|---|
| Alerts and their action, emergency steps, red flags ("Get help at once if"), restrictions and "Changed for your safety", "Do not" lists, medicine cautions that apply to the person, the gas alarm and its steps while it is active, the "not a certified alarm" line | "How it is calculated", chart keys ("How to read this chart"), sources and quotes, research notes, secondary charts and activity data, equipment lists, history tables (records), settings / profiles, long descriptions, setup instructions, older answers in a thread |

- **Section level:** `<Disclosure id="page.thing" title meta summary>` — same heading + hairline as `Section`. `meta` is a count or short fact ("4 sources"), `summary` one line shown only while closed (e.g. "Latest: 138/86 mmHg · Day 142"), so the closed row still informs.
- **Row level** (inside cards, sheets, under charts): `size="row"`.
- **Long paragraphs:** `<ShowMore lines={1|2}>` clamps to one or two lines and offers "Show more" only when text is actually cut off; `short` gives a hand-written short version.
- **Remembered:** give every disclosure a stable `id` (`'coach.equipment'`). The choice is stored on the device under `aura.open.v1` (localStorage, guarded; private mode simply forgets). Do not pass an `id` where the safe default must win every time (e.g. "Watch and escalate" opens by default when the result is not urgent).
- **Many sections:** wrap the page in `<DisclosureGroup>` and put `<ExpandAll />` in the `PageHeader` actions (it hides itself with fewer than three sections).
- Closed panels are unmounted, so folded charts cost nothing. Long below-the-fold sections may add `cv-auto` (`content-visibility: auto`).
- Accessibility is built in: a real `button` with `aria-expanded`/`aria-controls`, inside an `h2` for sections; reduced motion swaps the height animation for a fade.

**Press feedback** comes from the primitives — do not hand-roll it.
- `.press` on any control: scale 0.97 while held (0.99 for full-width rows and section headers), plus a 200 ms highlight that starts at the pointer (a `::before` radial in `currentColor`, animated with the Web Animations API from one delegated listener in `ui.tsx`). Transform and opacity only; nothing under `prefers-reduced-motion`. Already on `Button`, `IconButton`, `Tabs`, `Row`, `Disclosure`, `ShowMore`, nav links and the phone bottom bar (its icon dips to 0.86). Checkboxes squeeze their box and the tick scales in.
- Custom clickable things (a card-sized button, a `summary`) add `className="press"` and keep `position: relative`.
- **After a save:** `const [done, flash] = useFlash()`; call `flash()` on success; `<Button done={done}>` turns its icon into a check that pops once, `<Saved show={done} />` shows "Saved" (announced as status). No confetti, no green buttons.
- **Sound (optional):** `data-sfx="tick|select|confirm"` on an element plays that tone on click (`src/lib/sfx.ts`; silent unless the person turned sounds on). Primary buttons get `select`, tabs and nav `tick`.

**Phones.** Long forms pin their one primary action above the bottom bar: `sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:static`. Tables become stacked rows below `sm`. Charts on phones use `minTickGap={48}` and a larger active dot (r 7) for touch.

## 13. The AURA core (voice presence and layered instrument)

The one object in the app that is allowed to keep moving, because it stands for a live process: the voice assistant. Since the second design pass it is also an instrument you can enter, layer by layer. Design canvases (Claude Design): layered instrument, dive, full screen, emergency, states, phone: https://claude.ai/artifact/DcSmFxhmSz4m4dnXEEjcdX · first pass (the six voice poses): https://claude.ai/artifact/8fA92Bbs3vXCfcPovt1x5o. Code: `src/components/aura/core/` — `model.ts` (voice states and pose table), `layers.ts` (layers, dive maths, data mapping; pure), `CoreScene.ts` (the only three.js file, lazy chunk), `CoreFallback.tsx` (flat SVG of the same data), `AuraCore.tsx`, `control.ts` (imperative API), `useFullscreen.ts` / `CorePopups.tsx` / `popups.ts` (full screen).

- **What it is.** An instrument, not a face. Flat hairlines of constant pixel width on the page background; no card, floor, halo, glow, blur or gradient. The HUD idiom stays inside the Quiet Cockpit rules: fine tick rings, segmented dials, bracketed mono readouts with leader lines.
- **Four layers, outside to inside. Every mark is read from the app; nothing is decoration:**

| # | Layer | What it draws | Source |
|---|---|---|---|
| 1 | Mission shell | Fixed tick ring (the reference; never moves). 60-segment dial filled to mission day ÷ planned length (no fill when the profile has no planned length). Signal delay in the readout. Short dials on the inner rail: cabin temperature, humidity and gas ratio against their limits, labelled live sensor kit / stored / old stored | `useSession().mission`, `MISSIONS`, cabin context + `envLive` |
| 2 | Vitals orbit | One arc per tracked vital. Fill = latest value inside that field's own min–max. Selectable | `ev.quality.items`, `ev.values`, `ev.vitalStatus` |
| 3 | Body-systems lattice | Named nodes on the geodesic lattice = the body systems of this profile, each with the worst status behind it; hollow = no current reading. The lattice swells with the person's voice | `ev.systems`, `ev.systemStatus`, `ev.alerts` |
| 4 | Voice nucleus | The nucleus (AURA's voice), three rings (the posture of the voice state) and 72 bars = the last three seconds of sound level, sampled only while listening or speaking | voice presence store, `getVoiceLevel()` |

- **Empty is drawn as empty.** No cabin readings: dotted rail and the words "No cabin readings". No measurements: dotted orbit and "No measurements yet", no named lattice nodes. Never an invented value.
- **Colour.** Greys (`edge`, `dim`, `soft`, `ink`) draw the object. `accent` marks only the live parts (ring A, nucleus, level bars, the shell being crossed) and follows the profile. Status colour appears only as health status and always with a shape and a word (§7): normal grey dot, attention `warn` + diamond, urgent `crit` + octagon, no data dotted. Nothing is accented when voice is off.
- **Six voice states, six shapes** (the poses of the first pass, drawn at 0.62 scale inside the data layers; each also has a word; the transcript and AURA's sentence are text):

| State | Shape | Motion | Driven by |
|---|---|---|---|
| Ready (idle) | Three rings at three tilts, small nucleus | Rings drift, one turn in 70 to 120 s; nucleus breathes 4 % every 6 s; 30 fps | `phase: 'idle'` |
| Listening | Rings flat toward you, concentric; nucleus opens hollow | Lattice and inner ring swell with the microphone level (rise 60 ms, settle 300 ms) | `phase: 'listening'` + `getVoiceLevel()` |
| Working on it | Rings as gimbals at right angles, lattice drawn in, accent arc on the outer ring | Gimbals turn steadily; the arc travels once every 2.4 s | `phase: 'thinking'` |
| Speaking | Rings level and nested like ripples; nucleus large and filled | Nucleus swells with speech energy; rings follow outward, 80 ms apart | `phase: 'speaking'` + `getVoiceLevel()` |
| Urgent | Octagon frame locks round the core; rings square up; red replaces accent | Appears at once; three slow pulses, then still (§6). Never flashes | `urgent: true`, or an emergency result on the page |
| Voice is off | Rings parked edge-on and dashed, nucleus hollow | None | `available: false` |

- **Dive.** A continuous depth 0–3 (`layers.ts`): the focused layer fills the view, the layers you passed grow past the frame and fade, the shell you cross flashes once in accent, inner layers wait smaller inside. It snaps to the nearest layer 380 ms after input stops. A breadcrumb ("Shell › Vitals › Systems › Voice", `aria-current` on the layer you are in) and "Deeper" / "Back out" buttons are always there; a sentence under the breadcrumb says what the layer shows. Inputs: Ctrl + scroll or pinch (plain scroll in full screen), `+` `−` PageDown PageUp, `1`–`4`, `0` / Home back to the shell, hand control (two pinching hands apart = deeper, together = back out; pinch-drag turns; fist resets). `control.ts` exports `coreDive(±1)`, `coreGoTo(layer)`, `coreLayer()` so voice can say "go deeper / go back".
- **Select.** Click, tap, pinch-tap or `,` `.` on an item (a vital arc, a system node, a cabin dial, the mission dial) brackets it and opens its readout: label, value and unit, status shape and word, when and from where, then "Open this reading" and "Ask AURA about it". Esc clears. A click on empty space talks to AURA as before. The same items are a list for screen readers.
- **Full screen.** A "Full screen" button on the core, `F` to toggle, Esc to leave. Fullscreen API where it exists; a fixed full-viewport layer where it does not (iOS Safari) and while hand control is on (its cursor lives outside the full-screen element). The single core instance is never remounted. The scene is full-bleed and AURA's words arrive as pop-ups: top-right Read aloud and Exit; right column (max 380 px) one card at a time — AURA's message with the common-symptom chips, the pending question with Yes / No / Not sure, or the result; a caption card with the state word, input level and the live transcript in quotes, kept while something is live and faded 4 s after; "Speak" and "Type instead" at the bottom. Phones: one bottom stack capped at 46 % of the height. Cards are opaque `panel` with a hairline and `shadow-overlay` (no blur), arrive with a fade and an 8–10 px rise, and a dismissed card folds into a chip ("Question waiting") — it is never lost. The pop-ups only draw the consultation: state and handlers live once in `Consultation.tsx`. `presence.fullscreen` tells the floating voice panel to stay out of the way.
- **Emergency in full screen: stay, with a centre sheet.** We do not leave full screen on our own: that would swap the whole display at the worst moment and leave the person to find the banner on a scrolled page. The sheet is the one pop-up allowed to cover the centre: octagon + "Urgent", the title, the rule that fired, then "Do this now" as numbered steps from the same `carePlan()` and `Steps` renderer the page uses, the care contact, "See the full assessment" and "Stay here". A click outside does not close it; "Stay here" folds it into a red bar that reopens it; Esc, Exit and "See the full assessment" lead to the page, where the result is first as before.
- **Exceptions to §6 and §11, and their limits.** The idle drift and the level-driven motion loop, as `LiveDot` does, because they show something live. They stop whenever nothing is live: voice off, urgent after its pulses, reduced motion (the same poses still; the dive is a cut, not a fly-through), off screen, hidden tab. A new state swings the rings in about 400 ms; urgent is never eased in.
- **Cost.** One WebGL context, three.js only in the lazy `CoreScene` chunk, merged geometry (9–12 draw calls), shaders compiled before the first frame, 30 fps idle and display rate only while a level, a dive or a drag is moving, 0 fps when still; pixel ratio capped at 2, at 1.25 in hand mode, and in full screen so the buffer stays near 2.5 megapixels. Data changes update attributes; nothing is rebuilt per frame.
- **Place.** A sticky panel beside the thread from `lg`, one compact row (72 px core, state, one line, mic and full-screen buttons) above the thread on phones. **A result always comes first:** once the assessment is shown the core takes a 13 rem column beside it from `xl` and otherwise moves below the result. It is not shown in the flight surgeon's read-only walk-through.
- **Without WebGL** (missing or context lost) a flat SVG of the same four layers, the same data and the current layer takes its place; the breadcrumb, the reading list, the readout and full screen keep working.
