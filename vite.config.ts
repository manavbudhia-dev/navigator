import path from 'node:path'

import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import manifest from './src/manifest'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  plugins: [react(), crx({ manifest }), tailwindcss()],
  build: {
    rollupOptions: {
      input: {},
    },
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
