import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLLAPSIBLE_LEVELS,
  COLLAPSIBLE_PARTS,
  collapsibleClassName,
  collapsibleMarkerClassName,
  collapsiblePartClassName,
  DEFAULT_COLLAPSIBLE_LEVEL,
  headingFor,
  triggerAria,
} from './collapsibleVariants'

/**
 * The `Collapsible` contract (Story #308, DDR-0106).
 *
 * The same two halves every primitive's guard test carries (DDR-0032 … DDR-0036), plus the third
 * this one needs: a level with no rule behind it renders as an unstyled row and nothing else in
 * the toolchain notices, and a primitive that quietly re-declares a focus ring, a `:disabled`
 * state or a surface of its own is how the shared rules stop being shared.
 *
 * The stylesheet is read rather than trusted, and comments are stripped before any "is absent"
 * assertion — the primitive's own comment block names the things it does *not* do, which is
 * exactly the documentation worth keeping and would otherwise fail the test (DDR-0042, DDR-0075).
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const TSX = readFileSync(new URL('../components/ui/Collapsible.tsx', import.meta.url), 'utf8')

/** The stylesheet and the component with their comments removed. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
const CODE = TSX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every `.collapsible*` rule body in the stylesheet, comments already gone. */
const COLLAPSIBLE_RULES = [...RULES.matchAll(/^\.collapsible[\w-]*[^{]*\{([^}]*)\}/gm)].map(
  (match) => match[1] ?? '',
)

/** Whether the stylesheet declares a rule whose selector starts with this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^\\s*\\${selector}[\\s,:{[]`, 'm').test(CSS)
}

describe('collapsibleClassName', () => {
  it('composes base and level, which is the wrapper’s whole job', () => {
    expect(collapsibleClassName('group')).toBe('collapsible collapsible-group')
    expect(collapsibleClassName('section')).toBe('collapsible collapsible-section')
  })

  it('defaults to a section — five of #310’s six call sites are one', () => {
    expect(DEFAULT_COLLAPSIBLE_LEVEL).toBe('section')
    expect(collapsibleClassName()).toBe(`collapsible collapsible-${DEFAULT_COLLAPSIBLE_LEVEL}`)
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(collapsibleClassName('group', 'profile-collapsible')).toBe(
      'collapsible collapsible-group profile-collapsible',
    )
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(collapsibleClassName('section', undefined)).toBe('collapsible collapsible-section')
    expect(collapsibleClassName('section', '')).toBe('collapsible collapsible-section')
  })
})

describe('collapsiblePartClassName', () => {
  it('names each part once, with no level in it', () => {
    expect(collapsiblePartClassName('head')).toBe('collapsible-head')
    expect(collapsiblePartClassName('trigger')).toBe('collapsible-trigger')
    expect(collapsiblePartClassName('panel')).toBe('collapsible-panel')
  })

  it('appends a caller’s className last', () => {
    expect(collapsiblePartClassName('action', 'profile-actions')).toBe(
      'collapsible-action profile-actions',
    )
  })
})

describe('collapsibleMarkerClassName', () => {
  /**
   * The state modifier, not a second axis — the same shape `toggle-item-active` has (DDR-0036).
   * Closed is the bare class on purpose: the rotation belongs to the state that turns the glyph.
   */
  it('adds the open modifier only when open', () => {
    expect(collapsibleMarkerClassName(false)).toBe('collapsible-marker')
    expect(collapsibleMarkerClassName(true)).toBe('collapsible-marker collapsible-marker-open')
  })

  it('appends a caller’s className last', () => {
    expect(collapsibleMarkerClassName(false, 'wide')).toBe('collapsible-marker wide')
  })
})

describe('headingFor', () => {
  /**
   * The level carries the document outline as well as the type step, because the two values exist
   * precisely because one nests inside the other. A `group` drawing an `h3` beside a `section`'s
   * `h3` would be an outline disagreeing with the picture.
   */
  it('puts a group one heading level above the sections it encloses', () => {
    expect(headingFor('group')).toBe('h2')
    expect(headingFor('section')).toBe('h3')
  })

  it('answers for the default level too, so a callless heading is never undefined', () => {
    expect(headingFor()).toBe(headingFor(DEFAULT_COLLAPSIBLE_LEVEL))
  })
})

describe('triggerAria', () => {
  it('states the state and names the panel, which is the whole disclosure contract', () => {
    expect(triggerAria(true, 'panel-1')).toEqual({
      'aria-expanded': true,
      'aria-controls': 'panel-1',
    })
    expect(triggerAria(false, 'panel-2')).toEqual({
      'aria-expanded': false,
      'aria-controls': 'panel-2',
    })
  })
})

describe('the stylesheet backs every declared level and part', () => {
  it.each(COLLAPSIBLE_LEVELS)('declares a head rule for level "%s"', (level) => {
    expect(declaresRule(`.collapsible-${level}`)).toBe(true)
  })

  it.each(COLLAPSIBLE_PARTS)('declares a rule for the "%s" part', (part) => {
    expect(declaresRule(`.collapsible-${part}`)).toBe(true)
  })

  it('declares the wrapper and both marker states', () => {
    expect(CSS).toMatch(/^\.collapsible \{/m)
    expect(CSS).toMatch(/^\.collapsible-marker \{/m)
    expect(CSS).toMatch(/^\.collapsible-marker-open \{/m)
  })

  it('makes the head’s type the level’s own declaration, from the type scale', () => {
    const head = /^\.collapsible-heading \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(head).not.toContain('font-size')
    expect(/^\.collapsible-group \.collapsible-heading \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'font-size: var(--text-md)',
    )
    expect(
      /^\.collapsible-section \.collapsible-heading \{([^}]*)\}/m.exec(CSS)?.[1] ?? '',
    ).toContain('font-size: var(--text-sm)')
  })

  /**
   * The half of `hidden` that is easy to lose: the panel declares a `display`, so without the
   * attribute rule beneath it a "closed" section stays on screen and in the tab order, and every
   * other assertion here still passes.
   */
  it('lets the hidden attribute win over the panel’s own display', () => {
    expect(/^\.collapsible-panel\[hidden\] \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'display: none',
    )
  })

  it('draws the marker’s turn from the motion scale, so reduced motion reaches it', () => {
    const marker = /^\.collapsible-marker \{([^}]*)\}/m.exec(CSS)?.[1] ?? ''
    expect(marker).toContain('transition: transform var(--duration-fast) var(--ease-out)')
    expect(/^\.collapsible-marker-open \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'transform: rotate(90deg)',
    )
  })
})

describe('the shared rules keep what they own', () => {
  it('found the primitive’s rules at all, so the assertions below are not vacuous', () => {
    expect(COLLAPSIBLE_RULES.length).toBeGreaterThan(0)
  })

  it('leaves the focus ring to the base rule, so no collapsible can ring differently', () => {
    expect(COLLAPSIBLE_RULES.filter((body) => body.includes('outline'))).toEqual([])
  })

  it('declares no disabled state — a collapsible is never disabled', () => {
    expect(RULES).not.toMatch(/\.collapsible[\w-]*:disabled/)
  })

  /**
   * The primitive paints nothing: the surface behind it is the card's (DDR-0033), which is what
   * lets #310 wrap five existing sections without any of them changing shape. A background token
   * appearing here is that decision being quietly reversed.
   */
  it('paints no surface of its own', () => {
    const surfaces = ['var(--card)', 'var(--bg)', 'var(--surface-raised)']
    for (const body of COLLAPSIBLE_RULES) {
      for (const surface of surfaces) expect(body).not.toContain(surface)
    }
    expect(COLLAPSIBLE_RULES.filter((body) => body.includes('border-radius'))).toEqual([])
  })
})

describe('the component keeps the disclosure contract it cannot express in CSS', () => {
  it('generates the panel id per instance (DDR-0035’s reason, six on one page)', () => {
    expect(CODE).toContain('useId()')
    expect(CODE).not.toMatch(/\bid\?:/)
  })

  it('states expanded and names the panel through the one helper', () => {
    expect(CODE).toContain('triggerAria(open, panelId)')
    expect(CODE).toContain('id={panelId}')
  })

  it('hides the panel rather than unmounting it, so an unsaved edit survives', () => {
    expect(CODE).toContain('hidden={!open}')
    expect(CODE).not.toMatch(/open \?\s*\(?\s*children/)
  })

  it('types its trigger as a button, so a collapsible inside a form submits nothing', () => {
    expect(CODE).toContain('type="button"')
  })

  it('keeps the marker out of the accessible name', () => {
    expect(CODE).toContain('aria-hidden="true"')
  })
})

/**
 * The native disclosure, rejected and staying rejected.
 *
 * `<details>`/`<summary>` is the obvious cheaper answer and the app's focus ring even anticipates
 * it — `summary` is one of the six selectors in the base rule. It loses on the two things #310
 * actually needs: the open state is a DOM property the UA toggles *before* React hears about it,
 * so nothing in the app can be the source of truth for it, and `summary` cannot hold a control
 * beside its label without nesting one interactive element inside another. Left unpinned, the
 * next section that wants to fold would reach for it, and the page would carry two disclosures
 * that behave differently.
 */
describe('the native disclosure stays rejected', () => {
  /** Every component in the renderer, so this catches a second disclosure wherever it lands. */
  const COMPONENTS = new URL('../components/', import.meta.url)
  const SOURCES = readdirSync(COMPONENTS, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => readFileSync(new URL(entry, COMPONENTS), 'utf8'))

  it('read the components, so the assertion below is not vacuous', () => {
    expect(SOURCES.length).toBeGreaterThan(10)
  })

  it.each(['<details', '<summary'])('%s appears in no component', (tag) => {
    expect(SOURCES.filter((source) => source.includes(tag))).toEqual([])
  })

  it('declares no details or summary rule in the stylesheet', () => {
    expect(RULES).not.toMatch(/^\s*(details|summary)[\s,:{]/m)
  })
})
