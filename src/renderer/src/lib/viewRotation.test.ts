import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { ROTATION_HINT, ROTATION_KEYS, rotatedTabIndex, type RotationEvent } from './viewRotation'
import { nextTabIndex, stepIndex } from './tabKeyboard'
import { viewShortcutIndex } from './viewShortcut'

/** The sidebar lists five views (Portfolio, Performance, Allocation, Dividends, Trades). */
const COUNT = 5

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
const CSS = readFileSync(join(__dirname, '..', 'app.css'), 'utf8')

/** A `keydown` with nothing held, so each case states only the part it is about. */
function press(key: string, held: Partial<RotationEvent> = {}): RotationEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

describe('rotatedTabIndex', () => {
  it('steps to the next view on Ctrl+Tab', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), 0, COUNT)).toBe(1)
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), 3, COUNT)).toBe(4)
  })

  it('steps to the previous view on Ctrl+Shift+Tab', () => {
    // Shift is the direction here, where the digit accelerator rejects any keystroke carrying it.
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), 4, COUNT)).toBe(3)
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), 1, COUNT)).toBe(0)
  })

  it('wraps at both ends, exactly as arrowing does', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), COUNT - 1, COUNT)).toBe(0)
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), 0, COUNT)).toBe(COUNT - 1)
  })

  it('takes Ctrl on every platform and never Meta', () => {
    // `Cmd`+`Tab` is the macOS application switcher. It does not reach the window, and claiming it
    // would announce a binding the app cannot honour.
    expect(rotatedTabIndex(press('Tab', { metaKey: true }), 0, COUNT)).toBeNull()
    expect(rotatedTabIndex(press('Tab', { metaKey: true, shiftKey: true }), 0, COUNT)).toBeNull()
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, metaKey: true }), 0, COUNT)).toBeNull()
  })

  it('leaves a bare Tab and a Shift+Tab to the browser', () => {
    // The hand-off the roving `tabindex` depends on (DDR-0029): plain Tab has to keep moving focus
    // out of the tablist and into the panel.
    expect(rotatedTabIndex(press('Tab'), 0, COUNT)).toBeNull()
    expect(rotatedTabIndex(press('Tab', { shiftKey: true }), 0, COUNT)).toBeNull()
  })

  it('declines Alt, which is a character on several layouts once Ctrl is held', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, altKey: true }), 0, COUNT)).toBeNull()
  })

  it('declines every key that is not Tab', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', '1', 'a', 'Escape', 'Enter', '']) {
      expect(rotatedTabIndex(press(key, { ctrlKey: true }), 0, COUNT)).toBeNull()
    }
  })

  it('reads the key rather than the position, because Tab produces no character', () => {
    // `code` is right for a digit — on AZERTY the unshifted top row is not digits at all — and
    // says nothing for a key that prints nothing. What the reader strikes is their Tab key.
    expect(rotatedTabIndex({ ...press('Tab', { ctrlKey: true }), key: 'Unidentified' }, 0, COUNT))
      .toBeNull()
  })

  it('returns null when there are no views to rotate between', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), 0, 0)).toBeNull()
  })

  it('stays inside the list even if the selected view is unknown', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), -1, COUNT)).toBe(0)
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), -1, COUNT)).toBe(3)
  })

  it('leaves a single view where it is', () => {
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), 0, 1)).toBe(0)
    expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), 0, 1)).toBe(0)
  })
})

describe('the wrapping arithmetic is reused, not restated', () => {
  it('rotates by the same step the arrow keys move by', () => {
    // One implementation of "next/previous, wrapping". If `stepIndex` ever stopped wrapping, both
    // the tablist's arrows and this rotation would stop together rather than drift apart.
    for (const current of [0, 1, 2, 3, 4]) {
      expect(rotatedTabIndex(press('Tab', { ctrlKey: true }), current, COUNT)).toBe(
        nextTabIndex('ArrowDown', current, COUNT),
      )
      expect(rotatedTabIndex(press('Tab', { ctrlKey: true, shiftKey: true }), current, COUNT)).toBe(
        nextTabIndex('ArrowUp', current, COUNT),
      )
    }
  })

  it('is the tablist module that owns the step, so there is nowhere else to change it', () => {
    expect(stepIndex(4, 1, COUNT)).toBe(0)
    expect(stepIndex(0, -1, COUNT)).toBe(4)
    expect(stepIndex(0, 1, 0)).toBeNull()
    expect(readFileSync(join(__dirname, 'viewRotation.ts'), 'utf8')).toMatch(
      /import \{ stepIndex \} from '\.\/tabKeyboard'/,
    )
  })
})

describe('the tabs pattern is extended, not changed', () => {
  it('rests on nextTabIndex declining Tab, which is now the whole separation', () => {
    // DDR-0083 could say the two handlers never negotiate *because they read different
    // properties* — a digit is `'1'` to one and `'Digit1'` to the other. For Tab both strings are
    // `'Tab'`, so that argument is gone and this decline is what is left holding the two apart.
    // It is asserted from both sides, in this test and in `tabKeyboard.test.ts`.
    expect(nextTabIndex('Tab', 2, COUNT)).toBeNull()
    expect(nextTabIndex('Tab', 0, COUNT)).toBeNull()
    expect(nextTabIndex('Tab', COUNT - 1, COUNT)).toBeNull()
  })

  it('leaves the tablist keys to the tablist and the digits to the accelerator', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(rotatedTabIndex(press(key, { ctrlKey: true }), 0, COUNT)).toBeNull()
    }
    // And the digit accelerator declines this one, from its own side and in both directions.
    const held = { ctrlKey: true, metaKey: false, altKey: false }
    expect(viewShortcutIndex({ code: 'Tab', shiftKey: false, ...held }, COUNT)).toBeNull()
    expect(viewShortcutIndex({ code: 'Tab', shiftKey: true, ...held }, COUNT)).toBeNull()
  })

  it('shares the accelerator’s listener, its text-entry guard and its landing spot', () => {
    const listener = APP.match(
      /const onKeyDown = \(event: KeyboardEvent\): void => \{[\s\S]*?\n {4}\}/,
    )?.[0]
    expect(listener, 'the accelerator listener must exist').toBeDefined()
    // Two bindings are not a shortcut table (DDR-0083's stated risk): the rotation sits beside the
    // digits, after the same guard, and both answers land at one `selectAndFocus`.
    expect(listener!.indexOf('isTextEntry')).toBeLessThan(listener!.indexOf('rotatedTabIndex'))
    expect(listener!.match(/preventDefault/g)).toHaveLength(1)
    expect(listener!.match(/selectAndFocus\(/g)).toHaveLength(1)
  })

  it('rotates from the selected view rather than from a stale one', () => {
    // The rotation reads `tab`, so the effect has to be re-seated when `tab` changes. Without it
    // every rotation would step from whichever view was selected when the listener was attached.
    expect(APP).toMatch(/window\.removeEventListener\('keydown', onKeyDown\)\s*\n\s*\}, \[selectAndFocus, tab\]\)/)
  })
})

describe('the binding is disclosed where a binding with no destination can be', () => {
  it('hangs on the label that names the whole list, not on any row', () => {
    // A rotation has no destination, so DDR-0083's per-row tooltip does not extend to it. The
    // "Views" label is the one element standing for the views collectively.
    expect(APP).toMatch(/<p className="app-nav-label" id=\{NAV_LABEL_ID\} title=\{ROTATION_HINT\}>/)
    expect(APP).not.toMatch(/navRowTitle\([^)]*ROTATION/)
  })

  it('does not become a second name for the tablist it labels', () => {
    // An `aria-labelledby` target contributes its content, and a `title` is consulted only where
    // there is no content to take a name from — so the tablist is still named "Views".
    expect(APP).toMatch(/<p className="app-nav-label"[^>]*>\s*Views\s*<\/p>/)
    expect(APP).not.toMatch(/aria-labelledby=\{NAV_LABEL_ID\}[\s\S]{0,200}aria-label=/)
  })

  it('carries the same fact in the attribute the platform has for it, on the tablist', () => {
    // On the tablist because that is the element the rotation acts upon; the rows keep their own
    // `aria-keyshortcuts` for the digit that reaches each of them.
    expect(APP).toMatch(/role="tablist"[\s\S]{0,400}aria-keyshortcuts=\{ROTATION_KEYS\}/)
    expect(APP).toMatch(/aria-keyshortcuts=\{viewShortcutKeys\(index\)\}/)
  })

  it('states one modifier because only one is accepted', () => {
    // `viewShortcutKeys` lists `Meta` beside `Control` because a digit really does take either.
    // This one does not, and announcing `Meta+Tab` would name the macOS application switcher.
    expect(ROTATION_KEYS).toBe('Control+Tab Control+Shift+Tab')
    expect(ROTATION_KEYS).not.toMatch(/Meta/)
    expect(ROTATION_HINT).toBe('Ctrl+Tab next view, Ctrl+Shift+Tab previous')
    expect(ROTATION_HINT).not.toMatch(/Cmd/)
  })

  it('adds no furniture to the sidebar: an attribute, not a mark', () => {
    // The same call DDR-0083 made when the drawn digits were withdrawn — the primary navigation
    // does not carry permanent weight for something a reader learns once. So nothing renders the
    // hint as content, and `app.css` gains no rule for it.
    expect(APP).not.toMatch(/>\s*\{ROTATION_HINT\}/)
    expect(CSS).not.toMatch(/app-nav-hint|app-nav-shortcut/)
  })
})
