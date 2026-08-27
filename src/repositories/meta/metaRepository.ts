import { eq } from 'drizzle-orm'
import { getDb } from '@db/client'
import { appMeta } from '@db/schema'

/**
 * Repository for the `app_meta` key/value table. Repositories are the only place
 * that touches the database (see ADR-0003); services and the renderer reach data
 * exclusively through repositories like this one.
 */
export const metaRepository = {
  get(key: string): string | undefined {
    const row = getDb()
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, key))
      .get()
    return row?.value
  },

  set(key: string, value: string): void {
    getDb()
      .insert(appMeta)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value, updatedAt: new Date() },
      })
      .run()
  },

  /**
   * Remove one metadata value, reporting whether a row was there to remove (Story #280).
   *
   * This is **not** the delete-by-id variant ADR-0006 refuses. That rule guards the append-only
   * history stores — snapshots and the `flex_*` tables — where a row records something that
   * happened and deleting one silently rewrites the past. `app_meta` records no history: every
   * value in it is a current setting the app overwrites in place whenever the owner changes it
   * (DDR-0028), and un-setting one is the same class of act as re-writing it. The investor
   * profile's "Clear" is the first caller (DDR-0094).
   */
  remove(key: string): boolean {
    const result = getDb().delete(appMeta).where(eq(appMeta.key, key)).run()
    return result.changes > 0
  },
}
