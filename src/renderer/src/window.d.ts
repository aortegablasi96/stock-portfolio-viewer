import type { RendererApi } from '@shared/ipc/contract'

// Make the preload-exposed bridge visible to the renderer's type system.
// Type-only — nothing here reaches the bundle.
declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
