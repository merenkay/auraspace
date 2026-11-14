import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Local development runs in demo mode (in-browser data) by default. To use a real PHP API and
// MySQL database from the dev server, start it with AURA_API_ORIGIN=https://your-site.example
const API_ORIGIN = process.env.AURA_API_ORIGIN

/**
 * Writes the build's file list into the copy of sw.js in the output folder, so the service worker can
 * precache the app shell (hashed file names are only known after the build). The version in the worker
 * is a hash of that list + index.html, so every deploy that changes anything gives the browser a new worker.
 * Heavy extras (the 3D engine chunk, the body model) are "optional": fetched when idle or on first use.
 */
function auraServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'aura-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir
    },
    writeBundle(_opts, bundle) {
      const swPath = join(outDir, 'sw.js')
      if (!existsSync(swPath)) return
      const names = Object.keys(bundle).filter((n) => !n.endsWith('.map'))
      const heavy = names.filter((n) => /^assets\/three-.*\.js$/.test(n))
      const core = names.filter((n) => n.startsWith('assets/') && !heavy.includes(n)).map((n) => '/' + n)
      const statics = ['/', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']
      const precache = [...statics, ...core].sort()
      const optional = [...heavy.map((n) => '/' + n), '/models/body-manifest.json', '/models/body.glb']
      const indexHtml = existsSync(join(outDir, 'index.html')) ? readFileSync(join(outDir, 'index.html')) : ''
      let src = readFileSync(swPath, 'utf8')
      const build = createHash('sha1').update(JSON.stringify([precache, optional])).update(indexHtml).update(src).digest('hex').slice(0, 10)
      src = src
        .replace('__AURA_BUILD__', build)
        .replace(/\/\*__AURA_PRECACHE__\*\/\s*\[[^\]]*\]/, JSON.stringify(precache))
        .replace(/\/\*__AURA_OPTIONAL__\*\/\s*\[[^\]]*\]/, JSON.stringify(optional))
      writeFileSync(swPath, src)
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), auraServiceWorker()],
  server: {
    proxy: API_ORIGIN ? { '/api': { target: API_ORIGIN, changeOrigin: true, secure: true } } : undefined,
  },
  // The default vitest pool crashes in this setup; vmThreads works.
  test: { pool: 'vmThreads' },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts'
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion'
          if (id.includes('node_modules/react-router') || id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
})
