import { describe, it, expect } from 'vitest'
import { partialProgressNote, runningLabel } from './classifyProgress'

describe('runningLabel', () => {
  it('falls back to a plain label until the first progress tick arrives', () => {
    expect(runningLabel(null)).toBe('Classifying…')
  })

  it('counts the sequential lookups off once a total is known', () => {
    expect(runningLabel({ completed: 3, total: 12 })).toBe('Classifying… 3 of 12')
  })

  it('does not show "0 of 0" when there is nothing to look up', () => {
    expect(runningLabel({ completed: 0, total: 0 })).toBe('Classifying…')
  })
})

describe('partialProgressNote', () => {
  it('says nothing when the run got nowhere', () => {
    // A closed gateway fails before the first lookup, so there is no progress to report.
    expect(partialProgressNote({ fetched: 0, classified: 0, remaining: 8 })).toBeNull()
  })

  it('reports what was saved and what a retry would pick up', () => {
    expect(partialProgressNote({ fetched: 4, classified: 3, remaining: 8 })).toBe(
      '4 instruments were saved before it stopped — retrying picks up with the remaining 8.',
    )
  })

  it('drops the retry clause when nothing is left', () => {
    // Reachable when the failure is the persist itself, not a lookup.
    expect(partialProgressNote({ fetched: 4, classified: 4, remaining: 0 })).toBe(
      '4 instruments were saved before it stopped.',
    )
  })

  it('reads correctly for a single instrument', () => {
    expect(partialProgressNote({ fetched: 1, classified: 1, remaining: 2 })).toBe(
      '1 instrument was saved before it stopped — retrying picks up with the remaining 2.',
    )
  })
})
