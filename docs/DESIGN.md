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
| Press | 1 px down, colours in 160 ms | `Button` |
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
