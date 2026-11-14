// Main-thread performance measurement (headless Edge + Chrome DevTools Protocol, no dependencies).
//
// Records, per user flow: long tasks (PerformanceObserver 'longtask'), total blocking time (sum of task time
// above 50 ms), the worst task, requestAnimationFrame gaps (p95 / max / count over 50 ms) and the scripts behind
// the worst long animation frames (LoAF attribution). Optional: 4x CPU throttling and a sampled CPU profile.
//
// Usage (production build made for measurements, so the window.__aura* test hooks exist):
//   export PATH="/c/Program Files/nodejs:$PATH"
//   VITE_PERF_HOOKS=1 npx vite build --outDir "$TEMP/aura-perf-dist" --emptyOutDir
//   npx vite preview --outDir "$TEMP/aura-perf-dist" --port 4175 --strictPort &      # stop it afterwards
//   node tools/perf.mjs --url http://localhost:4175 --throttle 4 --out "$TEMP/aura-perf" [--flows login,signin,...] [--profile] [--json file]
//
// Flows: login, signin, viewer, tabs, voice, hand-synth, hand-cam, combo, history, environment, roster, demo
// (the guided tour at /?demo=1: its start, then every chapter change).
// Numbers come from headless Edge with software WebGL (SwiftShader) on whatever machine runs this: compare runs
// on the same machine, not absolute values. In the app, Alt+P shows a live HUD with the same counters.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i < 0 ? def : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true
}
const BASE = String(opt('url', 'http://localhost:4175')).replace(/\/$/, '')
const THROTTLE = Number(opt('throttle', 1))
const OUT = String(opt('out', join(process.env.TEMP || '.', 'aura-perf')))
const PROFILE = !!opt('profile', false)
const ALL = ['login', 'signin', 'viewer', 'tabs', 'voice', 'hand-synth', 'hand-cam', 'combo', 'history', 'environment', 'roster', 'demo']
const FLOWS = String(opt('flows', ALL.join(','))).split(',')
const W = 1440
const H = 900
mkdirSync(OUT, { recursive: true })
const profileDir = join(OUT, 'profile')
rmSync(profileDir, { recursive: true, force: true }) // a fresh profile: first visit, no service worker, empty caches

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)
if (!EDGE) throw new Error('No Edge/Chrome found')
const port = 9333 + Math.floor(Math.random() * 500)
const proc = spawn(EDGE, [
  '--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `--window-size=${W},${H}`, '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' })
// Edge's GPU/renderer processes outlive a plain kill() of the browser process on Windows (and keep burning CPU
// with software rendering): always end the whole tree, also on Ctrl+C or a crash.
const killTree = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill('SIGKILL')
  } catch {}
}
process.on('exit', killTree)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(200)
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {}
}
if (!wsUrl) throw new Error('could not connect to the browser')
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300))
}
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id
  pending.set(i, r)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.exceptionDetails ? 'ERROR: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) : r.result?.result?.value
}

// The recorder, installed in every new document before the app's own scripts.
const RECORDER = `(() => {
  const R = (window.__perf = { lt: [], loaf: [], gaps: [] });
  R.reset = () => { R.lt = []; R.loaf = []; R.gaps = []; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) R.lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) R.loaf.push({ s: e.startTime, d: e.duration, block: e.blockingDuration, scripts: [...(e.scripts || [])].sort((a, b) => b.duration - a.duration).slice(0, 3).map((x) => ({ d: Math.round(x.duration), inv: String(x.invoker || '').slice(0, 60), fn: x.sourceFunctionName || '', src: String(x.sourceURL || '').split('/').pop() + ':' + x.sourceCharPosition })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  let last = 0;
  const loop = (t) => { if (last && !document.hidden) R.gaps.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  R.stats = () => {
    const lt = R.lt, g = [...R.gaps].sort((a, b) => a - b);
    const q = (p) => (g.length ? g[Math.min(g.length - 1, Math.floor(p * g.length))] : 0);
    return {
      tasks: lt.length, tbt: Math.round(lt.reduce((s, t) => s + Math.max(0, t.d - 50), 0)), worst: Math.round(Math.max(0, ...lt.map((t) => t.d))),
      over100: lt.filter((t) => t.d > 100).length, frames: g.length, p95: Math.round(q(0.95)), gapMax: Math.round(g[g.length - 1] || 0), gaps50: g.filter((x) => x > 50).length,
      loaf: [...R.loaf].sort((a, b) => b.d - a.d).slice(0, 4).map((f) => ({ d: Math.round(f.d), block: Math.round(f.block), scripts: f.scripts })),
    };
  };
})();`

await send('Runtime.enable')
await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
await send('Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin: BASE }).catch(() => undefined)

const CREW = { 1: ['okafor', 'Mira Okafor', 'Commander · CDR'] }
const STORE = {
  astronaut: { user: { id: 1, username: CREW[1][0], role: 'astronaut', name: CREW[1][1], title: CREW[1][2], crewId: 1, context: 'space' } },
  surgeon: { user: { id: 101, username: 'surgeon', role: 'surgeon', name: 'Dr. Selin Arslan', title: 'Flight Surgeon', crewId: null, context: 'space' } },
}
const signIn = (who) => evaluate(`(()=>{const k='aura.demo.v3';const cur=JSON.parse(localStorage.getItem(k)||'{}');localStorage.setItem(k,JSON.stringify({...cur,...${JSON.stringify(STORE[who])}}));localStorage.setItem('aura.hand.v1',JSON.stringify({intro:true,legendHidden:false}));return 'ok'})()`)
const goto = async (path, wait = 2500) => {
  await send('Page.navigate', { url: BASE + path })
  await sleep(wait)
}
/** client-side navigation (what a click on a tab does) */
const nav = (path) => evaluate(`(()=>{const a=[...document.querySelectorAll('nav a[href]')].find(a=>a.getAttribute('href')===${JSON.stringify(path)});if(a){a.click();return 'link'}history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'));return 'push'})()`)
const reset = () => evaluate('window.__perf && window.__perf.reset()')
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra })
const canvasRect = () => evaluate(`(()=>{const c=document.querySelector('canvas');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`)
const waitFor = async (expr, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await evaluate(expr)) return Date.now() - t0
    await sleep(250)
  }
  return null
}
const scrollThrough = async (steps = 8) => {
  for (let i = 0; i < steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: W / 2, y: H / 2, deltaX: 0, deltaY: 450 })
    await sleep(350)
  }
}
async function dragViewer() {
  const r = await canvasRect()
  if (!r) return 'no canvas'
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  for (let i = 0; i < 25; i++) {
    await mouse('mouseMoved', cx - 60 + i * 5, cy - 40 + (i % 7) * 10)
    await sleep(16)
  }
  await mouse('mousePressed', cx, cy, { button: 'left', clickCount: 1 })
  for (let i = 0; i < 30; i++) {
    await mouse('mouseMoved', cx + i * 8, cy + Math.sin(i / 4) * 20, { button: 'left', buttons: 1 })
    await sleep(16)
  }
  await mouse('mouseReleased', cx + 240, cy, { button: 'left', clickCount: 1 })
  for (let i = 0; i < 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: i < 4 ? -200 : 200 })
    await sleep(60)
  }
  for (const [dx, dy] of [[0, -120], [0, 0], [0, 80], [-30, 160], [10, -60]]) {
    await mouse('mouseMoved', cx + dx, cy + dy)
    await mouse('mousePressed', cx + dx, cy + dy, { button: 'left', clickCount: 1 })
    await mouse('mouseReleased', cx + dx, cy + dy, { button: 'left', clickCount: 1 })
    await sleep(500)
  }
  return 'ok'
}
const HAND_PATH = `[{ms:200,pose:'open',x:500,y:400},{ms:600,pose:'open',x:900,y:300},{ms:600,pose:'open',x:700,y:600},{ms:500,pose:'open',x:400,y:500},{ms:300,pose:'pinch',x:400,y:500},{ms:500,pose:'pinch',x:600,y:500},{ms:200,pose:'open',x:600,y:500},{ms:600,pose:'open',x:1000,y:450}]`

const flows = {
  async login() {
    await goto('/login', 4500)
  },
  async signin() {
    await signIn('astronaut')
    await goto('/', 500)
    const ms = await waitFor(`!!(window.__auraViewer && window.__auraViewer.stats().bvh.ready)`, 30000)
    await sleep(1500)
    return { bvhReadyAfterMs: ms, bvh: await evaluate('window.__auraViewer && window.__auraViewer.stats().bvh') }
  },
  async viewer() {
    await reset()
    return dragViewer()
  },
  async tabs() {
    await reset()
    const paths = ['/crew/1/diagnostics', '/crew/1/aura', '/crew/1/coach', '/crew/1/history', '/environment', '/crew/1/history', '/crew/1/coach', '/crew/1/aura', '/crew/1/diagnostics', '/crew/1']
    for (const p of paths) {
      await nav(p)
      await sleep(900)
    }
  },
  async voice() {
    await reset()
    await evaluate('window.__auraVoice.open()')
    await sleep(600)
    const out = []
    for (const t of ['status report', 'how is my heart', 'open history', 'show my blood pressure', 'go to overview', 'what should I do today']) {
      out.push(String(await evaluate(`window.__auraVoice.hear(${JSON.stringify(t)})`)).slice(0, 50))
      await sleep(700)
    }
    await evaluate('window.__auraVoice.close()')
    await sleep(500)
    return out
  },
  async 'hand-synth'() {
    await reset()
    await evaluate(`window.__auraHand.start({synthetic:true})`)
    await sleep(1200)
    await evaluate(`window.__auraHand.play(${HAND_PATH}, 20)`)
    await sleep(500)
    const r = await evaluate(`window.__auraHand.view()`)
    await evaluate(`window.__auraHand.stop()`)
    await sleep(600)
    return r
  },
  async 'hand-cam'() {
    await reset()
    await evaluate(`window.__auraHand.start({synthetic:false})`)
    const ms = await waitFor(`(()=>{const s=window.__auraHand.stats&&window.__auraHand.stats();return s&&s.frames>5})()`, 40000)
    await sleep(2500)
    const s = await evaluate(`window.__auraHand.stats && window.__auraHand.stats()`)
    await evaluate(`window.__auraHand.stop()`)
    await sleep(600)
    return { firstResultsAfterMs: ms, stats: s && { mode: s.mode, delegate: s.delegate, fps: s.fps, detectMs: Math.round(s.detectMs), latencyMs: Math.round(s.latencyMs), bench: s.bench } }
  },
  async combo() {
    await nav('/crew/1')
    await sleep(2500)
    await reset()
    await evaluate(`window.__auraHand.start({synthetic:false})`)
    await waitFor(`(()=>{const s=window.__auraHand.stats&&window.__auraHand.stats();return s&&s.frames>3})()`, 40000)
    await evaluate('window.__auraVoice.open()')
    const voice = evaluate(`(async()=>{for(const t of ['status report','how is my heart','show my lungs']){await window.__auraVoice.hear(t);await new Promise(r=>setTimeout(r,600))}})()`)
    await dragViewer()
    await voice
    const s = await evaluate(`window.__auraHand.stats && window.__auraHand.stats()`)
    await evaluate(`window.__auraHand.stop()`)
    await evaluate('window.__auraVoice.close()')
    await sleep(600)
    return s && { fps: s.fps, detectMs: Math.round(s.detectMs), delegate: s.delegate }
  },
  async history() {
    await reset()
    await nav('/crew/1/history')
    await sleep(2500)
    await scrollThrough(8)
    await sleep(800)
  },
  async environment() {
    await evaluate('scrollTo(0,0)')
    await reset()
    await nav('/environment')
    await sleep(2500)
    await scrollThrough(8)
    await sleep(800)
  },
  async demo() {
    await goto('/?demo=1', 500)
    await waitFor('!!(window.__auraDemo && window.__auraDemo.tour)', 20000)
    await sleep(1500)
    const n = await evaluate(`(()=>{const t=window.__auraDemo.tour;const st=t.state||{};if(!st.phase||st.phase==='idle')t.start&&t.start();return (t.chapters||[]).length})()`)
    await sleep(5000)
    for (let c = 1; c < Math.min(Number(n) || 0, 12); c++) {
      await evaluate(`window.__auraDemo.tour.seekChapter(${c})`)
      await sleep(3500)
    }
    return { chapters: n }
  },
  async roster() {
    await signIn('surgeon')
    await goto('/crew', 5000)
    await scrollThrough(4)
    await sleep(600)
  },
}

function topSelf(profile, n = 14) {
  const self = new Map()
  const byId = new Map(profile.nodes.map((x) => [x.id, x]))
  const dt = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i])
    const f = node.callFrame
    if (['(idle)', '(program)', '(garbage collector)', '(root)'].includes(f.functionName)) continue
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000)
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`)
}

const results = {}
await goto('/login', 1000) // establishes the origin for localStorage
await evaluate('localStorage.clear()')
for (const name of FLOWS) {
  if (!flows[name]) {
    console.log('unknown flow', name)
    continue
  }
  if (PROFILE) {
    await send('Profiler.enable')
    await send('Profiler.setSamplingInterval', { interval: 250 })
    await send('Profiler.start')
  }
  let info
  try {
    info = await flows[name]()
  } catch (e) {
    info = 'FAILED ' + e
  }
  await sleep(300)
  const stats = await evaluate('window.__perf ? window.__perf.stats() : null')
  results[name] = { ...stats, info }
  if (PROFILE) {
    const p = await send('Profiler.stop')
    results[name].profile = topSelf(p.result.profile)
  }
  const s = stats || {}
  console.log(`${name.padEnd(12)} tasks ${String(s.tasks).padStart(3)}  TBT ${String(s.tbt).padStart(5)} ms  worst ${String(s.worst).padStart(4)} ms  >100ms ${String(s.over100).padStart(2)}  frames ${String(s.frames).padStart(4)}  gap p95 ${String(s.p95).padStart(4)} ms  max ${String(s.gapMax).padStart(5)} ms  gaps>50 ${s.gaps50}`)
  if (info !== undefined) console.log('             info', JSON.stringify(info).slice(0, 300))
  for (const f of s.loaf || []) console.log(`             frame ${f.d} ms (blocking ${f.block}): ${f.scripts.map((x) => `${x.d}ms ${x.inv} ${x.fn} ${x.src}`).join(' | ')}`)
  if (results[name].profile) console.log('             top self time:\n' + results[name].profile.map((l) => '               ' + l).join('\n'))
}
const json = opt('json', null)
writeFileSync(typeof json === 'string' ? json : join(OUT, `perf-${Date.now()}.json`), JSON.stringify({ base: BASE, throttle: THROTTLE, at: new Date().toISOString(), results }, null, 1))
if (logs.length) console.log('PAGE LOGS:\n' + [...new Set(logs)].slice(0, 15).join('\n'))
ws.close()
process.exit(0)
