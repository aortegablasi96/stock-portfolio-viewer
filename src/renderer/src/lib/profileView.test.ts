import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTROL_KINDS } from './fieldVariants'
import { STYLE_TAGS, TARGET_DIMENSIONS } from '@shared/domain/investorProfileTerms'

/**
 * The Profile view's composition (Story #280, DDR-0094).
 *
 * No module under test — the subject is `ProfileView.tsx`, `ProfileTargets.tsx` and the tab
 * markup in `App.tsx`, the same shape as `tabIcons.test.ts` and `analyticsShell.test.ts`. It has
 * to be a text guard for the same reason: Vitest runs Node-only with no jsdom (DDR-0029), so no
 * component may be rendered, and the only place that could observe the real DOM is `e2e/`, which
 * CI does not run.
 *
 * What it protects is the four things about this page that are *decisions* and would otherwise
 * have nothing behind them: that the page is not an analytics view wearing the shell, that its
 * controls are the app's primitives rather than raw elements, that nothing about the profile
 * leaves the machine in this story, and that the row exists in the tablist at all.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * The source with its comments removed — the trap DDR-0042, DDR-0047, DDR-0048, DDR-0058 and
 * DDR-0070 each record. Both files below explain at length exactly what they must not contain,
 * so an unstripped read passes off the sentence saying a thing is absent.
 */
const strip = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const VIEW = strip(read('../components/ProfileView.tsx'))
const TARGETS = strip(read('../components/ProfileTargets.tsx'))
const APP = strip(read('../App.tsx'))
const CSS = strip(read('../app.css'))

describe('the Profile row exists in the one tablist', () => {
  /**
   * It goes in the list rather than into a settings surface because it is a page, and the
   * tablist is already a complete, tested, accessible way to reach one (DDR-0029, DDR-0055).
   */
  it('is declared as a tab with its own icon', () => {
    expect(APP).toMatch(/id: 'profile', label: 'Profile', icon: ProfileIcon/)
  })

  /** Last, so the five data views stay contiguous. */
  it('is the last row', () => {
    const ids = [...APP.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1])
    expect(ids).toEqual([
      'portfolio',
      'performance',
      'allocation',
      'dividends',
      'trades',
      'profile',
    ])
  })

  /**
   * The accelerators needed no change, and this is what would notice if someone "fixed" them by
   * hand: both derive from the row's index and the list's length, so a sixth row is `Ctrl`+`6`
   * and the rotation wraps over six with nothing written down (DDR-0083, DDR-0090).
   */
  it('reaches both accelerators through TABS.length rather than a written-down count', () => {
    expect(APP).toContain('viewShortcutIndex(event, TABS.length)')
    expect(APP).toMatch(/rotatedTabIndex\(\s*event,[\s\S]{0,120}?TABS\.length,/)
    expect(APP).toContain('nextTabIndex(\n        event.key,')
  })

  /**
   * It stays mounted like the four analytics views, which is what lets a half-finished profile
   * survive a trip to Allocation and back. Portfolio is still the one exception (DDR-0027).
   */
  it('renders through the mounted-once panel helper, not as a live-reading exception', () => {
    expect(APP).toContain("panel('profile', <ProfileView />)")
    expect(APP).not.toMatch(/tab === 'profile' &&/)
  })
})

describe('the page is not an analytics view', () => {
  /**
   * `AnalyticsShell` exists for the four-branch `loading | error | needs_import | loaded` guard
   * every analytics view answers (DDR-0043). This page answers none of it — its content is a form
   * the owner can fill in with nothing imported at all — so it owns its own page box, and
   * `analyticsShell.test.ts`'s guard deliberately does not cover it.
   */
  it('declares its own page box rather than wearing the shell', () => {
    expect(VIEW).toContain('<main className="dashboard">')
    expect(VIEW).not.toContain('<AnalyticsShell')
    expect(VIEW).not.toContain('<NeedsImport')
  })

  /** It shares the one page header, though — the title and provenance every view opens with. */
  it('opens with the shared page header and no heading of its own', () => {
    expect(VIEW).toContain('<PageHeader')
    expect(VIEW).not.toContain('<h1')
  })

  /**
   * A `needs_import` allocation is not an error here, it is a portfolio the app has never seen.
   * The view must read the report where it exists and carry on where it does not.
   */
  it('treats an unimported portfolio as no suggestions rather than as a failure', () => {
    expect(VIEW).toContain("allocation.state.result.status === 'ok'")
    expect(VIEW).not.toContain("=== 'needs_import'")
  })
})

describe('the controls are the app’s primitives', () => {
  it.each([
    ['TermInput', TARGETS],
    ['PercentInput', TARGETS],
    ['Field', TARGETS],
    ['ToggleGroup', VIEW],
    ['ConfirmAction', VIEW],
  ])('uses %s', (primitive, source) => {
    expect(source).toContain(`<${primitive}`)
  })

  /**
   * The key is **suggested, never constrained** (DDR-0094). A `<select>` was the first shape and
   * could express neither of the two things the story requires of it: a currency the owner
   * anticipates but does not hold, and — on a fresh install, which holds nothing — any target at
   * all. `TermInput` is a `<datalist>`, so a term can always be typed.
   */
  it('suggests the vocabulary rather than restricting the key to it', () => {
    expect(TARGETS).not.toContain('<Select')
    expect(read('../components/ui/TermInput.tsx')).toContain('<datalist')
  })

  /**
   * A raw control would ship without the shared box, the shared hover, the shared disabled
   * treatment and — worst — without the focus ring, which is supplied by a zero-specificity
   * `:where()` base rule the primitives are inside of (DDR-0035).
   */
  it.each([TARGETS, VIEW])('declares no bare input or select', (source) => {
    expect(source).not.toMatch(/<input\b/)
    expect(source).not.toMatch(/<select\b/)
    expect(source).not.toMatch(/type="number"/)
  })

  /** The app confirms destructive actions in place; no modal, no `window.confirm` (DDR-0012). */
  it('confirms the clear in place', () => {
    expect(VIEW).not.toContain('window.confirm')
    expect(VIEW).not.toContain('<dialog')
  })

  /**
   * `Field` owns its own id through `useId()` and takes no `id` prop, which is exactly what makes
   * a repeated row safe: the Profile tab stays mounted, so every row's label is in the document
   * at once and a fixed id would name only the first (DDR-0035).
   */
  it('never hands Field an id of its own', () => {
    expect(TARGETS).not.toMatch(/<Field[^>]*\sid=/)
  })

  /**
   * Two control kinds arrived with this page, and each needs a rule behind it like the two that
   * came before — a kind with no rule renders as an unstyled input and nothing else in the
   * toolchain notices (DDR-0035). `fieldVariants.test.ts` asserts the same over the whole union;
   * this names the two the story added, so deleting one from the union does not quietly pass.
   */
  it.each(['percent', 'term'])('backs the "%s" kind with a stylesheet rule', (kind) => {
    expect(CONTROL_KINDS).toContain(kind)
    expect(CSS).toContain(`\n.control-${kind} {`)
  })
})

describe('every dimension and tag the domain declares reaches the page', () => {
  it.each(TARGET_DIMENSIONS)('renders a target section for "%s"', (dimension) => {
    expect(VIEW).toContain(`dimension="${dimension}"`)
  })

  /**
   * The five tags are rendered from `STYLE_TAGS` rather than listed here, so a tag added to the
   * domain cannot be forgotten by the form. What this asserts is that the mapping is over the
   * constant — writing the five out would pass an "every tag appears" check and still drift.
   */
  it('renders the tags from the constant rather than from a list of its own', () => {
    expect(VIEW).toContain('STYLE_TAGS.map((tag)')
    expect(VIEW).toContain('STYLE_TAG_LABELS[tag]')
    for (const tag of STYLE_TAGS) expect(VIEW).not.toContain(`'${tag}'`)
  })

  /** Multi-select, because none is required and several may hold at once. */
  it('offers the tags as a multi-select group, never a tablist (DDR-0036)', () => {
    expect(VIEW).toContain('mode="multiple"')
    expect(VIEW).not.toContain('role="tab"')
  })
})

/**
 * The story's own boundary: *nothing about the profile reaches the model here.* It is stored and
 * shown; who reads it is a later story's concern, and until #282 and #283 land there is no
 * consent and no gateway to reach through.
 */
describe('nothing about the profile leaves the machine', () => {
  it.each([VIEW, TARGETS])('makes no network call of any kind', (source) => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/)
    expect(source).not.toMatch(/https?:\/\//)
    expect(source.toLowerCase()).not.toContain('openai')
  })

  /** Everything it does reach is the local main process, over the typed bridge. */
  it('reaches storage only through window.api', () => {
    expect(VIEW).toContain('window.api.getInvestorProfile()')
    expect(VIEW).toContain('window.api.saveInvestorProfile(draft)')
    expect(VIEW).toContain('window.api.clearInvestorProfile()')
  })
})
