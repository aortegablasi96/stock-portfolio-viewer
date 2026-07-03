import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metaService } from './metaService'
import { metaRepository } from '@repositories/meta/metaRepository'

// Mock the repository so the service is tested in isolation (no database).
vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

const mockRepo = vi.mocked(metaRepository)

describe('metaService.getInstallId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the existing install id without writing', () => {
    mockRepo.get.mockReturnValue('existing-id')

    const id = metaService.getInstallId()

    expect(id).toBe('existing-id')
    expect(mockRepo.get).toHaveBeenCalledWith('install_id')
    expect(mockRepo.set).not.toHaveBeenCalled()
  })

  it('generates and persists a new install id on first run', () => {
    mockRepo.get.mockReturnValue(undefined)

    const id = metaService.getInstallId()

    // A UUID v4-shaped string.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(mockRepo.set).toHaveBeenCalledWith('install_id', id)
  })
})
