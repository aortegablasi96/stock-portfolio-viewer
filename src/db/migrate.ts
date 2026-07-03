import { join } from 'node:path'
import { app } from 'electron'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDb, getDatabasePath } from './client'

/**
 * Resolve the folder holding the generated SQL migrations.
 *
 * - Dev: the `drizzle/` folder at the project root (cwd).
 * - Packaged: shipped under the app's resources via electron-builder
 *   `extraResources` (see electron-builder.yml).
 */
function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')
}

/**
 * Apply any pending migrations. Called once on app launch (before windows open)
 * so the schema is always current. Idempotent: Drizzle tracks applied migrations
 * in its own bookkeeping table and skips those already run.
 */
export function runMigrations(): void {
  migrate(getDb(), { migrationsFolder: migrationsFolder() })
  console.log(`[db] migrations applied · ${getDatabasePath()}`)
}
