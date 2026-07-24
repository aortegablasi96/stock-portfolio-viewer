import { basename } from 'node:path'
import { flexRepository } from '@repositories/flex/flexRepository'
import type { FlexImportSummary } from '@shared/domain/flex'

/**
 * Flex Query import business logic (Milestone M3, Story #20; ADR-0005). The service
 * owns the batch policy: **parse and validate every selected file first**, and only if
 * all parse successfully persist them. So a malformed file in the batch aborts the
 * whole import before anything is written (no partial import), while the per-statement
 * de-dupe that keeps re-imports idempotent lives in `flexRepository`.
 *
 * It reaches data only through `flexRepository`, so it stays framework-agnostic and
 * unit-testable with the repository mocked.
 */
export const flexImportService = {
  /**
   * Import the given Flex Query XML files. Parsing happens up front (the common
   * failure — a bad file — is caught here before any persistence); persistence then
   * runs per statement. Returns what was stored versus skipped as duplicates.
   */
  import(paths: string[]): FlexImportSummary {
    // Validation gate: parse all files before writing anything.
    const parsed = paths.map((path) => ({
      filename: basename(path),
      statements: flexRepository.readAndParse(path),
    }))

    const statements = parsed.flatMap(({ filename, statements }) =>
      statements.map((statement) => flexRepository.persist(statement, filename)),
    )

    return { statements }
  },

  /**
   * Clear the entire imported Flex store so corrected exports can be re-imported cleanly
   * (Story #43, ADR-0006). This is a full, owner-confirmed reset — not a partial delete —
   * so afterwards the analytics views degrade to their needs-import state until a fresh
   * import. Returns how many statements were removed.
   */
  clearStatements(): { removedStatements: number } {
    return { removedStatements: flexRepository.clearAll() }
  },
}
