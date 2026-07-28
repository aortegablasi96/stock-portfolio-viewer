import { describe, it, expect } from 'vitest'
import { nextTabIndex } from './tabKeyboard'

// The shell has five tabs (Portfolio, Performance, Allocation, Dividends, Trades).
const COUNT = 5

describe('nextTabIndex', () => {
  it('moves right to the next tab', () => {
    expect(nextTabIndex('ArrowRight', 0, COUNT)).toBe(1)
    expect(nextTabIndex('ArrowRight', 3, COUNT)).toBe(4)
  })

  it('moves left to the previous tab', () => {
    expect(nextTabIndex('ArrowLeft', 4, COUNT)).toBe(3)
    expect(nextTabIndex('ArrowLeft', 1, COUNT)).toBe(0)
  })

  it('wraps from the last tab to the first', () => {
    expect(nextTabIndex('ArrowRight', COUNT - 1, COUNT)).toBe(0)
  })

  it('wraps from the first tab to the last', () => {
    expect(nextTabIndex('ArrowLeft', 0, COUNT)).toBe(COUNT - 1)
  })

  it('jumps to the first tab on Home and the last on End', () => {
    expect(nextTabIndex('Home', 3, COUNT)).toBe(0)
    expect(nextTabIndex('End', 1, COUNT)).toBe(COUNT - 1)
  })

  it('ignores keys the tablist does not own', () => {
    // Up/Down belong to a vertical tablist; this one is a single row. Tab must stay the
    // browser's, or the roving tabindex would have nothing to hand off to.
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'a', 'PageDown', 'Escape']) {
      expect(nextTabIndex(key, 2, COUNT)).toBeNull()
    }
  })

  it('returns null when there are no tabs to move between', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull()
    expect(nextTabIndex('Home', 0, 0)).toBeNull()
  })

  it('stays inside the tablist even if the active tab index is unknown', () => {
    // Defensive: a caller that can't find the active tab still gets a usable landing spot
    // rather than an index pointing at nothing.
    expect(nextTabIndex('ArrowRight', -1, COUNT)).toBe(0)
    expect(nextTabIndex('ArrowLeft', -1, COUNT)).toBe(3)
  })

  it('leaves a single tab where it is', () => {
    expect(nextTabIndex('ArrowRight', 0, 1)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 1)).toBe(0)
    expect(nextTabIndex('End', 0, 1)).toBe(0)
  })
})
