import { randomUUID } from 'node:crypto'
import { metaRepository } from '@repositories/meta/metaRepository'

const INSTALL_ID_KEY = 'install_id'

/**
 * Application metadata logic. A real (if small) vertical slice through the
 * layering: a service that owns business logic and reaches data only through a
 * repository — never the database directly (see ADR-0003). This is the primary
 * unit-test target and shows the repository-mocking pattern.
 */
export const metaService = {
  /**
   * Return this installation's stable id, generating and persisting one on first
   * run. Later milestones (analytics, AI) can rely on a durable local identity.
   */
  getInstallId(): string {
    const existing = metaRepository.get(INSTALL_ID_KEY)
    if (existing) return existing

    const id = randomUUID()
    metaRepository.set(INSTALL_ID_KEY, id)
    return id
  },
}
