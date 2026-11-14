// Mounted once in the AppShell header. Renders the voice button and, through a portal, the voice HUD.
// Understanding is deterministic (src/lib/voice); speech in/out is the browser's Web Speech API.
import { AudioLines, LoaderCircle, Mic, Send, SlidersHorizontal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { sfxEnabled, setSfxEnabled } from '../../lib/sfx'
import { EXAMPLES, EXAMPLES_TR } from '../../lib/voice/intents'
import { ERROR_TEXT } from '../../lib/voice/recognition'
import { Checkbox, IconButton, Input, SPRING, Select, Tabs, cx } from '../ui'
import ListenRing from './ListenRing'
import { useVoiceAgent, type Phase } from './useVoiceAgent'
import VoiceOrb from './VoiceOrb'
import './voice.css'

const PHASE_LABEL: Record<Phase, string> = { idle: 'Standing by', listening: 'Listening', thinking: 'Working', speaking: 'Speaking' }

export default function AuraVoice({ crewId }: { crewId: number | null }) {
  const v = useVoiceAgent(crewId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sound, setSound] = useState(sfxEnabled)
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    // an emergency reply is shown alone and read from its first line; everything else follows the newest line
    if (el) el.scrollTop = v.urgent ? 0 : el.scrollHeight
  }, [v.captions, v.interim, v.urgent])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    v.submit(t)
  }

  const Icon = v.phase === 'thinking' ? LoaderCircle : v.phase === 'speaking' ? AudioLines : Mic
  const examples = v.settings.lang === 'tr-TR' ? EXAMPLES_TR : EXAMPLES
  const err = !v.recOk ? ERROR_TEXT.unsupported : v.error ? ERROR_TEXT[v.error] : null
  const emergency = v.urgent

  // settings never hide an emergency reply, and start closed every time the HUD opens
  useEffect(() => {
    if (emergency || !v.open) setSettingsOpen(false)
  }, [emergency, v.open])

  return (
    <>
      <IconButton
        icon={Icon}
        label={v.open ? 'Close AURA voice (Alt+V)' : 'Talk to AURA (Alt+V)'}
        aria-pressed={v.open}
        data-phase={v.phase}
        onClick={v.toggle}
        className={cx('vx-btn relative', v.open && 'text-accent', v.phase === 'thinking' && '[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none')}
      />
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {v.open && (
              <>
                <motion.div key="edge" className="vx-edge" data-urgent={emergency} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true" />
                <motion.section
                  key="hud"
                  role="region"
                  aria-label="AURA voice"
                  className="vx-hud"
                  data-urgent={emergency}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={SPRING.soft}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                    <p className="vx-mono flex items-center gap-2 text-dim">
                      <span className="text-accent">AURA</span>
                      <span aria-hidden="true">/</span>
                      <span role="status" className={v.phase === 'listening' ? 'text-accent' : undefined}>
                        {PHASE_LABEL[v.phase]}
                      </span>
                    </p>
                    <div className="flex items-center gap-1">
                      <IconButton size="sm" icon={SlidersHorizontal} label="Voice settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)} />
                      <IconButton size="sm" icon={X} label="Close voice" onClick={() => v.setOpen(false)} />
                    </div>
                  </div>

                  {settingsOpen && (
                    <div className="space-y-3 px-4 py-4" role="group" aria-label="Voice settings">
                      <Checkbox label="Speak replies aloud" checked={v.settings.speak} onChange={(e) => v.update({ speak: e.target.checked })} />
                      <Checkbox label="Wake word: say “AURA” or “hey AURA” (keeps the microphone open)" checked={v.settings.wake} disabled={!v.recOk} onChange={(e) => v.update({ wake: e.target.checked })} />
                      <Checkbox
                        label="Interface sounds"
                        checked={sound}
                        onChange={(e) => {
                          setSfxEnabled(e.target.checked)
                          setSound(e.target.checked)
                        }}
                      />
                      <Checkbox label="Read the AURA consultation aloud" checked={v.settings.readConsult} onChange={(e) => v.update({ readConsult: e.target.checked })} />
                      <div>
                        <p className="mb-1.5 text-sm text-dim">I understand</p>
                        <Tabs label="Recognition language" value={v.settings.lang} onChange={(lang) => v.update({ lang })} options={[{ value: 'en-US', label: 'English' }, { value: 'tr-TR', label: 'Türkçe' }]} />
                        <p className="mt-1.5 text-xs text-dim">Replies are always in English.</p>
                      </div>
                      <div>
                        <p className="mb-1.5 text-sm text-dim">Listening time</p>
                        <Tabs
                          label="Listening time"
                          value={v.settings.listen}
                          onChange={(listen) => v.update({ listen })}
                          options={[
                            { value: 'short', label: 'Short' },
                            { value: 'normal', label: 'Normal' },
                            { value: 'long', label: 'Long' },
                          ]}
                        />
                        <p className="mt-1.5 text-xs text-dim">How long a pause ends what you say. Choose Long if AURA stops while you are still talking.</p>
                      </div>
                      <div>
                        <label htmlFor="vx-voice" className="mb-1.5 block text-sm text-dim">
                          Voice
                        </label>
                        <div className="flex items-center gap-2">
                          <Select
                            id="vx-voice"
                            className="min-w-0 flex-1"
                            value={v.settings.voice ?? ''}
                            disabled={!v.ttsOk || !v.voices.length}
                            onChange={(e) => {
                              const voice = e.target.value || null
                              v.update({ voice })
                              v.previewVoice(voice)
                            }}
                          >
                            <option value="">Automatic (most natural available)</option>
                            {v.voices.map((x) => (
                              <option key={x.uri} value={x.uri}>
                                {x.name.replace(/^Microsoft /, '').replace(/ - English.*$/, '')} · {x.lang}
                                {x.natural ? ' · natural' : ''}
                              </option>
                            ))}
                          </Select>
                          <button type="button" className="min-h-9 shrink-0 text-sm text-accent underline-offset-2 hover:underline disabled:opacity-50" onClick={() => v.previewVoice(v.settings.voice)} disabled={!v.ttsOk}>
                            Preview
                          </button>
                        </div>
                        <p className="mt-1.5 text-xs text-dim">Natural voices (Edge “Online (Natural)”, Google, Apple enhanced) sound most human. Edge streams its natural voices from Microsoft.</p>
                      </div>
                      <div>
                        <label htmlFor="vx-rate" className="mb-1.5 block text-sm text-dim">
                          Speech speed {v.settings.rate.toFixed(1)}×
                        </label>
                        <input id="vx-rate" type="range" min={0.7} max={1.3} step={0.1} value={v.settings.rate} onChange={(e) => v.update({ rate: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" />
                      </div>
                      <div className="space-y-1.5 border-t border-line pt-3 text-xs leading-relaxed text-dim">
                        <p>
                          <span className="font-medium text-soft">Privacy.</span> Spoken replies are generated on this device. Speech recognition is provided by your browser: in Chrome and Edge the audio is sent to the browser vendor’s service while you speak, so it needs internet. Without it, or in Firefox (no recognition), voice input is unavailable and typing still works. The microphone is open only while AURA is listening; with the wake word on, it stays open until you turn that off. AURA never records or stores audio.
                        </p>
                        <p>
                          <span className="font-medium text-soft">Keys.</span> Alt+V opens or closes voice. With it open, tap Space to talk until you pause, or hold Space and release when you are done (when you are not typing). Press Space again, or “Done”, to finish early. Esc closes.
                        </p>
                      </div>
                      <button type="button" className="min-h-9 text-sm font-medium text-accent underline-offset-2 hover:underline" onClick={() => setSettingsOpen(false)}>
                        Back to the conversation
                      </button>
                    </div>
                  )}

                  {!settingsOpen && (
                    <>

                  <div className="flex items-start gap-4 px-4 pt-4">
                    <VoiceOrb phase={v.phase} urgent={emergency} />
                    <div className="min-w-0 flex-1">
                      <div ref={logRef} className="vx-log space-y-2" role="log" aria-label="Conversation with AURA" aria-live="polite">
                        {v.captions.length === 0 && !v.interim && <p className="text-sm leading-relaxed text-dim">Ask for a status report, a reading, a body system, or describe a symptom. You can type below.</p>}
                        {v.captions.slice(emergency ? -1 : -4).map((c) =>
                          c.who === 'you' ? (
                            <p key={c.id} className="text-sm leading-relaxed text-dim">
                              <span className="sr-only">You: </span>
                              <span aria-hidden="true">› </span>
                              {c.text}
                            </p>
                          ) : (
                            <p key={c.id} role={c.urgent ? 'alert' : undefined} className={cx('text-[15px] leading-relaxed', c.urgent ? 'font-medium text-ink' : 'text-ink')}>
                              <span className="sr-only">AURA: </span>
                              {c.text}
                            </p>
                          ),
                        )}
                        {v.interim && (
                          <p className="text-sm leading-relaxed text-accent">
                            {v.interim}
                            <span className="vx-cursor" aria-hidden="true" />
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {v.phase === 'listening' && (
                    <div className="flex items-center justify-between gap-2 px-4 pt-3">
                      <p className="vx-mono text-xs text-dim" aria-live="off">
                        {v.window?.mode === 'hold' ? 'Release to send' : v.window?.heard ? 'Pause to finish' : 'Listening…'}
                      </p>
                      {v.window?.mode !== 'hold' && (
                        <button type="button" onClick={v.finishListening} className="min-h-8 rounded-full border border-accent/60 px-3 text-sm text-accent transition-colors hover:bg-accent/10">
                          Done, tap to finish
                        </button>
                      )}
                    </div>
                  )}

                  {err && (
                    <p role="status" className="mx-4 mt-3 rounded-lg border border-warn/50 px-3 py-2 text-sm leading-snug text-soft">
                      {err}
                    </p>
                  )}
                  {!err && v.notice && (
                    <p role="status" className="mx-4 mt-3 rounded-lg border border-accent/50 px-3 py-2 text-sm leading-snug text-soft">
                      {v.notice}
                    </p>
                  )}

                  <form onSubmit={submit} className="flex items-center gap-2 px-4 pt-3">
                    <span className="relative shrink-0">
                      <IconButton
                        variant="secondary"
                        icon={Mic}
                        label={v.phase === 'listening' ? 'Finish speaking' : 'Listen (tap, or hold to talk)'}
                        aria-pressed={v.phase === 'listening'}
                        disabled={!v.recOk}
                        className={cx('shrink-0', v.phase === 'listening' && 'border-accent text-accent')}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          v.pressStart()
                        }}
                        onPointerUp={() => v.pressEnd()}
                        onPointerCancel={() => v.pressEnd()}
                        onClick={(e) => {
                          // keyboard activation (Enter / Space on the focused button): tap behaviour
                          if (e.detail === 0) (v.phase === 'listening' ? v.finishListening() : v.startPtt())
                        }}
                      />
                      {v.phase === 'listening' && v.window && <ListenRing win={v.window} />}
                    </span>
                    <label htmlFor="vx-type" className="sr-only">
                      Type a command for AURA
                    </label>
                    <Input id="vx-type" className="min-h-11 flex-1" placeholder={v.settings.lang === 'tr-TR' ? 'Bir komut yazın' : 'Type a command'} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
                    <IconButton variant="secondary" type="submit" icon={Send} label="Send" disabled={!text.trim()} className="shrink-0" />
                  </form>

                  {!emergency && (
                    <>
                  <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="group" aria-label="Example phrases">
                    {examples.slice(0, 4).map((x) => (
                      <button key={x} type="button" onClick={() => v.submit(x)} className="min-h-8 rounded-full border border-line px-3 text-sm text-soft transition-colors hover:border-accent hover:text-ink">
                        {x}
                      </button>
                    ))}
                  </div>

                  <p className="px-4 pb-3 pt-3 text-xs leading-snug text-dim">
                    Replies are spoken on your device. Your browser’s speech service hears you while listening.{' '}
                    <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setSettingsOpen(true)}>
                      Privacy details
                    </button>
                  </p>
                    </>
                  )}
                  {emergency && <div className="h-3" />}
                    </>
                  )}
                </motion.section>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
