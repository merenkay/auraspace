// Development only (window.__auraVoice.simMic): a stand-in for the browser's SpeechRecognition, so the real listener,
// wake-word and agent code can be driven without a microphone. `devMicSay` makes the newest running session "hear"
// words, as interim (final = false) or final results.
import type { Rec } from './recognition'

type R = { text: string; final: boolean }

export class DevRec implements Rec {
  static all: DevRec[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  grammars?: unknown
  phrases?: unknown
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onresult: Rec['onresult'] = null
  running = false
  results: R[] = []
  constructor() {
    DevRec.all.push(this)
    if (DevRec.all.length > 50) DevRec.all.splice(0, DevRec.all.length - 50)
  }
  start() {
    this.running = true
    setTimeout(() => this.running && this.onstart?.(), 0)
  }
  stop() {
    this.results = this.results.map((r) => ({ ...r, final: true }))
    this.emit()
    this.end()
  }
  abort() {
    if (!this.running) return
    this.running = false
    setTimeout(() => this.onend?.(), 0)
  }
  end() {
    if (!this.running) return
    this.running = false
    this.onend?.()
  }
  say(text: string, final: boolean) {
    const last = this.results[this.results.length - 1]
    const r = { text, final }
    if (last && !last.final) this.results[this.results.length - 1] = r
    else this.results.push(r)
    this.emit()
  }
  emit() {
    this.onresult?.({ resultIndex: 0, results: this.results.map((r) => Object.assign([{ transcript: r.text, confidence: 0.9 }], { isFinal: r.final })) })
  }
}

/** The newest running fake session hears `text`; false when none is running. */
export function devMicSay(text: string, final = true): boolean {
  const r = [...DevRec.all].reverse().find((x) => x.running)
  if (!r) return false
  r.say(text, final)
  return true
}
