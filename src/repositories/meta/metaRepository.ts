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
}
