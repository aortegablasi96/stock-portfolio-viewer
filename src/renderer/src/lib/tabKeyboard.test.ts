import { describe, it, expect } from 'vitest'
import { nextTabIndex, stepIndex } from './tabKeyboard'

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
    //
    // Since Story #259 the Tab case is **load-bearing rather than incidental**. `Ctrl`+`Tab`
    // rotates through the views from a `window` listener (DDR-0090), and for `Tab` — unlike a
    // digit — `event.key` and `event.code` are the same string, so the "the two handlers read
    // different properties" separation DDR-0083 recorded no longer applies. This decline is what
    // keeps them apart. Cross-asserted from the rotation's side in `viewRotation.test.ts`.
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

describe('stepIndex', () => {
  // The wrapping step itself, split out by Story #259 so `Ctrl`+`Tab` moves along the list by the
  // same rule the arrow keys do rather than by a second copy of it (DDR-0090).
  it('moves either way along the list', () => {
    expect(stepIndex(0, 1, COUNT)).toBe(1)
    expect(stepIndex(3, -1, COUNT)).toBe(2)
  })

  it('wraps at both ends', () => {
    expect(stepIndex(COUNT - 1, 1, COUNT)).toBe(0)
    expect(stepIndex(0, -1, COUNT)).toBe(COUNT - 1)
  })

  it('tolerates a current index that is out of range', () => {
    expect(stepIndex(-1, 1, COUNT)).toBe(0)
    expect(stepIndex(COUNT, 1, COUNT)).toBe(1)
  })

  it('returns null when there is nothing to step between', () => {
    expect(stepIndex(0, 1, 0)).toBeNull()
    expect(stepIndex(0, -1, -3)).toBeNull()
  })

  it('is what the arrow keys answer with, not a parallel implementation', () => {
    for (const current of [0, 2, COUNT - 1]) {
      expect(nextTabIndex('ArrowDown', current, COUNT)).toBe(stepIndex(current, 1, COUNT))
      expect(nextTabIndex('ArrowUp', current, COUNT)).toBe(stepIndex(current, -1, COUNT))
    }
  })
})
