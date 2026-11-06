import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Vite's fast-refresh needs inline scripts, so the strict rules go only into the built app.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: brita-media:",
  "media-src brita-media:",
].join('; ')

function strictContentPolicy(): Plugin {
  return {
    name: 'brita-content-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), strictContentPolicy()],
    // Two pages: the player and the mini player (which never loads the music code).
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          mini: resolve(__dirname, 'src/renderer/mini.html'),
        },
      },
    },
  },
})
