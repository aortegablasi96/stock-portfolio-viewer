import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sidebarStateService, SIDEBAR_DEFAULT_COLLAPSED } from './sidebarStateService'
import { metaRepository } from '@repositories/meta/metaRepository'

// Mock the repository so the service is tested in isolation (no database).
vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

const mockRepo = vi.mocked(metaRepository)

describe('sidebarStateService.get', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens expanded on first launch, so the five glyphs arrive with their labels', () => {
    mockRepo.get.mockReturnValue(undefined)

    expect(sidebarStateService.get()).toEqual({ collapsed: SIDEBAR_DEFAULT_COLLAPSED })
    expect(SIDEBAR_DEFAULT_COLLAPSED).toBe(false)
  })

  it('restores a stored collapse', () => {
    mockRepo.get.mockReturnValue(JSON.stringify({ collapsed: true }))

    expect(sidebarStateService.get()).toEqual({ collapsed: true })
  })

  it('restores a stored expansion, which is not the same as nothing stored', () => {
    mockRepo.get.mockReturnValue(JSON.stringify({ collapsed: false }))

    expect(sidebarStateService.get()).toEqual({ collapsed: false })
  })

  /**
   * The value is a hand-editable row in a local database and can predate a change to this shape,
   * so every way of being unusable has to end at the default rather than at a thrown launch.
   */
  it.each([
    ['not JSON at all', 'collapsed'],
    ['JSON of the wrong shape', '{"width":56}'],
    ['the right key with the wrong type', '{"collapsed":"yes"}'],
    ['an empty string, which the repository reports for an empty value', ''],
    ['a JSON scalar rather than an object', 'true'],
  ])('falls back to the default when the stored value is %s', (_case, stored) => {
    mockRepo.get.mockReturnValue(stored)

    expect(sidebarStateService.get()).toEqual({ collapsed: SIDEBAR_DEFAULT_COLLAPSED })
  })
})

describe('sidebarStateService.set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes one overwritten key rather than appending history', () => {
    sidebarStateService.set({ collapsed: true })
    sidebarStateService.set({ collapsed: false })

    expect(mockRepo.set).toHaveBeenCalledTimes(2)
    expect(mockRepo.set.mock.calls.map(([key]) => key)).toEqual(['sidebar_state', 'sidebar_state'])
    expect(mockRepo.set).toHaveBeenLastCalledWith('sidebar_state', '{"collapsed":false}')
  })

  /** What is written is what `get` parses: a round trip is the only thing that makes it a setting. */
  it('round-trips through the stored value', () => {
    sidebarStateService.set({ collapsed: true })
    const [, written] = mockRepo.set.mock.calls[0]!
    mockRepo.get.mockReturnValue(written)

    expect(sidebarStateService.get()).toEqual({ collapsed: true })
  })
})
