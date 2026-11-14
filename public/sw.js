/* AURA service worker (hand-written, no dependencies).
 *
 * The build (vite.config.ts, plugin "aura-sw") fills in the build id and the two file lists below in the copy
 * that lands in dist/. In dev this file is never registered.
 *
 * Rules:
 *  - /api/* and every non-GET request is NEVER touched: health data and sign-in always use the network.
 *  - App shell + every JS/CSS chunk of this build is precached (so every page opens offline).
 *  - Heavy extras (3D viewer chunk, body.glb) are cached on first use or on a WARM message (idle time).
 *  - Hand control (MediaPipe chunk, /mediapipe/ runtime + model, ~22 MB) is cached on first use ONLY, never
 *    warmed, in its own cache named after the content of those files (an app deploy keeps it).
 *  - Navigations: network first (so a deploy is picked up), 4 s timeout, then cached index.html, then offline.html.
 *  - A new worker waits; the page sends SKIP_WAITING at the next in-app navigation (see src/main.tsx).
 */
const BUILD = '__AURA_BUILD__'
const PRECACHE = /*__AURA_PRECACHE__*/ ['/', '/offline.html']
const OPTIONAL = /*__AURA_OPTIONAL__*/ []
const LAZY = /*__AURA_LAZY__*/ []

const SHELL = 'aura-shell-' + BUILD
const RUNTIME = 'aura-runtime-v1' // survives builds: fonts, models, 3D chunk (all immutable or revalidated)
const FONTS = 'aura-fonts-v1'
const LAZY_CACHE = 'aura-lazy-__AURA_LAZY_VERSION__'
const KEEP = [SHELL, RUNTIME, FONTS, LAZY_CACHE]
const MATCH = { ignoreVary: true } // static hosts may send Vary: Origin, which would make module-script requests miss the precache

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // cache: 'reload' so a stale HTTP cache cannot put a mismatched index.html in the new shell
      cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('aura-') && !KEEP.includes(k)) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') self.skipWaiting()
  if (type === 'WARM') event.waitUntil(warm())
})

async function warm() {
  const cache = await caches.open(RUNTIME)
  await Promise.allSettled(
    OPTIONAL.map(async (u) => {
      if (await cache.match(u)) return
      const res = await fetch(u)
      if (res.ok) await cache.put(u, res)
    }),
  )
}

const isAsset = (url) => url.pathname.startsWith('/assets/')
const isModel = (url) => url.pathname.startsWith('/models/')

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Cross-origin: only Google Fonts. Everything else is left to the browser.
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com') event.respondWith(staleWhileRevalidate(req, FONTS))
    else if (url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(req, FONTS))
    return
  }

  if (url.pathname.startsWith('/api/')) return // never cached, never intercepted

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req))
    return
  }
  if (LAZY.includes(url.pathname)) {
    event.respondWith(cacheFirst(req, LAZY_CACHE))
    return
  }
  if (isAsset(url)) {
    event.respondWith(cacheFirst(req, SHELL, true))
    return
  }
  if (isModel(url)) {
    // Models are large and change rarely. Serve from cache, refresh in the background.
    event.respondWith(staleWhileRevalidate(req, RUNTIME))
    return
  }
  if (PRECACHE.includes(url.pathname) || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
    event.respondWith(staleWhileRevalidate(req, SHELL))
  }
})

async function navigate(req) {
  const shell = await caches.open(SHELL)
  try {
    const res = await timeout(fetch(req), 4000)
    // Only an HTML 200 refreshes the cached shell (a 404 from a server fallback must not).
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) shell.put('/', res.clone())
    return res
  } catch {
    return (await shell.match('/', MATCH)) || (await shell.match('/offline.html', MATCH)) || Response.error()
  }
}

async function cacheFirst(req, name, fallbackAnyCache) {
  const cache = await caches.open(name)
  const hit = await cache.match(req, MATCH)
  if (hit) return hit
  if (fallbackAnyCache) {
    // 3D chunk lives in the runtime cache
    const other = await (await caches.open(RUNTIME)).match(req, MATCH)
    if (other) return other
  }
  const res = await fetch(req)
  if (res.ok || res.type === 'opaque') {
    const target = fallbackAnyCache && OPTIONAL.includes(new URL(req.url).pathname) ? RUNTIME : name
    ;(await caches.open(target)).put(req, res.clone())
  }
  return res
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req, MATCH)
  const net = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
      return res
    })
    .catch(() => undefined)
  if (hit) return hit
  return (await net) || Response.error()
}

function timeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}
