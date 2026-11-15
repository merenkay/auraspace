// Full-screen cards of the guided tour: chapter titles, the opening problem, the sourced facts for the other
// two contexts, the principles and the closing card. Every number on a card is read from the app's own
// knowledge base (src/data/kb, src/data/contexts-kb.json) and shown with its source.
import { FileLock2, Library, ListChecks, Play, WifiOff, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { CONTEXTS, contextFacts } from '../../data/contexts'
import { ENV_VALUES } from '../../data/kb'
import { MISSIONS, formatDelay } from '../../data/missions'
import { CLOSING, SCRIPT } from '../../lib/demo/script'
import type { Card } from '../../lib/demo/types'
import { Button, CONTEXT_ICON, DUR, EASE, Logo, SourceLink } from '../ui'

const TOTAL_CHAPTERS = SCRIPT.chapters.length

function Rise({ children, delay = 0, reduced }: { children: ReactNode; delay?: number; reduced: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : DUR.slow, ease: EASE.out, delay: reduced ? 0 : delay }}>
      {children}
    </motion.div>
  )
}

function Quote({ text, org, url }: { text: string; org: string; url: string }) {
  return (
    <blockquote className="border-l-2 border-edge pl-4">
      <p className="text-[15px] italic leading-relaxed text-soft">“{text}”</p>
      <div className="mt-1.5">
        <SourceLink href={url} org={org} />
      </div>
    </blockquote>
  )
}

function ChapterCard({ card, reduced }: { card: Extract<Card, { kind: 'chapter' }>; reduced: boolean }) {
  return (
    <div className="max-w-3xl">
      <Rise reduced={reduced}>
        <p className="font-mono text-sm text-dim">
          Chapter {card.number} of {TOTAL_CHAPTERS}
        </p>
      </Rise>
      <Rise reduced={reduced} delay={0.06}>
        <h2 className="mt-4 text-[2.125rem] font-semibold leading-[1.08] tracking-[-0.025em] text-ink sm:text-display">{card.title}</h2>
      </Rise>
    </div>
  )
}

/** The problem in one picture: a question travels to Earth, the answer travels back. Each leg plays once. */
function DelayCard({ reduced }: { reduced: boolean }) {
  const mars = ENV_VALUES.find((e) => e.id === 'comms-delay-earth-mars')
  const mission = MISSIONS.find((m) => m.id === 'mars-transit')
  const leg = 2.6
  return (
    <div className="w-full max-w-3xl">
      <Rise reduced={reduced}>
        <p className="text-sm text-dim">One-way signal delay between Mars and Earth</p>
        <p className="mt-2 flex items-baseline gap-3">
          <span className="text-[4rem] font-medium leading-none tracking-[-0.03em] text-ink sm:text-[5.5rem]">{mars?.value != null && mars.valueMax != null ? `${mars.value}–${mars.valueMax}` : '3–22'}</span>
          <span className="text-xl text-dim">minutes</span>
        </p>
      </Rise>

      <Rise reduced={reduced} delay={0.12}>
        <div className="mt-10" aria-hidden="true">
          <div className="relative h-10">
            <div className="absolute inset-x-2 top-1/2 h-px bg-line" />
            <span className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-edge bg-panel2" />
            <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-edge bg-panel2" />
            {!reduced && (
              <>
                <motion.span
                  className="absolute top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full bg-accent"
                  initial={{ left: '100%', opacity: 0 }}
                  animate={{ left: ['100%', '100%', '0%', '0%'], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: leg, times: [0, 0.05, 0.92, 1], ease: 'linear', delay: 0.7 }}
                />
                <motion.span
                  className="absolute top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full bg-ink"
                  initial={{ left: '0%', opacity: 0 }}
                  animate={{ left: ['0%', '0%', '100%', '100%'], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: leg, times: [0, 0.05, 0.92, 1], ease: 'linear', delay: 0.9 + leg }}
                />
              </>
            )}
          </div>
          <div className="mt-1 flex justify-between text-sm text-dim">
            <span>Earth · flight surgeon</span>
            <span>Mars transit · crew</span>
          </div>
        </div>
      </Rise>

      <Rise reduced={reduced} delay={0.2}>
        <p className="mt-8 max-w-2xl text-[17px] leading-relaxed text-soft">
          “Doctor, I have chest pain.” The question takes minutes to arrive, and the answer takes as long to come back.
          {mission && <> The mission in this tour uses {formatDelay(mission.delaySec)} each way.</>}
        </p>
        {mars && (
          <div className="mt-6 max-w-2xl">
            <Quote text={mars.quote} org={mars.source.organization} url={mars.source.url} />
          </div>
        )}
      </Rise>
    </div>
  )
}

function Points({ items, reduced }: { items: { icon: LucideIcon; title: string; text: string }[]; reduced: boolean }) {
  return (
    <ul className="mt-8 divide-y divide-line border-y border-line">
      {items.map((it, i) => (
        <li key={it.title}>
          <Rise reduced={reduced} delay={0.1 + i * 0.08}>
            <div className="flex items-start gap-4 py-4">
              <it.icon className="mt-0.5 h-5 w-5 shrink-0 text-dim" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[17px] font-semibold leading-snug text-ink">{it.title}</p>
                <p className="mt-0.5 text-[15px] leading-relaxed text-soft">{it.text}</p>
              </div>
            </div>
          </Rise>
        </li>
      ))}
    </ul>
  )
}

function PromiseCard({ reduced }: { reduced: boolean }) {
  return (
    <div className="w-full max-w-2xl">
      <Rise reduced={reduced}>
        <h2 className="text-title text-ink sm:text-[2.125rem] sm:leading-[1.1]">
          The first response has to work <span className="text-dim">without Earth.</span>
        </h2>
      </Rise>
      <Points
        reduced={reduced}
        items={[
          { icon: WifiOff, title: 'Works offline', text: 'The rules and the knowledge base run on the device.' },
          { icon: ListChecks, title: 'Fixed rules', text: 'The same readings always give the same answer.' },
          { icon: Library, title: 'Published sources', text: 'NASA, NHS, CDC, WHO and ESA pages, shown next to what they support.' },
        ]}
      />
    </div>
  )
}

function ContextCard({ context, reduced }: { context: 'polar' | 'home'; reduced: boolean }) {
  const Icon = CONTEXT_ICON[context]
  const fact = contextFacts(context).facts.find((f) => f.quote.includes(context === 'polar' ? 'nine months' : '44%'))
  const head = context === 'polar' ? { value: '≈ 9', unit: 'months a year', text: 'Crews at Concordia station in Antarctica are completely isolated from the outside world.' } : { value: '44', unit: '%', text: 'of adults with high blood pressure do not know they have it.' }
  return (
    <div className="w-full max-w-2xl" data-accent={context}>
      <Rise reduced={reduced}>
        <p className="flex items-center gap-2 text-sm text-dim">
          <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
          {CONTEXTS[context].label}
        </p>
        <p className="mt-3 flex items-baseline gap-3">
          <span className="text-[4rem] font-medium leading-none tracking-[-0.03em] text-ink sm:text-[5.5rem]">{head.value}</span>
          <span className="text-xl text-dim">{head.unit}</span>
        </p>
        <p className="mt-4 text-[17px] leading-relaxed text-soft">{head.text}</p>
      </Rise>
      {fact && (
        <Rise reduced={reduced} delay={0.12}>
          <div className="mt-6">
            <Quote text={fact.quote} org={fact.source.org} url={fact.source.url} />
          </div>
        </Rise>
      )}
    </div>
  )
}

function PrinciplesCard({ reduced }: { reduced: boolean }) {
  return (
    <div className="w-full max-w-2xl">
      <Rise reduced={reduced}>
        <h2 className="text-title text-ink sm:text-[2.125rem] sm:leading-[1.1]">How AURA is built</h2>
      </Rise>
      <Points
        reduced={reduced}
        items={[
          { icon: ListChecks, title: 'Deterministic rules, no AI', text: 'Every alert, score and plan comes from fixed thresholds. No AI model decides anything medical.' },
          { icon: Library, title: 'A sourced knowledge base', text: 'Each statement links to the page it comes from, with the sentence that supports it.' },
          { icon: WifiOff, title: 'Works without a signal', text: 'The health rules run on the device: in transit, at a polar station, in a home without internet. Live space weather and speech recognition need a connection.' },
          { icon: FileLock2, title: 'Data stays with the person', text: 'People see only their own record. Mission control never sees mood. A home report is never sent automatically.' },
        ]}
      />
    </div>
  )
}

function ClosingCard({ reduced, onTry, onAgain }: { reduced: boolean; onTry: () => void; onAgain: () => void }) {
  return (
    <div className="w-full max-w-2xl">
      <Rise reduced={reduced}>
        <Logo size={44} />
        <h2 className="mt-6 text-[2.125rem] font-semibold leading-[1.08] tracking-[-0.025em] text-ink sm:text-display">{CLOSING.project}</h2>
        <p className="mt-4 text-[19px] leading-relaxed text-soft">{CLOSING.tagline}</p>
      </Rise>
      <Rise reduced={reduced} delay={0.12}>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" size="lg" onClick={onTry}>
            Try it yourself
          </Button>
          <Button size="lg" icon={Play} onClick={onAgain}>
            Watch again
          </Button>
        </div>
        <p className="mt-8 border-t border-line pt-4 text-sm leading-relaxed text-dim">
          {CLOSING.team ? `${CLOSING.team} · ` : ''}
          {CLOSING.event}. Not affiliated with NASA. Every reading in this tour was simulated; AURA is decision support, not a diagnosis.
        </p>
      </Rise>
    </div>
  )
}

/** One card, filling the screen above the app. `bottomInset` keeps the content clear of the caption bar. */
export default function TourCard({ card, stepId, bottomInset, reduced, onTry, onAgain }: { card: Card; stepId: string; bottomInset: number; reduced: boolean; onTry: () => void; onAgain: () => void }) {
  return (
    <motion.div
      key="card"
      className="pointer-events-auto fixed inset-0 overflow-y-auto bg-space"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : DUR.base, ease: EASE.out }}
    >
      <div key={stepId} className="mx-auto flex min-h-full w-full max-w-5xl items-center px-6 pt-10 sm:px-10" style={{ paddingBottom: bottomInset + 24 }}>
        {card.kind === 'chapter' && <ChapterCard card={card} reduced={reduced} />}
        {card.kind === 'delay' && <DelayCard reduced={reduced} />}
        {card.kind === 'promise' && <PromiseCard reduced={reduced} />}
        {card.kind === 'context' && <ContextCard context={card.context} reduced={reduced} />}
        {card.kind === 'principles' && <PrinciplesCard reduced={reduced} />}
        {card.kind === 'closing' && <ClosingCard reduced={reduced} onTry={onTry} onAgain={onAgain} />}
      </div>
    </motion.div>
  )
}
