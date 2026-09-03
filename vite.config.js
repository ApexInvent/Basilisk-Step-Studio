import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [vue()],
  // One version number, read from package.json. It is shown in the status bar and compared
  // against the update feed, and those two disagreeing would be worse than not showing it.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Fixed port because the desktop shell points at it during development.
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    // three.js is the only genuinely large dependency and the viewer imports it
    // dynamically, so leaving it in its own chunk keeps the first paint cheap.
    chunkSizeWarningLimit: 900
  }
})
