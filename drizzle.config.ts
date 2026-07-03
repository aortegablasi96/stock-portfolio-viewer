import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit configuration for local tooling (generate / migrate / studio).
 *
 * At runtime the app opens the database in the Electron per-user data directory
 * (see src/db/client.ts). drizzle-kit runs outside Electron, so it targets a
 * local dev database file (override with DATABASE_URL) — used only for
 * `db:migrate` / `db:studio` during development.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './local.dev.db',
  },
})
