import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In local development, /api is forwarded to the live Hostinger site so the PHP API
// and MySQL database can be used without running PHP locally.
const API_ORIGIN = process.env.AURA_API_ORIGIN ?? 'https://lightseagreen-badger-727436.hostingersite.com'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: API_ORIGIN, changeOrigin: true, secure: true },
    },
  },
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
