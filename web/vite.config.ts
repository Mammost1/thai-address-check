/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const librarySource = resolve(here, '../src/index.ts')

/**
 * The page must make no network request after it loads (docs/TASKS.md, tac-web). The built page
 * carries a Content-Security-Policy that blocks every fetch/XHR/WebSocket and every third-party
 * script, style, font or image. Dev builds skip it because the dev server needs a WebSocket.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function offlinePage(): Plugin {
  return {
    name: 'thai-address-check:offline-page',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    },
    generateBundle() {
      // The page bundles GeoThai data, so ship its NOTICE next to it (docs/recon.md, Q3).
      const require = createRequire(librarySource)
      const notice = resolve(dirname(require.resolve('@geothai/core/package.json')), 'NOTICE')
      this.emitFile({ type: 'asset', fileName: 'NOTICE-geothai.txt', source: readFileSync(notice, 'utf8') })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), offlinePage()],
  resolve: {
    alias: { 'thai-address-check': librarySource },
  },
  server: {
    fs: { allow: [resolve(here, '..')] },
  },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
})
