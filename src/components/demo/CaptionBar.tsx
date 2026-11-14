// The tour's caption bar: the narration (always visible), where we are, and the transport controls.
// It also carries the permanent "Demo · simulated data" label. In presenter mode the controls fold away
// until the bar is hovered, focused or tapped, and a running timer is shown instead.
import { ChevronLeft, ChevronRight, LogOut, MonitorPlay, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { SPEEDS } from '../../lib/demo/engine'
import type { ChapterInfo, Snapshot } from '../../lib/demo/types'
import { Badge, IconButton, cx } from '../ui'

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type CaptionBarProps = {
  snap: Snapshot
  chapters: ChapterInfo[]
  presenter: boolean
  sound: boolean
  /** Text shown instead of the caption for a moment (e.g. "Press Esc again to leave"). */
  notice: string | null
  onToggle: () => void
  onBack: () => void
  onNext: () => void
  onSeek: (chapter: number) => void
  onSpeed: (speed: number) => void
  onSound: (on: boolean) => void
  onPresenter: (on: boolean) => void
  onRestart: () => void
  onExit: () => void
}

const CaptionBar = forwardRef<HTMLDivElement, CaptionBarProps>(function CaptionBar({ snap, chapters, presenter, sound, notice, onToggle, onBack, onNext, onSeek, onSpeed, onSound, onPresenter, onRestart, onExit }, ref) {
  // Touch screens have no hover: a tap on the caption shows the controls for a few seconds.
  const [peek, setPeek] = useState(false)
  useEffect(() => {
    if (!peek) return
    const t = setTimeout(() => setPeek(false), 5000)
    return () => clearTimeout(t)
  }, [peek])

  const playing = snap.status === 'playing'
  const chapter = chapters[snap.chapter]
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(snap.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]
  const folded = presenter && !peek
  const state = snap.status === 'finished' ? 'End of the tour' : snap.status === 'paused' ? 'Paused' : null

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Guided demo"
      className="group pointer-events-auto fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] mx-auto max-w-3xl rounded-2xl border border-line bg-panel2 shadow-overlay sm:inset-x-4 sm:bottom-4"
    >
      {/* where we are */}
      <div className="flex items-center gap-x-3 gap-y-1 px-4 pt-3">
        <Badge className="border-edge text-soft">Demo · simulated data</Badge>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-dim">
          {chapter ? (
            <>
              {snap.chapter + 1}/{chapters.length} · {chapter.title}
            </>
          ) : null}
          {state && <span className="text-soft"> · {state}</span>}
        </p>
        <p className="shrink-0 font-mono text-xs text-dim" aria-label={presenter ? 'Time since the tour started' : 'Position in the tour'}>
          {presenter ? clock(snap.playedMs) : `${clock(snap.positionMs)} / ${clock(snap.totalMs)}`}
        </p>
      </div>

      {/* narration */}
      <p aria-live="polite" onClick={() => presenter && setPeek(true)} className="min-h-[3.25rem] px-4 pb-3 pt-2 text-[17px] leading-snug text-ink sm:min-h-[3.5rem] sm:text-lg sm:leading-snug">
        {notice ?? snap.caption}
      </p>

      {/* progress and controls */}
      <div className={cx('grid transition-[grid-template-rows,opacity] duration-200', folded ? 'grid-rows-[0fr] opacity-0 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100 group-hover:grid-rows-[1fr] group-hover:opacity-100' : 'grid-rows-[1fr]')}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex gap-1 px-4" role="group" aria-label="Chapters">
            {chapters.map((c) => {
              const span = Math.max(1, c.endMs - c.startMs)
              const done = Math.min(1, Math.max(0, (snap.positionMs - c.startMs) / span))
              const current = c.index === snap.chapter
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSeek(c.index)}
                  title={`${c.index + 1}. ${c.title}`}
                  aria-label={`Go to chapter ${c.index + 1}: ${c.title}`}
                  aria-current={current ? 'step' : undefined}
                  style={{ flexGrow: span }}
                  className="relative h-6 min-w-3 basis-0 after:absolute after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2 after:rounded-full after:bg-line hover:after:bg-edge"
                >
                  <span className="absolute left-0 top-1/2 z-10 h-1 -translate-y-1/2 rounded-full bg-ink" style={{ width: `${(c.index < snap.chapter ? 1 : c.index > snap.chapter ? 0 : done) * 100}%` }} />
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1 px-2 pb-2">
            <IconButton size="sm" icon={ChevronLeft} label="Back (Left arrow)" onClick={onBack} />
            <IconButton size="sm" variant="secondary" icon={playing ? Pause : Play} label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onToggle} />
            <IconButton size="sm" icon={ChevronRight} label="Next (Right arrow)" onClick={onNext} />
            <button
              type="button"
              onClick={() => onSpeed(nextSpeed)}
              title="Playback speed"
              aria-label={`Playback speed ${snap.speed}×. Change to ${nextSpeed}×`}
              className="press ml-1 h-9 min-w-11 rounded-lg px-2 font-mono text-xs text-soft transition-colors hover:bg-panel hover:text-ink"
            >
              {snap.speed}×
            </button>
            <span className="flex-1" />
            <IconButton size="sm" icon={sound ? Volume2 : VolumeX} label={sound ? 'Sound and spoken narration: on' : 'Sound and spoken narration: off'} aria-pressed={sound} onClick={() => onSound(!sound)} className={sound ? 'text-ink' : undefined} />
            <IconButton size="sm" icon={MonitorPlay} label={presenter ? 'Presenter mode: on (controls hide, timer shown)' : 'Presenter mode: off'} aria-pressed={presenter} onClick={() => onPresenter(!presenter)} className={presenter ? 'text-ink' : undefined} />
            <IconButton size="sm" icon={RotateCcw} label="Start again" onClick={onRestart} />
            <IconButton size="sm" icon={LogOut} label="Leave the demo (Esc)" onClick={onExit} />
          </div>
        </div>
      </div>
    </div>
  )
})

export default CaptionBar
