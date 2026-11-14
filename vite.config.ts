import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Local development runs in demo mode (in-browser data) by default. To use a real PHP API and
// MySQL database from the dev server, start it with AURA_API_ORIGIN=https://your-site.example
const API_ORIGIN = process.env.AURA_API_ORIGIN

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
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
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          return undefined
        },
      },
    },
  },
})
