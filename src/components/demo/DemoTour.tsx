// The guided tour's interface: it owns the engine, connects it to the live app through the browser driver and
// draws the cards, the spotlight and the caption bar above everything else. Loaded only inside the sandboxed
// tour page (see DemoHost.tsx and src/lib/demo/sandbox.ts).
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { createDriver, type DriverEnv } from '../../lib/demo/driver'
import { UI_ATTR } from '../../lib/demo/dom'
import { TourEngine } from '../../lib/demo/engine'
import { demoSandbox, exitDemo, rememberChapter, restartDemo } from '../../lib/demo/sandbox'
import { SCRIPT } from '../../lib/demo/script'
import { PERSONAS } from '../../lib/demo/seed'
import { prefetchRoute } from '../../lib/prefetch'
import { useSession } from '../../lib/session'
import { setSfxEnabled, sfxEnabled } from '../../lib/sfx'
import { cancelSpeech } from '../../lib/voice/speech'
import { DUR, MotionRoot, useMedia } from '../ui'
import CaptionBar from './CaptionBar'
import TourCard from './Cards'
import Spotlight from './Spotlight'

type Mark = { id: number; x: number; y: number }

const ESC_WINDOW_MS = 3000

export default function DemoTour() {
  const navigate = useNavigate()
  const { user, backend, demoLogin, signedIn } = useSession()
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [sound, setSound] = useState(() => sfxEnabled())
  const [presenter, setPresenter] = useState(false)
  const [marks, setMarks] = useState<Mark[]>([])
  const [inset, setInset] = useState(150)
  const [notice, setNotice] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const markId = useRef(0)

  const pointer = useCallback((x: number, y: number) => {
    const id = ++markId.current
    setMarks((m) => [...m, { id, x, y }])
    setTimeout(() => setMarks((m) => m.filter((k) => k.id !== id)), 700)
  }, [])

  // The driver reads the latest session and settings through this ref on every use.
  const env = useRef<DriverEnv>(null as unknown as DriverEnv)
  env.current = { navigate, user, backend, demoLogin, signedIn, sound, reducedMotion: reduced, bottomInset: inset, pointer }

  const engine = useMemo(
    () =>
      new TourEngine(
        SCRIPT,
        createDriver(() => env.current),
        { onError: (e, where) => console.warn(`[demo] ${where}:`, e) },
      ),
    [],
  )
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  // Start (or resume after a reload) once, and stop when the tour is taken down.
  useEffect(() => {
    const box = demoSandbox()
    if (box) box.tour = engine
    engine.start(box?.chapter ?? 0)
    return () => engine.stop()
  }, [engine])

  // Fetch the code of every page the tour visits while the opening cards play.
  useEffect(() => {
    const routes = new Set(SCRIPT.chapters.flatMap((c) => [c.scene, ...c.steps.map((s) => s.scene ?? c.scene)]).map((s) => s.route.replace(':id', String(PERSONAS[s.persona].crewId))))
    routes.forEach((r) => prefetchRoute(r))
  }, [])

  useEffect(() => {
    if (snap.status !== 'idle') rememberChapter(snap.chapter)
  }, [snap.chapter, snap.status])

  // The caption bar's height: targets and cards keep clear of it.
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setInset(Math.round(window.innerHeight - el.getBoundingClientRect().top))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Keep the page clear of the bar too: it can always be scrolled far enough, and anything the app scrolls
  // into view itself (a new message, a result) stops above the bar instead of underneath it.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const before = { pad: html.style.scrollPaddingBottom, body: body.style.paddingBottom }
    html.style.scrollPaddingBottom = `${inset + 12}px`
    html.style.setProperty('--demo-inset', `${inset}px`)
    body.style.paddingBottom = `${inset}px`
    return () => {
      html.style.scrollPaddingBottom = before.pad
      html.style.removeProperty('--demo-inset')
      body.style.paddingBottom = before.body
    }
  }, [inset])

  const changeSound = useCallback((on: boolean) => {
    setSound(on)
    setSfxEnabled(on) // inside the sandbox this is remembered in memory only
    if (!on) cancelSpeech()
  }, [])

  const leave = useCallback(() => {
    engine.stop()
    cancelSpeech()
    exitDemo()
  }, [engine])

  const again = useCallback(() => {
    engine.stop()
    cancelSpeech()
    restartDemo()
  }, [engine])

  // Esc asks once before leaving, so a stray key press does not end the presentation.
  const escAt = useRef(0)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), ESC_WINDOW_MS)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.altKey || e.ctrlKey || e.metaKey) return
      const t = e.target instanceof HTMLElement ? e.target : null
      const inTour = !!t?.closest(`[${UI_ATTR}]`)
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      const status = engine.getSnapshot().status
      // While paused the person may use the app underneath: typing and its own buttons keep their keys.
      if (typing && status !== 'playing') return
      let handled = true
      if (e.key === ' ' || e.key === 'k') {
        if (inTour && t?.tagName === 'BUTTON' && e.key === ' ') return
        engine.toggle()
      } else if (e.key === 'ArrowRight') engine.next()
      else if (e.key === 'ArrowLeft') engine.back()
      else if (e.key === 'Escape') {
        if (Date.now() - escAt.current < ESC_WINDOW_MS) return leave()
        escAt.current = Date.now()
        engine.pause()
        setNotice('Paused. Press Esc again to leave the demo, or Space to continue.')
      } else if (e.key === 'p') setPresenter((p) => !p)
      else if (e.key === 'm') changeSound(!env.current.sound)
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= engine.chapters.length) engine.seekChapter(Number(e.key) - 1)
      else handled = false
      if (!handled) return
      if (e.key !== 'Escape') {
        escAt.current = 0
        setNotice(null)
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [engine, leave, changeSound])

  const cardUp = snap.card !== null
  return (
    <MotionRoot>
      {/* On phones some pages pin a bar to the bottom edge (the message box, "Log this session"): lift those above the caption bar. */}
      <style>{'@media (max-width: 767px) { #main .sticky[class*="bottom-"] { bottom: calc(var(--demo-inset, 0px) + 4px) !important; } }'}</style>
      <div {...{ [UI_ATTR]: '' }} data-demo-step={snap.stepId ?? ''} data-demo-status={snap.status} data-demo-phase={snap.phase} className="pointer-events-none fixed inset-0 z-[80]">
        {/* Until the first step is on screen the app behind stays covered. */}
        {snap.stepId === null || (snap.phase === 'preparing' && snap.caption === '') ? <div className="fixed inset-0 bg-space" /> : null}

        {!cardUp && <Spotlight highlight={snap.highlight} bottomInset={inset} reduced={reduced} />}

        <AnimatePresence>{snap.card && <TourCard card={snap.card} stepId={snap.stepId ?? ''} bottomInset={inset} reduced={reduced} onTry={leave} onAgain={again} />}</AnimatePresence>

        {/* where the tour just clicked */}
        {marks.map((m) => (
          <motion.span
            key={m.id}
            aria-hidden="true"
            className="pointer-events-none fixed -ml-4 -mt-4 h-8 w-8 rounded-full border-2 border-ink"
            style={{ left: m.x, top: m.y }}
            initial={{ opacity: 0.9, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.5 }}
            transition={{ duration: reduced ? 0.01 : DUR.slow * 1.4, ease: 'easeOut' }}
          />
        ))}

        <CaptionBar
          ref={barRef}
          snap={snap}
          chapters={engine.chapters}
          presenter={presenter}
          sound={sound}
          notice={notice}
          onToggle={() => engine.toggle()}
          onBack={() => engine.back()}
          onNext={() => engine.next()}
          onSeek={(c) => engine.seekChapter(c)}
          onSpeed={(s) => engine.setSpeed(s)}
          onSound={changeSound}
          onPresenter={setPresenter}
          onRestart={again}
          onExit={leave}
        />
      </div>
    </MotionRoot>
  )
}
