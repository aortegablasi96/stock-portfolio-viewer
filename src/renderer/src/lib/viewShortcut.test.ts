import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  isTextEntry,
  navRowTitle,
  shortcutLabel,
  viewShortcutDigit,
  viewShortcutIndex,
  viewShortcutKeys,
  type ShortcutEvent,
} from './viewShortcut'
import { nextTabIndex } from './tabKeyboard'

/** The sidebar lists five views (Portfolio, Performance, Allocation, Dividends, Trades). */
const COUNT = 5

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
const CSS = readFileSync(join(__dirname, '..', 'app.css'), 'utf8')

/** The two platform strings the tooltip's modifier turns on. */
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const MACOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

/** A `keydown` with nothing held, so each case states only the part it is about. */
function press(code: string, held: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

describe('viewShortcutIndex', () => {
  it('maps Ctrl and a digit to the view that digit names', () => {
    expect(viewShortcutIndex(press('Digit1', { ctrlKey: true }), COUNT)).toBe(0)
    expect(viewShortcutIndex(press('Digit5', { ctrlKey: true }), COUNT)).toBe(4)
  })

  it('accepts Meta as the same gesture, for the platform that spells it that way', () => {
    expect(viewShortcutIndex(press('Digit3', { metaKey: true }), COUNT)).toBe(2)
  })

  it('takes the numpad digit too, since it is the same digit', () => {
    expect(viewShortcutIndex(press('Numpad2', { ctrlKey: true }), COUNT)).toBe(1)
  })

  it('reads the key by position, not by the character the layout produces', () => {
    // The reason this matches `code`: on AZERTY the unshifted top row is `&`, `é`, `"`, `'`, `(`,
    // so a binding read off `event.key` would not exist at all on that keyboard. The digit a
    // reader presses is the one printed on the key in front of them.
    expect(viewShortcutIndex({ ...press('Digit2', { ctrlKey: true }), code: '2' }, COUNT)).toBeNull()
  })

  it('ignores a bare digit, which belongs to whatever has focus', () => {
    expect(viewShortcutIndex(press('Digit1'), COUNT)).toBeNull()
  })

  it('ignores Alt and Shift rather than treating them as noise', () => {
    // Ctrl+Alt is AltGr on a Windows layout and therefore a character on several; Ctrl+Shift+1 is
    // nobody's binding yet and should stay free rather than become a second name for this one.
    expect(viewShortcutIndex(press('Digit1', { ctrlKey: true, altKey: true }), COUNT)).toBeNull()
    expect(viewShortcutIndex(press('Digit1', { ctrlKey: true, shiftKey: true }), COUNT)).toBeNull()
  })

  it('requires exactly one of Ctrl and Meta', () => {
    expect(viewShortcutIndex(press('Digit1', { ctrlKey: true, metaKey: true }), COUNT)).toBeNull()
  })

  it('declines a digit past the last view rather than clamping to it', () => {
    // A guess is worse than nothing: Ctrl+9 on a five-view list meant something else.
    expect(viewShortcutIndex(press('Digit6', { ctrlKey: true }), COUNT)).toBeNull()
    expect(viewShortcutIndex(press('Digit9', { ctrlKey: true }), COUNT)).toBeNull()
  })

  it('declines every non-digit key', () => {
    for (const code of ['KeyA', 'Digit0', 'ArrowDown', 'Home', 'Tab', 'Escape', '']) {
      expect(viewShortcutIndex(press(code, { ctrlKey: true }), COUNT)).toBeNull()
    }
  })

  it('returns null when there are no views to select', () => {
    expect(viewShortcutIndex(press('Digit1', { ctrlKey: true }), 0)).toBeNull()
  })
})

describe('isTextEntry', () => {
  it('keeps the accelerator off the three controls DDR-0035 owns', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
      expect(isTextEntry({ tagName, isContentEditable: false })).toBe(true)
    }
  })

  it('keeps it off anything editable, host or descendant', () => {
    // `isContentEditable` is the computed answer, so a span inside a contenteditable is caught
    // as well as the element carrying the attribute.
    expect(isTextEntry({ tagName: 'SPAN', isContentEditable: true })).toBe(true)
  })

  it('leaves every other target to the app', () => {
    for (const tagName of ['BODY', 'BUTTON', 'DIV', 'TABLE', 'CANVAS', 'SVG']) {
      expect(isTextEntry({ tagName, isContentEditable: false })).toBe(false)
    }
  })

  it('treats a missing target as not text entry', () => {
    expect(isTextEntry(null)).toBe(false)
    expect(isTextEntry(undefined)).toBe(false)
  })
})

describe('the tooltip and the announced binding are one fact', () => {
  it('numbers the rows from one, top to bottom', () => {
    expect([0, 1, 2, 3, 4].map(viewShortcutDigit)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('announces both modifiers, because both are accepted', () => {
    // `aria-keyshortcuts` takes a space-separated list of alternatives, which is exactly what
    // "Ctrl on Windows, Cmd on macOS" is.
    expect(viewShortcutKeys(0)).toBe('Control+1 Meta+1')
    expect(viewShortcutKeys(4)).toBe('Control+5 Meta+5')
  })

  it('writes only the modifier the reader has, because a tooltip is read rather than parsed', () => {
    expect(shortcutLabel(0, WINDOWS)).toBe('Ctrl+1')
    expect(shortcutLabel(0, MACOS)).toBe('Cmd+1')
  })

  it('builds the tooltip from the row name and that binding', () => {
    expect(navRowTitle('Performance', 1, WINDOWS)).toBe('Performance (Ctrl+2)')
    expect(navRowTitle('Trades', 4, MACOS)).toBe('Trades (Cmd+5)')
  })

  it('takes the digit from one place, so the two statements cannot drift', () => {
    // Two copies of "the fifth row is 5" is one chance for the written binding and the announced
    // one to disagree.
    expect(viewShortcutKeys(2)).toContain(`+${viewShortcutDigit(2)}`)
    expect(shortcutLabel(2, WINDOWS)).toContain(viewShortcutDigit(2))
  })
})

describe('the tabs pattern is extended, not changed', () => {
  it('leaves every accelerator key to this module, and every tablist key to the other', () => {
    // The two handlers see the same events. `nextTabIndex` reads `key` and this reads `code`, so
    // a digit's key ('1') is one it declines like any other key it does not own — which is what
    // lets a window-level listener and the tablist's own coexist without either checking for the
    // other (DDR-0029, DDR-0083).
    for (const key of ['1', '2', '3', '4', '5']) {
      expect(nextTabIndex(key, 0, COUNT)).toBeNull()
    }
    for (const code of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(viewShortcutIndex(press(code, { ctrlKey: true }), COUNT)).toBeNull()
    }
  })

  it('keeps the tablist handler on the tablist and puts the accelerator on the window', () => {
    // Reaching the tablist is the problem, so the accelerator cannot be scoped to it.
    expect(APP).toMatch(/window\.addEventListener\('keydown', onKeyDown\)/)
    expect(APP).toMatch(/window\.removeEventListener\('keydown', onKeyDown\)/)
    expect(APP).toMatch(/onKeyDown=\{onTabKeyDown\}/)
  })

  it('asks about text entry before it asks about the key', () => {
    const listener = APP.match(/const onKeyDown = \(event: KeyboardEvent\): void => \{[\s\S]*?\n {4}\}/)?.[0]
    expect(listener, 'the accelerator listener must exist').toBeDefined()
    expect(listener!.indexOf('isTextEntry')).toBeLessThan(listener!.indexOf('viewShortcutIndex'))
    // And it only takes the event once it knows the combination is its own.
    expect(listener).toMatch(/if \(target === null\) return\s*\n[\s\S]{0,200}preventDefault/)
  })

  it('lands focus on the destination row, through the same helper the arrows use', () => {
    // One landing spot, stated once: the panel focus was standing in is about to be `hidden`,
    // which blurs its contents to <body> if nothing moves them first.
    expect(APP).toMatch(/const selectAndFocus = useCallback\(\s*\(id: Tab\): void => \{\s*select\(id\)\s*tabRefs\.current\.get\(id\)\?\.focus\(\)/)
    expect(APP.match(/selectAndFocus\(TABS\[target\]!\.id\)/g)).toHaveLength(2)
  })
})

describe('the binding is stated without becoming a second name', () => {
  it('lives in the row’s title, in both states, and nowhere else on screen', () => {
    expect(APP).toMatch(/title=\{navRowTitle\(t\.label, index, navigator\.userAgent\)\}/)
    // The digits were drawn beside each name for one round and withdrawn (DDR-0083). Nothing in
    // the sidebar renders one now, and no rule is left behind for one.
    expect(APP).not.toMatch(/app-tab-key/)
    expect(CSS).not.toMatch(/app-tab-key/)
  })

  it('leaves the row named by its label alone', () => {
    // A `title` is only consulted for an accessible name when an element has no content to take
    // one from, so the label — clipped rather than removed on the rail — still wins.
    expect(APP).toMatch(/<span className="app-tab-label">\{t\.label\}<\/span>\s*<\/button>/)
    expect(APP).not.toMatch(/role="tab"[\s\S]{0,900}aria-label=/)
  })

  it('carries the binding in the attribute the platform has for it', () => {
    expect(APP).toMatch(/aria-keyshortcuts=\{viewShortcutKeys\(index\)\}/)
  })

  it('reads the platform once, at the only place that writes the modifier', () => {
    // `shortcutLabel` takes the platform as a parameter precisely so this is the single read.
    expect(APP.match(/navigator\./g)).toHaveLength(1)
  })
})
