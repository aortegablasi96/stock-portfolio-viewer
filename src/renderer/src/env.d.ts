/// <reference types="vite/client" />

// Environment variables electron-vite inlines into the renderer bundle at build time.
// Only `RENDERER_VITE_`-prefixed values from the root `.env` reach this bundle.
// Type-only — nothing here is emitted.
interface ImportMetaEnv {
  /** Mapbox GL JS public access token (`pk.…`), or an empty string when unconfigured. */
  readonly RENDERER_VITE_MAPBOX_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
