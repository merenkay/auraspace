// Headless-browser test helper (Edge + Chrome DevTools Protocol, no dependencies).
//
//   node tools/shot.mjs <outDir> <width> <height> <step> [<step> ...]
//
// Steps (run in order):
//   login:<who>      sign in to the DEMO store without the UI. <who> = astronaut[:crewId 1-4] | surgeon | ground | home | polar | spacemember
//   goto:<url>       navigate and wait 2.5 s
//   wait:<ms>
//   shot:<name>      viewport screenshot -> <outDir>/<name>.png      (append "+" for a full-page shot: shot:overview+)
//   eval:<js>        evaluate JS in the page; prints the returned value (wrap in an IIFE to avoid redeclaring consts)
//   click:<css>      DOM click on the first match
//   clicktext:<txt>  DOM click on the first <button>/<a> whose text contains <txt>
//   tap:<x>,<y>      real mouse press+release at viewport coordinates (needed for the WebGL canvas)
//   move:<x>,<y>     real mouse move (hover)
//   type:<text>      type text into the focused element
//
// Use a private <outDir> per agent (it also holds the browser profile). Console errors/exceptions are printed at the end.
// Example:
//   node tools/shot.mjs "$TEMP/aura-shots-me" 1440 900 login:astronaut:1 goto:http://localhost:5173/ shot:overview+
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [outDir, w, h, ...steps] = process.argv.slice(2)
if (!outDir || !w || !h) {
  console.error('usage: node tools/shot.mjs <outDir> <width> <height> <step>...')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync)
if (!EDGE) {
  console.error('No Edge/Chrome found')
  process.exit(1)
}
const port = 9333 + Math.floor(Math.random() * 500)
const proc = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, 'profile')}`,
  `--window-size=${w},${h}`, '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(200)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {}
}
if (!wsUrl) {
  console.error('could not connect to the browser')
  proc.kill()
  process.exit(1)
}
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
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400))
}
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id
  pending.set(i, r)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const metrics = (height = +h) => send('Emulation.setDeviceMetricsOverride', { width: +w, height, deviceScaleFactor: 1, mobile: +w < 600 })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.exceptionDetails ? 'ERROR: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) : r.result?.result?.value
}
await send('Runtime.enable')
await send('Page.enable')
await metrics()

// Demo-store sessions (see src/lib/api.ts: KEY 'aura.demo.v3').
const CREW = { 1: ['okafor', 'Mira Okafor', 'Commander · CDR'], 2: ['reyes', 'Daniel Reyes', 'Pilot · PLT'], 3: ['tanaka', 'Aiko Tanaka', 'Mission Specialist · MS1'], 4: ['brandt', 'Lukas Brandt', 'Flight Engineer · FE'] }
function demoStore(who) {
  const [kind, arg] = who.split(':')
  if (kind === 'astronaut') {
    const c = CREW[arg || 1]
    return { user: { id: +(arg || 1), username: c[0], role: 'astronaut', name: c[1], title: c[2], crewId: +(arg || 1), context: 'space' } }
  }
  if (kind === 'surgeon') return { user: { id: 101, username: 'surgeon', role: 'surgeon', name: 'Dr. Selin Arslan', title: 'Flight Surgeon', crewId: null, context: 'space' } }
  if (kind === 'ground') return { user: { id: 102, username: 'capcom', role: 'ground', name: 'Jonas Weber', title: 'Mission Control · CAPCOM', crewId: null, context: 'space' } }
  const context = kind === 'spacemember' ? 'space' : kind
  const title = { space: 'Space crew', polar: 'Polar station', home: 'Home care' }[context]
  const member = { id: 1000, crewId: 1000, email: 'demo@example.com', name: 'Ayse Demir', pass: 'x', context, createdAt: new Date(Date.now() - 20 * 86400000).toISOString(), color: '#53D7FF' }
  return { members: [member], user: { id: 1000, username: member.email, email: member.email, role: 'member', name: member.name, title, crewId: 1000, context } }
}

for (const s of steps) {
  const cut = s.indexOf(':')
  const cmd = cut < 0 ? s : s.slice(0, cut)
  const arg = cut < 0 ? '' : s.slice(cut + 1)
  if (cmd === 'goto') {
    await send('Page.navigate', { url: arg })
    await sleep(2500)
  } else if (cmd === 'login') {
    const origin = await evaluate('location.origin')
    if (!String(origin).startsWith('http')) {
      await send('Page.navigate', { url: 'http://localhost:5173/login' })
      await sleep(1500)
    }
    console.log('login ->', await evaluate(`(()=>{const k='aura.demo.v3';const cur=JSON.parse(localStorage.getItem(k)||'{}');localStorage.setItem(k,JSON.stringify({...cur,...${JSON.stringify(demoStore(arg))}}));return 'ok'})()`))
  } else if (cmd === 'eval') {
    console.log('eval ->', JSON.stringify(await evaluate(arg))?.slice(0, 600))
  } else if (cmd === 'wait') {
    await sleep(+arg)
  } else if (cmd === 'click') {
    console.log('click ->', await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(arg)});if(!el)return 'NOT FOUND';el.click();return 'ok'})()`))
    await sleep(800)
  } else if (cmd === 'clicktext') {
    console.log('clicktext ->', await evaluate(`(()=>{const el=[...document.querySelectorAll('button,a,[role=button]')].find(b=>b.textContent.includes(${JSON.stringify(arg)}));if(!el)return 'NOT FOUND';el.click();return 'ok'})()`))
    await sleep(800)
  } else if (cmd === 'move' || cmd === 'tap') {
    const [x, y] = arg.split(',').map(Number)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(250)
    if (cmd === 'tap') {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    }
    await sleep(600)
  } else if (cmd === 'type') {
    await send('Input.insertText', { text: arg })
    await sleep(300)
  } else if (cmd === 'shot') {
    const full = arg.endsWith('+')
    const name = arg.replace(/\+$/, '')
    if (full) {
      const H = Math.min(5000, Number(await evaluate('document.documentElement.scrollHeight')) || +h)
      await metrics(H)
      await sleep(900)
    }
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
    if (full) await metrics()
    console.log('shot ->', join(outDir, name + '.png'))
  } else {
    console.log('unknown step', s)
  }
}
if (logs.length) console.log('PAGE LOGS:\n' + [...new Set(logs)].slice(0, 25).join('\n'))
ws.close()
proc.kill()
process.exit(0)
