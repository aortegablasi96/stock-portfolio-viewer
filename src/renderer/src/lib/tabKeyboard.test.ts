import { describe, it, expect } from 'vitest'
import { nextTabIndex } from './tabKeyboard'

// The sidebar lists five views (Portfolio, Performance, Allocation, Dividends, Trades).
const COUNT = 5

describe('nextTabIndex', () => {
  it('moves down to the next tab', () => {
    expect(nextTabIndex('ArrowDown', 0, COUNT)).toBe(1)
    expect(nextTabIndex('ArrowDown', 3, COUNT)).toBe(4)
  })

  it('moves up to the previous tab', () => {
    expect(nextTabIndex('ArrowUp', 4, COUNT)).toBe(3)
    expect(nextTabIndex('ArrowUp', 1, COUNT)).toBe(0)
  })

  it('wraps from the last tab to the first', () => {
    expect(nextTabIndex('ArrowDown', COUNT - 1, COUNT)).toBe(0)
  })

  it('wraps from the first tab to the last', () => {
    expect(nextTabIndex('ArrowUp', 0, COUNT)).toBe(COUNT - 1)
  })

  it('jumps to the first tab on Home and the last on End', () => {
    expect(nextTabIndex('Home', 3, COUNT)).toBe(0)
    expect(nextTabIndex('End', 1, COUNT)).toBe(COUNT - 1)
  })

  it('ignores keys the tablist does not own', () => {
    // Left/Right belong to a horizontal tablist; this one is a column (Story #182), and it says
    // so with `aria-orientation="vertical"`. Accepting them anyway would make the announced axis
    // a half-truth, and would take a key the focused panel's own controls may want. Tab must stay
    // the browser's, or the roving tabindex would have nothing to hand off to.
    const notOurs = ['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', ' ', 'a', 'PageDown', 'Escape']
    for (const key of notOurs) {
      expect(nextTabIndex(key, 2, COUNT)).toBeNull()
    }
  })

  it('returns null when there are no tabs to move between', () => {
    expect(nextTabIndex('ArrowDown', 0, 0)).toBeNull()
    expect(nextTabIndex('Home', 0, 0)).toBeNull()
  })

  it('stays inside the tablist even if the active tab index is unknown', () => {
    // Defensive: a caller that can't find the active tab still gets a usable landing spot
    // rather than an index pointing at nothing.
    expect(nextTabIndex('ArrowDown', -1, COUNT)).toBe(0)
    expect(nextTabIndex('ArrowUp', -1, COUNT)).toBe(3)
  })

  it('leaves a single tab where it is', () => {
    expect(nextTabIndex('ArrowDown', 0, 1)).toBe(0)
    expect(nextTabIndex('ArrowUp', 0, 1)).toBe(0)
    expect(nextTabIndex('End', 0, 1)).toBe(0)
  })
})
