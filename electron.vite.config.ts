import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Shared path aliases (mirror of tsconfig.json "paths").
const alias = {
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src'),
  '@services': resolve('src/services'),
  '@repositories': resolve('src/repositories'),
  '@shared': resolve('src/shared'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
})
