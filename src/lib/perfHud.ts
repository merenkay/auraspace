// Development-only performance HUD (also in builds made for measurements, see devHooks.ts). Alt+P shows or hides
// it. Plain DOM, no React, so it never causes a render of the app itself.
//
//   fps        display frames in the last second
//   worst      longest gap between two frames in the last 5 s (a freeze shows up here)
//   long       main-thread tasks over 50 ms in the last 5 s / since the HUD was opened
//   TBT        total blocking time (sum of the part of every long task above 50 ms) since opened
//
// Rough guide: worst under ~50 ms and long = 0 while you interact is smooth; worst of 100–200 ms is a visible
// hitch; anything over ~300 ms feels like a freeze. Numbers in a background tab are meaningless.
type Task = { at: number; d: number }

export function installPerfHud() {
  if (typeof window === 'undefined' || (window as { __auraPerfHud?: boolean }).__auraPerfHud) return
  ;(window as { __auraPerfHud?: boolean }).__auraPerfHud = true
  let el: HTMLDivElement | null = null
  let raf = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let obs: PerformanceObserver | null = null
  let frames: number[] = []
  let tasks: Task[] = []
  let total = 0
  let tbt = 0
  let last = 0

  const loop = (t: number) => {
    if (last) frames.push(t, t - last)
    last = t
    raf = requestAnimationFrame(loop)
  }
  const paint = () => {
    if (!el) return
    const now = performance.now()
    while (frames.length && now - frames[0] > 5000) frames.splice(0, 2)
    tasks = tasks.filter((x) => now - x.at <= 5000)
    let fps = 0
    let worst = 0
    for (let i = 0; i < frames.length; i += 2) {
      if (now - frames[i] <= 1000) fps++
      worst = Math.max(worst, frames[i + 1])
    }
    const level = worst > 300 || tasks.some((x) => x.d > 200) ? 'bad' : worst > 100 || tasks.length ? 'warn' : 'ok'
    el.dataset.level = level
    el.textContent = `${fps} fps · worst ${Math.round(worst)} ms · long ${tasks.length}/${total} · TBT ${Math.round(tbt)} ms`
    el.title = 'fps: frames in the last second · worst: longest frame gap in the last 5 s · long: tasks over 50 ms in the last 5 s / since opened · TBT: blocking time since opened (Alt+P hides)'
  }
  const show = () => {
    el = document.createElement('div')
    el.setAttribute('role', 'status')
    el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:2147483000;padding:4px 8px;border-radius:6px;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#f3f0ea;background:rgba(10,10,10,.82);pointer-events:auto;white-space:nowrap'
    const style = document.createElement('style')
    style.textContent = '[data-aura-perf][data-level=warn]{box-shadow:inset 3px 0 #e8b04a}[data-aura-perf][data-level=bad]{box-shadow:inset 3px 0 #e5484d}[data-aura-perf][data-level=ok]{box-shadow:inset 3px 0 #4cc38a}'
    el.dataset.auraPerf = ''
    el.appendChild(style)
    document.body.appendChild(el)
    frames = []
    tasks = []
    total = 0
    tbt = 0
    last = 0
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          tasks.push({ at: e.startTime + e.duration, d: e.duration })
          total++
          tbt += Math.max(0, e.duration - 50)
        }
      })
      obs.observe({ type: 'longtask', buffered: false })
    } catch {
      obs = null // no long-task timing in this browser: frame gaps only
    }
    raf = requestAnimationFrame(loop)
    timer = setInterval(paint, 500)
    paint()
  }
  const hide = () => {
    cancelAnimationFrame(raf)
    clearInterval(timer)
    obs?.disconnect()
    obs = null
    el?.remove()
    el = null
  }
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
      e.preventDefault()
      if (el) hide()
      else show()
    }
  })
  ;(window as { __auraPerf?: unknown }).__auraPerf = { show: () => !el && show(), hide }
}
