import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

/**
 * The embedded SQLite connection (better-sqlite3, synchronous) and its Drizzle
 * client. Local-first: the database file lives in the app's per-user data
 * directory and never leaves the machine.
 *
 * This module lives in the data layer (`@db`). Only the repository layer and the
 * startup migration bootstrap may import it — services and the renderer must go
 * through repositories / IPC (enforced by ESLint). See ADR-0003.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema>

let db: AppDatabase | null = null
let connection: Database.Database | null = null

/** Absolute path to the SQLite file in the OS per-user app-data directory. */
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'portfolio.db')
}

/** Lazily open the connection and return the Drizzle client (singleton). */
export function getDb(): AppDatabase {
  if (!db) {
    connection = new Database(getDatabasePath())
    connection.pragma('journal_mode = WAL')
    connection.pragma('foreign_keys = ON')
    db = drizzle(connection, { schema })
  }
  return db
}

/** Close the connection (used on app shutdown / in tests). */
export function closeDb(): void {
  connection?.close()
  connection = null
  db = null
}
