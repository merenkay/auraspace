// AURA shared primitives — "Quiet Cockpit". Usage rules and snippets: docs/DESIGN.md.
// Pages compose these instead of hand-rolling buttons, cards, motion or status colours.
import {
  ArrowUpRight,
  Bone,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleDashed,
  Droplet,
  Droplets,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  GlassWater,
  Heart,
  HeartPulse,
  House,
  Info,
  LoaderCircle,
  Moon,
  OctagonAlert,
  Radiation,
  Rocket,
  ShieldPlus,
  Smile,
  Snowflake,
  Thermometer,
  TriangleAlert,
  Wind,
  X,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, animate, motion, useReducedMotion, type Variants } from 'motion/react'
import {
  cloneElement,
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import type { SystemId } from '../data/systems'
import { STATUS_COLOR, type Status, type VitalKey } from '../data/vitals'
import { sfx } from '../lib/sfx'

/* ================================================================== */
/* Foundations                                                         */
/* ================================================================== */

/** Join class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Motion durations in seconds. `instant` press feedback · `fast` hover/small state · `base` enter/route · `slow` sheets/number tweens · `draw` charts and rings. */
export const DUR = { instant: 0.09, fast: 0.16, base: 0.24, slow: 0.4, draw: 0.7 } as const

/** Easing curves. `out` for anything entering or responding, `in` for anything leaving, `inOut` for moves between two on-screen places. */
export const EASE = {
  out: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  in: [0.4, 0, 1, 1] as [number, number, number, number],
  inOut: [0.6, 0, 0.2, 1] as [number, number, number, number],
}

/** Springs: `snappy` for indicators that follow a tap (tab underline, segmented thumb), `soft` for sheets and dialogs. Neither overshoots visibly. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 },
  soft: { type: 'spring', stiffness: 320, damping: 34 },
} as const

/** Wrap an app root once: honours the OS "reduce motion" setting for every motion component below it. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: EASE.out }}>
      {children}
    </MotionConfig>
  )
}

/** True while a CSS media query matches, e.g. useMedia('(min-width: 768px)'). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** Sets the contextual accent (space · polar · home) for the whole document, including portalled overlays. */
export function useContextAccent(context: 'space' | 'polar' | 'home' | null | undefined) {
  useEffect(() => {
    const root = document.documentElement
    if (context && context !== 'space') root.dataset.context = context
    else delete root.dataset.context
  }, [context])
}

/** Counts up by one each time `value` changes after the first render. Used to replay one-shot "this changed" cues. */
function useChangeTick<T>(value: T): number {
  const [tick, setTick] = useState(0)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      setTick((t) => t + 1)
    }
  }, [value])
  return tick
}

/* ================================================================== */
/* Brand                                                               */
/* ================================================================== */

/** The AURA mark: an open ring with one reading on it. Draws once; never loops. */
export function Logo({ size = 28, wordmark = false, className = '' }: { size?: number; wordmark?: boolean; className?: string }) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <motion.circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        transform="rotate(-16 12 12)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 0.84 }}
        transition={{ duration: DUR.draw, ease: EASE.out }}
      />
      <motion.circle cx="18.36" cy="5.64" r="2.2" fill="var(--color-accent)" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: DUR.draw - 0.15, duration: DUR.base, ease: EASE.out }} />
    </svg>
  )
  if (!wordmark) return <span className={cx('inline-flex text-ink', className)}>{mark}</span>
  return (
    <span className={cx('inline-flex items-center gap-2.5 text-ink', className)}>
      {mark}
      <span className="text-[17px] font-semibold leading-none tracking-[0.06em]">AURA</span>
    </span>
  )
}

/* ================================================================== */
/* Motion primitives                                                   */
/* ================================================================== */

const pageVariants: Variants = {
  enter: (d: number) => ({ opacity: 0, x: d * 16, y: d === 0 ? 8 : 0 }),
  center: { opacity: 1, x: 0, y: 0, transition: { duration: DUR.base, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DUR.instant, ease: EASE.in } },
}

/**
 * Route / step change. The old view fades out fast and stays put; the new one settles in from the
 * side it lives on (`direction` 1 = further along, -1 = back, 0 = unrelated: rises 8 px).
 */
export function PageTransition({ routeKey, direction = 0, children, className }: { routeKey: string; direction?: -1 | 0 | 1; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div key={routeKey} custom={direction} variants={pageVariants} initial="enter" animate="center" exit="exit" className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** Fades and lifts one block into place the first time it scrolls into view. */
export function Reveal({ children, delay = 0, y = 8, className = '' }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-24px' }} transition={{ duration: DUR.base, delay, ease: EASE.out }}>
      {children}
    </motion.div>
  )
}

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.out } },
}

/** A list or grid whose children (`StaggerItem`) enter one after another, 40 ms apart, once. Never use it for urgent alerts. */
export function Stagger({ children, className, step = 0.04, delay = 0, as = 'div' }: { children: ReactNode; className?: string; step?: number; delay?: number; as?: 'div' | 'ul' | 'ol' | 'section' }) {
  const Comp = motion[as] as typeof motion.div
  return (
    <Comp className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-24px' }} variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}>
      {children}
    </Comp>
  )
}

export function StaggerItem({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'section' }) {
  const Comp = motion[as] as typeof motion.div
  return (
    <Comp className={className} variants={staggerItem}>
      {children}
    </Comp>
  )
}

/**
 * A number that shows the real value immediately and tweens only when the value CHANGES.
 * It never counts up from zero: a measurement must not be shown as something it is not.
 */
export function AnimatedNumber({ value, decimals = 0, className = '', format }: { value: number; decimals?: number; className?: string; format?: (v: number) => string }) {
  const fmt = (v: number) => (format ? format(v) : v.toFixed(decimals))
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const reduce = useReducedMotion()
  useEffect(() => {
    const start = from.current
    from.current = value
    if (start === value || reduce || !Number.isFinite(start) || !Number.isFinite(value)) {
      setShown(value)
      return
    }
    const controls = animate(start, value, { duration: DUR.slow, ease: EASE.out, onUpdate: setShown })
    return () => controls.stop()
  }, [value, reduce])
  return (
    <span className={className}>
      <span aria-hidden="true">{fmt(shown)}</span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  )
}

/** @deprecated Old name. Same component as AnimatedNumber (no longer counts from zero). */
export const CountUp = AnimatedNumber

/* ================================================================== */
/* Buttons                                                             */
/* ================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BTN_BASE =
  'press relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none aria-disabled:pointer-events-none'
const BTN_VARIANT: Record<ButtonVariant, string> = {
  // A disabled primary button turns into a plain grey plate: obviously inactive, never a dimmed white slab.
  primary: 'bg-ink text-space hover:bg-white disabled:bg-panel2 disabled:text-dim aria-disabled:bg-panel2 aria-disabled:text-dim',
  secondary: 'border border-edge text-ink hover:border-soft hover:bg-panel2 disabled:opacity-45 aria-disabled:opacity-45',
  quiet: 'text-soft hover:bg-panel2 hover:text-ink disabled:opacity-45 aria-disabled:opacity-45',
  danger: 'border border-crit/60 text-crit hover:bg-crit/10 disabled:opacity-45 aria-disabled:opacity-45',
}
// `sm` is 36 px tall on screen but keeps a 44 px touch target through the ::after hit area.
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-12 px-5 text-base',
}

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, sets aria-busy and blocks clicks. Keep the label unchanged so the width does not jump. */
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  /** Stretch to the container width. */
  full?: boolean
  /** Render as a router link. */
  to?: string
  /** Render as an external link (opens in a new tab). */
  href?: string
  /** Briefly true after a successful action: the icon becomes a check that pops in once (pair with useFlash). */
  done?: boolean
  children?: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

export function Button({ variant = 'secondary', size = 'md', loading = false, done = false, icon: Icon, iconRight: IconRight, full = false, to, href, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  const cls = cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], full && 'w-full', className)
  const inner = (
    <>
      {loading ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : done ? (
        <Check className="h-4 w-4 animate-pop" aria-hidden="true" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      {children}
      {IconRight && <IconRight className="h-4 w-4" aria-hidden="true" />}
    </>
  )
  if (to)
    return (
      <Link to={to} className={cls} aria-disabled={disabled || undefined}>
        {inner}
      </Link>
    )
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    )
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} data-sfx={variant === 'primary' ? 'select' : undefined} {...rest}>
      {inner}
    </button>
  )
}

/** A square button that shows only an icon. `label` is required: it becomes the accessible name and the hover title. */
export function IconButton({ icon: Icon, label, variant = 'quiet', size = 'md', className, type = 'button', ...rest }: { icon: LucideIcon; label: string; variant?: 'quiet' | 'secondary'; size?: 'sm' | 'md'; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(BTN_BASE, BTN_VARIANT[variant], size === 'sm' ? "h-9 w-9 after:absolute after:-inset-1 after:content-['']" : 'h-11 w-11', className)}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} aria-hidden="true" />
    </button>
  )
}

/* ================================================================== */
/* Forms                                                               */
/* ================================================================== */

const FieldCtx = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null)

/** Shared look of text controls. Use <Input>/<Select>/<Textarea>; reach for this string only for exotic controls. */
export const controlCls =
  'w-full rounded-lg border border-edge bg-deep px-3.5 text-base text-ink transition-colors placeholder:text-dim hover:border-soft focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-crit'

/** Label + control + hint or error, wired together for screen readers. Put exactly one control inside. */
export function Field({ label, hint, error, optional = false, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; optional?: boolean; children: ReactNode; className?: string }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-soft">
        {label}
        {optional && <span className="font-normal text-dim"> (optional)</span>}
      </label>
      <FieldCtx.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldCtx.Provider>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-crit">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, trailing, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { trailing?: ReactNode }) {
  const f = useContext(FieldCtx)
  // an explicit id wins (e.g. a hand-written <label htmlFor>); inside <Field> the Field supplies it
  const el = <input id={id ?? f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} {...rest} className={cx(controlCls, 'h-11', trailing ? 'pr-12' : '', className)} />
  if (!trailing) return el
  return (
    <div className="relative">
      {el}
      <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
    </div>
  )
}

/** Password field with a show/hide switch. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false)
  return <Input {...props} type={show ? 'text' : 'password'} trailing={<IconButton icon={show ? EyeOff : Eye} label={show ? 'Hide password' : 'Show password'} size="sm" onClick={() => setShow((s) => !s)} />} />
}

export function Select({ className, children, id, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const f = useContext(FieldCtx)
  return (
    <div className="relative">
      <select id={id ?? f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} {...rest} className={cx(controlCls, 'h-11 appearance-none pr-10', className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" aria-hidden="true" />
    </div>
  )
}

export function Textarea({ className, rows = 3, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const f = useContext(FieldCtx)
  return <textarea id={id ?? f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} rows={rows} {...rest} className={cx(controlCls, 'py-2.5 leading-normal', className)} />
}

export function Checkbox({ label, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { label: ReactNode; className?: string }) {
  return (
    <label className={cx('tap-check flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-soft', className)}>
      <span className="tap-box relative mt-0.5 flex h-5 w-5 shrink-0">
        <input type="checkbox" {...rest} className="peer h-5 w-5 cursor-pointer appearance-none rounded-[5px] border border-edge bg-deep transition-colors checked:border-ink checked:bg-ink hover:border-soft" />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 scale-50 text-space opacity-0 transition-[opacity,scale] duration-150 peer-checked:scale-100 peer-checked:opacity-100" strokeWidth={3} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </label>
  )
}

/* ================================================================== */
/* Layout: page header, sections, surfaces, rows                       */
/* ================================================================== */

/** The top of every page: one title, optional line above/below it, status and actions on the right. */
export function PageHeader({ title, eyebrow, description, status, actions, className }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; status?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm text-dim">{eyebrow}</p>}
        <h1 className="text-title text-ink">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-soft">{description}</div>}
      </div>
      {(status || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          {status}
          {actions}
        </div>
      )}
    </header>
  )
}

/** An unboxed group: heading, hairline, content. The default way to group things — reach for Card only for discrete objects. */
export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="text-heading text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-dim">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  )
}

const CARD_TONE = {
  surface: 'border border-line bg-panel',
  raised: 'border border-line bg-panel2',
  well: 'border border-line bg-deep',
  plain: '',
} as const
const CARD_PAD = { none: '', sm: 'p-4', md: 'p-4 sm:p-5' } as const

/** A flat surface with a hairline. No shadow, blur or gradient. Never nest a Card in a Card. */
export function Card({ children, className, tone = 'surface', pad = 'md', as: Tag = 'div' }: { children: ReactNode; className?: string; tone?: keyof typeof CARD_TONE; pad?: keyof typeof CARD_PAD; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cx('rounded-2xl', CARD_TONE[tone], CARD_PAD[pad], className)}>{children}</Tag>
}

/** A Card with a title row. Kept for existing pages; new code can use Card or Section directly. */
export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-panel p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold leading-snug text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Rows separated by hairlines. Use for anything list-like instead of a stack of cards. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx('divide-y divide-line border-y border-line', className)}>{children}</ul>
}

type RowProps = {
  title: ReactNode
  description?: ReactNode
  /** Icon, avatar or status icon on the left. */
  leading?: ReactNode
  /** Value, badge or time on the right. */
  trailing?: ReactNode
  /** Makes the whole row a router link (adds a chevron). */
  to?: string
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
  className?: string
}

export function Row({ title, description, leading, trailing, to, onClick, selected = false, disabled = false, className }: RowProps) {
  const interactive = Boolean(to || onClick)
  const cls = cx('flex min-h-14 w-full items-center gap-3 px-2 py-2.5 text-left', interactive && 'press transition-colors hover:bg-panel2', selected && 'bg-panel2', disabled && 'pointer-events-none opacity-45', className)
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center text-dim">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-sm leading-snug text-dim">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-sm text-soft">{trailing}</span>}
      {to && <ChevronRight className="h-4 w-4 shrink-0 text-dim" aria-hidden="true" />}
    </>
  )
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected || undefined} className={cls}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

/** Initials in a neutral disc. People are told apart by name, never by a personal colour (colour is reserved for status). */
export function Avatar({ name, text, size = 36, className }: { name: string; text?: string; size?: number; className?: string }) {
  const initials =
    text ??
    name
      .split(/\s+/)
      .filter((p) => /^[A-Za-zÀ-ÿ]/.test(p) && !p.endsWith('.'))
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * (initials.length > 2 ? 0.3 : 0.36))) }} className={cx('inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-panel2 font-mono font-medium leading-none text-soft', className)}>
      {initials}
    </span>
  )
}

/* ================================================================== */
/* Status                                                              */
/* ================================================================== */

/** A health status, or `null` when there is no reading. Missing data is its own state — it is never shown as Normal. */
export type StatusOrNone = Status | null

type StatusKey = Status | 'none'
const STATUS_ICON: Record<StatusKey, LucideIcon> = { ok: CircleCheck, warn: TriangleAlert, crit: OctagonAlert, none: CircleDashed }
const STATUS_TEXT: Record<StatusKey, string> = { ok: 'Normal', warn: 'Attention', crit: 'Urgent', none: 'No data' }
const STATUS_TEXT_CLS: Record<StatusKey, string> = { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', none: 'text-dim' }

/** Sentence-case status word: Normal · Attention · Urgent · No data. */
export function statusLabel(status: StatusOrNone): string {
  return STATUS_TEXT[status ?? 'none']
}

/** The status glyph. Each status has its own SHAPE (circle-check · triangle · octagon · dashed circle), so it reads without colour. Pings once when the status changes. */
export function StatusIcon({ status, size = 16, className }: { status: StatusOrNone; size?: number; className?: string }) {
  const key = status ?? 'none'
  const Icon = STATUS_ICON[key]
  const tick = useChangeTick(key)
  return (
    <span className={cx('relative inline-flex shrink-0', STATUS_TEXT_CLS[key], className)} style={{ width: size, height: size }}>
      {tick > 0 && <span key={tick} className="absolute inset-0 animate-status-ping rounded-full border-2 border-current" aria-hidden="true" />}
      <Icon width={size} height={size} aria-hidden="true" />
    </span>
  )
}

/** Inline status: icon + word (+ optional detail). The quiet default next to a number. */
export function StatusText({ status, children, className }: { status: StatusOrNone; children?: ReactNode; className?: string }) {
  const key = status ?? 'none'
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm', className)}>
      <StatusIcon status={status} size={15} />
      <span className={cx('font-medium', key === 'ok' ? 'text-soft' : STATUS_TEXT_CLS[key])}>{STATUS_TEXT[key]}</span>
      {children && <span className="text-dim">· {children}</span>}
    </span>
  )
}

const PILL_TONE: Record<StatusKey, string> = {
  ok: 'border-line text-soft',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  crit: 'border-crit/40 bg-crit/10 text-crit',
  none: 'border-dashed border-edge text-dim',
}

/**
 * Boxed status: icon + word. "Normal" stays quiet (hairline, neutral text); Attention and Urgent get a tint;
 * `status={null}` renders "No data". `announce` makes screen readers speak the change (use it once per page, on the overall status).
 */
export function StatusPill({ status, small = false, label, announce = false, className }: { status: StatusOrNone; small?: boolean; label?: string; announce?: boolean; className?: string }) {
  const key = status ?? 'none'
  return (
    <span role={announce ? 'status' : undefined} className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium', small ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]', PILL_TONE[key], className)}>
      <StatusIcon status={status} size={small ? 13 : 15} />
      {label ?? STATUS_TEXT[key]}
    </span>
  )
}

/* Shared icon vocabulary, so every page draws the same thing the same way. */
export const CONTEXT_ICON: Record<'space' | 'polar' | 'home', LucideIcon> = { space: Rocket, polar: Snowflake, home: House }
export const VITAL_ICON: Record<VitalKey, LucideIcon> = { bp: Gauge, hr: HeartPulse, spo2: Wind, temp: Thermometer, glucose: Droplet, sleep: Moon, mood: Smile, exercise: Dumbbell, vision: Eye, water: GlassWater }
export const SYSTEM_ICON: Record<SystemId, LucideIcon> = { brain: Brain, eyes: Eye, heart: Heart, lungs: Wind, metabolism: Flame, immune: ShieldPlus, bones: Bone, renal: Droplets, radiation: Radiation }

type Tone = 'neutral' | 'accent' | Status
const BADGE_TONE: Record<Tone, string> = {
  neutral: 'border-line text-soft',
  accent: 'border-accent/40 text-accent',
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  crit: 'border-crit/50 text-crit',
}

/** Small metadata tag (source, "Simulated", counts). Mono, sentence case. For health status use StatusPill. */
export function Badge({ children, tone = 'neutral', icon: Icon, className }: { children: ReactNode; tone?: Tone; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono text-xs', BADGE_TONE[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** "This is streaming now". The only thing in the product allowed to pulse continuously. */
export function LiveDot({ label = 'Live', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono text-xs text-accent', className)}>
      <span className="h-1.5 w-1.5 animate-live rounded-full bg-accent" aria-hidden="true" />
      {label}
    </span>
  )
}

const NOTICE_TONE = {
  info: { box: 'border-line bg-panel', icon: 'text-dim', Icon: Info },
  ok: { box: 'border-ok/30 bg-ok/10', icon: 'text-ok', Icon: CircleCheck },
  warn: { box: 'border-warn/30 bg-warn/10', icon: 'text-warn', Icon: TriangleAlert },
  crit: { box: 'border-crit/40 bg-crit/10', icon: 'text-crit', Icon: OctagonAlert },
} as const

/** A message that needs reading: alerts, demo-mode notes, errors. Appears instantly — alerts are never delayed by animation. */
export function Notice({ tone = 'info', title, children, action, role, className }: { tone?: 'info' | Status; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'alert' | 'status'; className?: string }) {
  const t = NOTICE_TONE[tone]
  return (
    <div role={role} className={cx('flex items-start gap-3 rounded-xl border p-3.5', t.box, className)}>
      <t.Icon className={cx('mt-0.5 h-[18px] w-[18px] shrink-0', t.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-soft">
        {title && <p className="text-[15px] font-semibold leading-snug text-ink">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ================================================================== */
/* Numbers and data display                                            */
/* ================================================================== */

const METRIC_SIZE = { md: 'text-metric-md', lg: 'text-metric-lg', xl: 'text-metric-xl' } as const

/**
 * A labelled number. The number is ink when normal and takes the status colour only when it needs attention;
 * the status line below always says it in words too.
 */
export function Metric({ label, value, unit, decimals = 0, size = 'lg', status, hint, className }: { label: ReactNode; value: number | string | null; unit?: ReactNode; decimals?: number; size?: keyof typeof METRIC_SIZE; status?: StatusOrNone; hint?: ReactNode; className?: string }) {
  const tone = status === 'warn' ? 'text-warn' : status === 'crit' ? 'text-crit' : 'text-ink'
  return (
    <div className={className}>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cx(METRIC_SIZE[size], value == null ? 'text-dim' : tone)}>{value == null ? '—' : typeof value === 'number' ? <AnimatedNumber value={value} decimals={decimals} /> : value}</span>
        {unit && value != null && <span className={cx('text-dim', size === 'md' ? 'text-sm' : 'text-base')}>{unit}</span>}
      </div>
      {status !== undefined ? (
        <StatusText status={status} className="mt-2">
          {hint}
        </StatusText>
      ) : hint ? (
        <p className="mt-2 text-sm text-dim">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A thin scale showing where a value sits between min and max, with optional threshold ticks.
 * Use instead of decorative progress bars. The fill grows once.
 */
export function Meter({ value, min = 0, max = 100, marks = [], status, label, className }: { value: number; min?: number; max?: number; marks?: { at: number; status?: Status }[]; status?: Status; label: string; className?: string }) {
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100))
  return (
    <div role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} className={cx('relative h-1.5', className)}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-line">
        <motion.div className="h-full rounded-full" style={{ background: status ? STATUS_COLOR[status] : 'var(--color-ink)' }} initial={{ width: 0 }} animate={{ width: `${pct(value)}%` }} transition={{ duration: DUR.draw, ease: EASE.out }} />
      </div>
      {marks.map((m) => (
        <span key={m.at} aria-hidden="true" className="absolute top-0 h-full w-px" style={{ left: `${pct(m.at)}%`, background: m.status ? STATUS_COLOR[m.status] : 'var(--color-edge)' }} />
      ))}
    </div>
  )
}

/** Overall score as a ring. Draws once; no glow. */
export function ScoreRing({ score, status, size = 168 }: { score: number; status: Status; size?: number }) {
  const stroke = Math.max(4, Math.round(size / 26))
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Health score ${score} of 100, ${STATUS_TEXT[status]}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STATUS_COLOR[status]}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, score)) / 100) }}
          transition={{ duration: DUR.draw, ease: EASE.out }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ fontSize: size * 0.3, letterSpacing: '-0.03em' }} className="font-medium leading-none text-ink">
          <AnimatedNumber value={score} />
        </span>
        <span className="mt-1.5 text-sm text-dim">of 100</span>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Charts (recharts): spread these instead of hand-picking colours     */
/* ================================================================== */

const TICK = { fill: 'var(--color-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }

/**
 * One look for every recharts chart. Usage:
 *   <LineChart data={d} margin={chart.margin}>
 *     <CartesianGrid {...chart.grid} /> <XAxis dataKey="day" {...chart.xAxis} /> <YAxis {...chart.yAxis} />
 *     <ReferenceArea y1={90} y2={130} {...chart.band('ok')} /> <ReferenceLine y={118} {...chart.refLine()} />
 *     <Tooltip {...chart.tooltip} content={<ChartTooltip unit="mmHg" />} />
 *     <Line dataKey="value" {...chart.line} />
 *   </LineChart>
 */
export const chart = {
  margin: { top: 8, right: 12, bottom: 0, left: 0 },
  /** Data is drawn in ink. A second series uses `chart.series[1]`; status colours are for status only. */
  series: ['var(--color-ink)', 'var(--color-dim)', 'var(--color-accent)'],
  grid: { stroke: 'var(--color-line)', strokeDasharray: '0', vertical: false },
  xAxis: { tick: TICK, tickLine: false, axisLine: { stroke: 'var(--color-line)' }, tickMargin: 8, minTickGap: 28 },
  yAxis: { tick: TICK, tickLine: false, axisLine: false, tickMargin: 4, width: 44 },
  /** Straight segments: a curve would invent values between measurements. */
  line: { type: 'linear' as const, stroke: 'var(--color-ink)', strokeWidth: 1.75, dot: false, activeDot: { r: 4, fill: 'var(--color-ink)', stroke: 'var(--color-space)', strokeWidth: 2 }, animationDuration: DUR.draw * 1000, animationEasing: 'ease-out' as const },
  bar: { fill: 'var(--color-soft)', radius: [3, 3, 0, 0] as [number, number, number, number], maxBarSize: 28, animationDuration: DUR.draw * 1000, animationEasing: 'ease-out' as const },
  /** A reference range, e.g. the normal band. Always explain it in a caption under the chart. */
  band: (status: Status = 'ok') => ({ fill: STATUS_COLOR[status], fillOpacity: 0.08, stroke: 'none', ifOverflow: 'hidden' as const }),
  /** A threshold or baseline. Pass a status for a limit; omit it for a neutral baseline. */
  refLine: (status?: Status) => ({ stroke: status ? STATUS_COLOR[status] : 'var(--color-edge)', strokeDasharray: '4 4', strokeWidth: 1, ifOverflow: 'extendDomain' as const }),
  tooltip: { cursor: { stroke: 'var(--color-edge)', strokeWidth: 1 }, isAnimationActive: false, wrapperStyle: { outline: 'none' } },
}

type TooltipEntry = { name?: unknown; value?: unknown; dataKey?: unknown; color?: string }

/** Tooltip body for recharts: <Tooltip {...chart.tooltip} content={<ChartTooltip unit="bpm" />} /> */
export function ChartTooltip({ active, payload, label, unit, formatLabel, formatValue }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: unknown; unit?: string; formatLabel?: (label: unknown) => ReactNode; formatValue?: (value: unknown, entry: TooltipEntry) => ReactNode }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-overlay">
      <div className="meta">{formatLabel ? formatLabel(label) : String(label ?? '')}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-baseline justify-between gap-4 text-sm">
          {payload.length > 1 && <span className="text-dim">{String(p.name ?? p.dataKey ?? '')}</span>}
          <span className="font-medium text-ink">
            {formatValue ? formatValue(p.value, p) : String(p.value ?? '—')}
            {unit && <span className="ml-1 font-normal text-dim">{unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ================================================================== */
/* Progressive disclosure                                              */
/* ================================================================== */

const OPEN_KEY = 'aura.open.v1'
let openStore: Record<string, boolean> | null = null
function loadOpenStore(): Record<string, boolean> {
  if (!openStore) {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
      openStore = v && typeof v === 'object' ? v : {}
    } catch {
      openStore = {}
    }
  }
  return openStore!
}
function writeOpen(id: string, open: boolean) {
  const s = loadOpenStore()
  s[id] = open
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(s))
  } catch {
    /* remembered for this page view only */
  }
}

/** Remembers an open/closed choice on this device (localStorage, guarded). `id` = a stable key such as 'coach.equipment'. */
export function useRememberedOpen(id: string | undefined, defaultOpen = false): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => (id ? (loadOpenStore()[id] ?? defaultOpen) : defaultOpen))
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v)
      if (id) writeOpen(id, v)
    },
    [id],
  )
  return [open, setOpen]
}

type GroupSignal = { n: number; open: boolean }
const DisclosureGroupCtx = createContext<{ signal: GroupSignal; report: (key: string, open: boolean | null) => void } | null>(null)
const DisclosureStateCtx = createContext<{ anyClosed: boolean; count: number; setAll: (open: boolean) => void } | null>(null)

/** Wrap a page (or part of one) so an <ExpandAll /> inside it can open or close every Disclosure at once. */
export function DisclosureGroup({ children }: { children: ReactNode }) {
  const [signal, setSignal] = useState<GroupSignal>({ n: 0, open: false })
  const [states, setStates] = useState<Record<string, boolean>>({})
  const report = useCallback((key: string, open: boolean | null) => {
    setStates((s) => {
      if (open === null) {
        if (!(key in s)) return s
        const next = { ...s }
        delete next[key]
        return next
      }
      return s[key] === open ? s : { ...s, [key]: open }
    })
  }, [])
  const group = useMemo(() => ({ signal, report }), [signal, report])
  const values = Object.values(states)
  const anyClosed = values.some((v) => !v)
  const count = values.length
  const state = useMemo(() => ({ anyClosed, count, setAll: (open: boolean) => setSignal((s) => ({ n: s.n + 1, open })) }), [anyClosed, count])
  return (
    <DisclosureGroupCtx.Provider value={group}>
      <DisclosureStateCtx.Provider value={state}>{children}</DisclosureStateCtx.Provider>
    </DisclosureGroupCtx.Provider>
  )
}

/** "Expand all" / "Collapse all" for the surrounding DisclosureGroup. Renders nothing with fewer than `min` sections. */
export function ExpandAll({ min = 3, className }: { min?: number; className?: string }) {
  const s = useContext(DisclosureStateCtx)
  if (!s || s.count < min) return null
  return (
    <Button size="sm" variant="quiet" icon={s.anyClosed ? ChevronsUpDown : ChevronsDownUp} onClick={() => s.setAll(s.anyClosed)} className={className}>
      {s.anyClosed ? 'Expand all' : 'Collapse all'}
    </Button>
  )
}

/**
 * A collapsed-by-default group: heading + hairline like <Section>, opens in place with a short height animation.
 * `id` remembers the person's choice on this device. `summary` is one line shown while it is closed.
 * Never put alerts, emergency steps or safety restrictions inside one.
 */
export function Disclosure({
  title,
  meta,
  summary,
  defaultOpen = false,
  id,
  size = 'section',
  children,
  className,
  onToggle,
}: {
  title: ReactNode
  /** Count or short fact on the header row, e.g. "4 sources". */
  meta?: ReactNode
  /** One line under the title while closed. */
  summary?: ReactNode
  defaultOpen?: boolean
  /** Stable key: remembers open/closed on this device. */
  id?: string
  size?: 'section' | 'row'
  children: ReactNode
  className?: string
  onToggle?: (open: boolean) => void
}) {
  const [open, setOpen] = useRememberedOpen(id, defaultOpen)
  const group = useContext(DisclosureGroupCtx)
  const key = useId()
  const panelId = `${key}-panel`
  const reduce = useReducedMotion()
  const report = group?.report
  useEffect(() => {
    report?.(key, open)
  }, [report, key, open])
  useEffect(() => () => report?.(key, null), [report, key])
  const seen = useRef(group?.signal.n ?? 0)
  const signal = group?.signal
  useEffect(() => {
    if (!signal || signal.n === seen.current) return
    seen.current = signal.n
    if (open !== signal.open) {
      setOpen(signal.open)
      onToggle?.(signal.open)
    }
  }, [signal]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => {
    setOpen(!open)
    onToggle?.(!open)
    sfx(open ? 'close' : 'open')
  }
  const sec = size === 'section'
  const Heading = sec ? 'h2' : 'div'
  return (
    <div className={className} data-open={open}>
      <Heading className="m-0 font-[inherit]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cx(
            'press flex min-h-11 w-full items-center justify-between gap-4 rounded-lg text-left transition-colors',
            sec ? 'border-b border-line pb-3 pt-1 hover:border-edge' : 'py-2 text-sm text-soft hover:text-ink',
          )}
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className={sec ? 'text-heading text-ink' : 'font-medium'}>{title}</span>
              {meta && <span className="text-sm font-normal text-dim">{meta}</span>}
            </span>
            {summary && !open && <span className="mt-0.5 block text-sm font-normal text-dim">{summary}</span>}
          </span>
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-dim transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </Heading>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: { height: { duration: DUR.base, ease: EASE.out }, opacity: { duration: DUR.fast, delay: 0.04 } } }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, transition: { height: { duration: DUR.fast, ease: EASE.in }, opacity: { duration: DUR.instant } } }}
            className="overflow-hidden"
            onAnimationComplete={() => {
              // let focus rings and popovers escape once the panel has settled open
              const el = document.getElementById(panelId)
              if (el && el.style.height !== '0px') el.style.overflow = 'visible'
            }}
          >
            <div className={sec ? 'pt-4' : 'pb-2'}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Long text, shortened: the first line (or `lines`) shows, "Show more" reveals the rest in place.
 * Pass the full text as children; pass `short` for a hand-written short version instead of clamping.
 */
export function ShowMore({ children, short, lines = 1, className, label = 'Show more', id }: { children: ReactNode; short?: ReactNode; lines?: 1 | 2 | 3; className?: string; label?: string; id?: string }) {
  const [open, setOpen] = useRememberedOpen(id, false)
  const clamp = lines === 1 ? 'line-clamp-1' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3'
  const box = useRef<HTMLDivElement>(null)
  // Only offer "Show more" when the clamped text is actually cut off (re-checked when the width changes).
  const [cut, setCut] = useState(Boolean(short))
  useEffect(() => {
    if (short || open) return
    const el = box.current
    if (!el) return
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [short, open, children])
  return (
    <div className={className}>
      <div ref={box} className={cx(!open && !short && clamp)}>{open || !short ? children : short}</div>
      {(cut || open) && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="press link relative mt-1 inline-flex items-center gap-1 text-sm after:absolute after:-inset-3 after:content-['']">
        {open ? 'Show less' : label}
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>}
    </div>
  )
}

/* ================================================================== */
/* Press feedback                                                      */
/* ================================================================== */

/**
 * One delegated listener gives every `.press` element a short highlight that starts where the pointer
 * touched it (opacity only, 200 ms, skipped under reduced motion). The scale-down lives in index.css.
 * `data-sfx="tick|select|confirm"` on an element plays that sound on click (silent unless sounds are on).
 */
function installPress() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const w = window as unknown as { __auraPress?: boolean }
  if (w.__auraPress) return
  w.__auraPress = true
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.press')
      if (!el || reduce?.matches || el.matches(':disabled,[aria-disabled="true"]') || typeof el.animate !== 'function') return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--px', `${Math.round(e.clientX - r.left)}px`)
      el.style.setProperty('--py', `${Math.round(e.clientY - r.top)}px`)
      try {
        el.animate({ opacity: [0.18, 0] }, { duration: 200, easing: 'cubic-bezier(0.2,0.8,0.2,1)', pseudoElement: '::before' })
      } catch {
        /* pseudo-element animation unsupported: the scale-down still gives feedback */
      }
    },
    { passive: true, capture: true },
  )
  document.addEventListener(
    'click',
    (e) => {
      const s = (e.target as Element | null)?.closest?.<HTMLElement>('[data-sfx]')?.dataset.sfx
      if (s === 'tick' || s === 'select' || s === 'confirm') sfx(s)
    },
    { passive: true, capture: true },
  )
}
installPress()

/** A small check that pops in once after something was saved: <Saved show={justSaved} />. Announced to screen readers. */
export function Saved({ show, label = 'Saved', className }: { show: boolean; label?: string; className?: string }) {
  return (
    <span role="status" className={cx('inline-flex min-h-6 items-center', className)}>
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: SPRING.snappy }}
            exit={{ opacity: 0, transition: { duration: DUR.fast } }}
            className="inline-flex items-center gap-1.5 text-sm text-soft"
          >
            <Check className="h-4 w-4 text-ok" aria-hidden="true" />
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** True for `ms` after `trigger()` — drives <Saved> or a Button's `done` state. */
export function useFlash(ms = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(t.current), [])
  const trigger = useCallback(() => {
    window.clearTimeout(t.current)
    setOn(true)
    t.current = window.setTimeout(() => setOn(false), ms)
  }, [ms])
  return [on, trigger]
}

/* ================================================================== */
/* Tabs / segmented control                                            */
/* ================================================================== */

type TabOption<T extends string> = { value: T; label: ReactNode; icon?: LucideIcon; status?: Status; disabled?: boolean }

/**
 * One control for "pick one of a few". `pill` = segmented filter (the thumb slides to the choice),
 * `line` = section tabs with an underline. Scrolls sideways instead of wrapping. Arrow keys move the selection.
 */
export function Tabs<T extends string>({ value, onChange, options, variant = 'pill', label, full = false, className }: { value: T; onChange: (value: T) => void; options: TabOption<T>[]; variant?: 'pill' | 'line'; label: string; full?: boolean; className?: string }) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    for (let n = 1; n <= options.length; n++) {
      const j = (i + step * n + options.length * n) % options.length
      if (!options[j].disabled) {
        onChange(options[j].value)
        refs.current[j]?.focus()
        refs.current[j]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        break
      }
    }
  }
  const pill = variant === 'pill'
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setFade({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [options.length])
  return (
    <div className={cx('relative max-w-full', full ? 'flex' : 'inline-flex', className)}>
    <div ref={scroller} role="tablist" aria-label={label} className={cx('no-scrollbar min-w-0 max-w-full overflow-x-auto', pill ? 'rounded-[10px] border border-line bg-deep p-1' : 'border-b border-line', full ? 'flex w-full' : 'inline-flex', pill ? 'gap-1' : 'gap-6')}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            data-sfx="tick"
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'press relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors disabled:opacity-40',
              pill ? "h-9 rounded-md px-3 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']" : 'h-11',
              full && 'flex-1',
              on ? 'text-ink' : 'text-dim hover:text-ink',
            )}
          >
            {on && (pill ? <motion.span layoutId={`${id}-thumb`} transition={SPRING.snappy} className="absolute inset-0 rounded-md border border-line bg-panel2" /> : <motion.span layoutId={`${id}-thumb`} transition={SPRING.snappy} className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />)}
            <span className="relative inline-flex items-center gap-1.5">
              {o.icon && <o.icon className="h-4 w-4" aria-hidden="true" />}
              {o.label}
              {o.status && o.status !== 'ok' && <StatusIcon status={o.status} size={13} />}
            </span>
          </button>
        )
      })}
    </div>
      {fade.left && <span aria-hidden="true" className={cx("pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r to-transparent", pill ? "from-deep rounded-l-[10px]" : "from-space")} />}
      {fade.right && <span aria-hidden="true" className={cx("pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent", pill ? "from-deep rounded-r-[10px]" : "from-space")} />}
    </div>
  )
}

/* ================================================================== */
/* Overlays: dialog, side sheet, tooltip                               */
/* ================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type OverlayProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Action buttons; primary action last. */
  footer?: ReactNode
}

const overlayVariants: Record<'center' | 'right' | 'bottom', Variants> = {
  center: {
    closed: { opacity: 0, y: 10, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.in } },
    open: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: EASE.out } },
  },
  right: {
    closed: { x: '100%', transition: { duration: DUR.base, ease: EASE.in } },
    open: { x: 0, transition: SPRING.soft },
  },
  bottom: {
    closed: { y: '100%', transition: { duration: DUR.base, ease: EASE.in } },
    open: { y: 0, transition: SPRING.soft },
  },
}

function Overlay({ open, onClose, title, description, children, footer, kind, wide = false }: OverlayProps & { kind: 'dialog' | 'sheet'; wide?: boolean }) {
  const desktop = useMedia('(min-width: 640px)')
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current)?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [open])

  if (typeof document === 'undefined') return null
  const mode = !desktop ? 'bottom' : kind === 'sheet' ? 'right' : 'center'
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" data-overlay initial="closed" animate="open" exit="closed" className={cx('fixed inset-0 z-50 flex', mode === 'bottom' ? 'items-end' : mode === 'right' ? 'justify-end' : 'items-center justify-center p-6')}>
          <motion.div variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }} transition={{ duration: DUR.fast }} className="absolute inset-0 bg-black/65" data-overlay-part="scrim" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={overlayVariants[mode]}
            className={cx(
              'relative flex w-full flex-col bg-panel2 shadow-overlay outline-none',
              mode === 'bottom' && 'max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
              mode === 'right' && 'h-full max-w-md',
              mode === 'center' && cx('max-h-[min(44rem,calc(100dvh-3rem))] rounded-2xl', wide ? 'max-w-2xl' : 'max-w-lg'),
            )}
          >
            <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
              <div className="min-w-0 pt-1.5">
                <h2 id={titleId} className="text-heading text-ink">
                  {title}
                </h2>
                {description && <p className="mt-1 text-sm text-dim">{description}</p>}
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" data-overlay-part="close" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div data-overlay-part="footer" className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:gap-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** A question or short task that blocks the page. Centered on desktop, a bottom sheet on phones. Esc and backdrop close it; focus is trapped and restored. */
export function Dialog(props: OverlayProps & { wide?: boolean }) {
  return <Overlay {...props} kind="dialog" />
}

/** Detail or a longer form beside the page. Slides in from the right on desktop, from the bottom on phones. */
export function Sheet(props: OverlayProps) {
  return <Overlay {...props} kind="sheet" />
}

/** A short hint on hover or keyboard focus. Not for essential information (touch users never see it). */
export function Tooltip({ label, children, side = 'top', align = 'center' }: { label: ReactNode; children: ReactElement<{ 'aria-describedby'?: string }>; side?: 'top' | 'bottom'; align?: 'start' | 'center' | 'end' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 350)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={() => setOpen(true)} onBlur={hide} onKeyDown={(e) => e.key === 'Escape' && hide()}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        data-open={open}
        className={cx(
          'pointer-events-none absolute z-40 w-max max-w-64 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs leading-snug text-soft opacity-0 shadow-overlay transition-opacity data-[open=true]:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0',
        )}
      >
        {label}
      </span>
    </span>
  )
}

/* ================================================================== */
/* Loading, empty, sources                                             */
/* ================================================================== */

/** Placeholder with the size of the content that is loading: <Skeleton className="h-9 w-24" /> */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-skeleton rounded-md bg-line', className)} />
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 text-sm text-dim">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}…
    </div>
  )
}

/** "Nothing here yet" — say why, and offer the one action that fixes it. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5 sm:p-6', className)}>
      {Icon && (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-dim">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div>
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-prose text-sm text-dim">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** A citation: organization first, then the document title. Opens in a new tab. */
export function SourceLink({ href, org, title, className }: { href: string; org: string; title?: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('link inline-flex items-baseline gap-1 text-sm', className)}>
      <span>
        {org}
        {title && <span> — {title}</span>}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}
