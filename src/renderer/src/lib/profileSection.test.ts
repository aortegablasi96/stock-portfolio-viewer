import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTROL_KINDS } from './fieldVariants'
import { COLLAPSIBLE_LEVELS } from './collapsibleVariants'
import { STYLE_TAGS, TARGET_DIMENSIONS } from '@shared/domain/investorProfileTerms'

/**
 * The investor profile's composition, now that it is a **section of the Assistant view** rather
 * than a view of its own (Story #280, DDR-0094; Story #310, DDR-0108).
 *
 * No module under test — the subject is `ProfileSection.tsx`, `ProfileTargets.tsx`,
 * `AssistantView.tsx` and the tab markup in `App.tsx`, the same shape as `tabIcons.test.ts` and
 * `analyticsShell.test.ts`. It has to be a text guard for the same reason: Vitest runs Node-only
 * with no jsdom (DDR-0029), so no component may be rendered, and the only place that could observe
 * the real DOM is `e2e/`, which CI does not run.
 *
 * What it protects is what is *decided* about this page and would otherwise have nothing behind
 * it: that the profile has stopped being a row and a page, that it folds through the app's one
 * disclosure primitive rather than through six hand-written ones, that its controls are the app's
 * primitives rather than raw elements, and that nothing about the profile leaves the machine.
 */

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * The source with its comments removed — the trap DDR-0042, DDR-0047, DDR-0048, DDR-0058 and
 * DDR-0070 each record. Every file below explains at length exactly what it must not contain,
 * so an unstripped read passes off the sentence saying a thing is absent.
 */
const strip = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const SECTION = strip(read('../components/ProfileSection.tsx'))
const TARGETS = strip(read('../components/ProfileTargets.tsx'))
const ASSISTANT = strip(read('../components/AssistantView.tsx'))
const APP = strip(read('../App.tsx'))
const CSS = strip(read('../app.css'))

describe('the profile is a section of the Assistant view, not a row of its own', () => {
  /**
   * Six rows, and the sixth is the Assistant. The order is still the app's own grammar — five
   * views of the data, then the surface that talks about it — and the policy the owner sets over
   * it now sits *inside* that surface rather than beside it (DDR-0108).
   */
  it('leaves six rows, ending at the Assistant', () => {
    const ids = [...APP.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1])
    expect(ids).toEqual([
      'portfolio',
      'performance',
      'allocation',
      'dividends',
      'trades',
      'assistant',
    ])
  })

  /** The row and its glyph are gone together — a dead icon is a row waiting to be restored. */
  it('declares no Profile row and no icon for one', () => {
    expect(APP).not.toContain("id: 'profile'")
    expect(APP).not.toContain('ProfileIcon')
    expect(strip(read('../components/TabIcons.tsx'))).not.toContain('ProfileIcon')
  })

  /**
   * The accelerators needed no change, and this is what would notice if someone "fixed" them by
   * hand: both derive from the row's index and the list's length, so removing a row renumbers
   * nothing that is written down (DDR-0083, DDR-0090).
   */
  it('reaches both accelerators through TABS.length rather than a written-down count', () => {
    expect(APP).toContain('viewShortcutIndex(event, TABS.length)')
    expect(APP).toMatch(/rotatedTabIndex\(\s*event,[\s\S]{0,120}?TABS\.length,/)
    expect(APP).toContain('nextTabIndex(\n        event.key,')
  })

  /**
   * The Assistant stays mounted like the four analytics views, which is what lets a half-finished
   * profile *and* a transcript survive a trip to Allocation and back. Portfolio is still the one
   * exception (DDR-0027).
   */
  it('renders through the mounted-once panel helper, not as a live-reading exception', () => {
    expect(APP).toContain("panel('assistant', <AssistantView displayCurrency={displayCurrency} />)")
    expect(APP).not.toMatch(/tab === 'assistant' &&/)
  })

  /**
   * The profile comes first, which is the whole shape of the merge. It was *above* the
   * conversation until Story #343 and is *beside* it now — the design's left column (DDR-0115) —
   * and the ordering claim survives the change because the columns are in the same source order
   * the stack was.
   */
  it('draws the profile before the conversation, inside the one view', () => {
    expect(ASSISTANT).toMatch(/<ProfileSection\s+onWritten=\{onProfileWritten\}/)
    expect(ASSISTANT.indexOf('<ProfileSection')).toBeLessThan(
      ASSISTANT.indexOf('<AssistantConversation'),
    )
  })
})

describe('the section brings no page of its own', () => {
  /**
   * The page box, the heading and the provenance line belong to the view above it now. Two
   * `<main>`s in one panel would be two documents, and the header the profile used to carry is
   * the one the Assistant already had (DDR-0058, DDR-0094).
   */
  it('declares no main, no page header and no heading', () => {
    expect(SECTION).not.toContain('<main')
    expect(SECTION).not.toContain('<PageHeader')
    expect(SECTION).not.toContain('<h1')
    expect(SECTION).not.toContain('<AnalyticsShell')
  })

  /**
   * And the view around it still holds the `<main>` and the `<h1>`. What it no longer holds is a
   * `PageHeader`: Story #343 took the design's, which has none, and deleted `OWNER_SOURCE` with
   * it (DDR-0115 amendment 1). The heading is the design's eyebrow now, and
   * `assistantLayout.test.ts` owns that pair — asserted here only as the absence, which is the
   * half this file was already about.
   */
  it('leaves the view holding the main and the h1, and no page header', () => {
    expect(ASSISTANT).toContain('<main className="assistant-view">')
    expect(ASSISTANT).toContain('<h1')
    expect(ASSISTANT).not.toContain('<PageHeader')
    expect(ASSISTANT).not.toContain('OWNER_SOURCE')
  })

  /**
   * A `needs_import` allocation is not an error here, it is a portfolio the app has never seen.
   * The section must read the report where it exists and carry on where it does not.
   */
  it('treats an unimported portfolio as no suggestions rather than as a failure', () => {
    expect(SECTION).toContain("allocation.state.result.status === 'ok'")
    expect(SECTION).not.toContain("=== 'needs_import'")
  })
})

describe('it folds through the one disclosure primitive', () => {
  /**
   * Five surfaces, and they are the profile's five *sections*.
   *
   * There were six: an outer `group` `Collapsible` held the profile as a whole, which is what
   * #308 built the `level` axis for (DDR-0106). Story #343 gave the profile its own column, and
   * that column folds — so the group's fold is the column's now, and keeping both would be a fold
   * inside a fold (DDR-0115). The axis keeps its two values; only this call site stopped reaching
   * the second one.
   */
  it('uses a Collapsible for every section, and none for the whole', () => {
    const inSection = [...SECTION.matchAll(/<Collapsible\b/g)].length
    const inTargets = [...TARGETS.matchAll(/<Collapsible\b/g)].length
    // Three of the five sections are the one `ProfileTargets` component, drawn three times.
    // **Two here rather than three since Story #347**: Clear the profile stopped being a
    // disclosure. The five that fold each hold a form; that one holds a button, so a fold would
    // have hidden a control behind a click revealing nothing else.
    expect(inSection).toBe(2)
    expect(inTargets).toBe(1)
    expect(SECTION).not.toContain('level="group"')
  })

  /**
   * **Four of the five arrive closed since Story #347**, which is the design's own reading: five
   * open disclosures in a 420px column is a scroller that has to be walked before the shape of the
   * profile is visible. `Collapsible`'s default is untouched — these are *call sites* opting out
   * of it, which is what the `defaultOpen` prop is for (DDR-0106) — and the one they opt out of it
   * through is a constant rather than a literal, so the four cannot drift apart.
   *
   * Investing style is the exception and takes no prop at all: a tag is one click and needs
   * nothing typed, and it is the part of the profile the head's pill and the rail's dot report.
   */
  it('opens Investing style alone, through one named constant', () => {
    expect(SECTION).not.toContain('defaultOpen={true}')
    expect(TARGETS).not.toContain('defaultOpen={true}')
    expect([...SECTION.matchAll(/defaultOpen=\{SECTION_OPEN_ON_ARRIVAL\}/g)]).toHaveLength(1)
    expect([...TARGETS.matchAll(/defaultOpen=\{SECTION_OPEN_ON_ARRIVAL\}/g)]).toHaveLength(1)
    // The two `Collapsible`s in this file are Investing style and the position band; the band is
    // the one carrying the prop, so the style section is the one that does not.
    expect(SECTION).toMatch(/<Collapsible label="Investing style">/)
  })

  /**
   * The `level` axis still declares both values and `app.css` still backs both, which is the half
   * that matters: `group` is the level a future call site takes, and a value with no rule renders
   * as an unstyled heading with nothing in the toolchain noticing (DDR-0106).
   */
  it.each(COLLAPSIBLE_LEVELS)('backs the "%s" level with a stylesheet rule', (level) => {
    expect(CSS).toContain(`\n.collapsible-${level} .collapsible-heading {`)
  })

  /**
   * A control belonging to a section goes in the slot beside the trigger, never inside it: a
   * button within a button is invalid markup that renders and then swallows one of the two
   * clicks (DDR-0106). Two of the five sections carry one; the group did too until #343 removed
   * it, and the two that remain are the reason the slot still has to exist.
   */
  it('puts each section’s own control in the action slot', () => {
    expect(TARGETS).toMatch(/action=\{\s*<Button size="sm"/)
    expect(SECTION).toMatch(/action=\{\s*<Button\s+size="sm"/)
    expect(SECTION).not.toContain('<CardHeader')
    expect(TARGETS).not.toContain('<CardHeader')
  })

  /**
   * Everything the owner can *do* to the profile sits with the form it acts on, inside whatever
   * the current fold is. A live region inside a `hidden` subtree announces nothing, so a Save
   * pressable while its answer was hidden would be a press whose reply could not be read
   * (DDR-0108).
   *
   * That was the group panel until Story #343 and is the whole column now, which makes the claim
   * *stronger* rather than weaker: the fold takes the buttons and their notice together, so there
   * is no head row left that stays pressable while the panel under it is shut.
   *
   * **Story #347 raises both into the head and they move together**, which is the half that would
   * have been easy to get wrong. A head that kept the buttons while leaving their answer down in
   * the scroller is #310's bug with a longer scroll in front of it — so the assertion is that the
   * notice is in `.profile-column-head`, above the scroller, and not merely somewhere in the file.
   */
  it('folds Save, Discard and the notice away with the form, and keeps the three together', () => {
    expect(SECTION).toMatch(/<div className="profile-column-body" hidden=\{hidden\}>/)
    const head = SECTION.indexOf('className="profile-column-head"')
    const scroller = SECTION.indexOf('className="profile-column-sections"')
    expect(head).toBeGreaterThan(0)
    expect(scroller).toBeGreaterThan(head)
    for (const part of ['className="profile-actions"', 'profile-notice']) {
      const at = SECTION.indexOf(part)
      expect(at, part).toBeGreaterThan(head)
      expect(at, part).toBeLessThan(scroller)
    }
    expect(SECTION).toMatch(/className=\{`profile-notice[\s\S]{0,120}?role="status"/)
  })
})

describe('the controls are the app’s primitives', () => {
  it.each([
    ['TermInput', TARGETS],
    ['PercentInput', TARGETS],
    ['Field', TARGETS],
    ['ToggleGroup', SECTION],
    ['ConfirmAction', SECTION],
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
  it.each([TARGETS, SECTION])('declares no bare input or select', (source) => {
    expect(source).not.toMatch(/<input\b/)
    expect(source).not.toMatch(/<select\b/)
    expect(source).not.toMatch(/type="number"/)
  })

  /** The app confirms destructive actions in place; no modal, no `window.confirm` (DDR-0012). */
  it('confirms the clear in place', () => {
    expect(SECTION).not.toContain('window.confirm')
    expect(SECTION).not.toContain('<dialog')
  })

  /**
   * `Field` owns its own id through `useId()` and takes no `id` prop, which is exactly what makes
   * a repeated row safe: the Assistant tab stays mounted, so every row's label is in the document
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
    expect(SECTION).toContain(`dimension="${dimension}"`)
  })

  /**
   * The five tags are rendered from `STYLE_TAGS` rather than listed here, so a tag added to the
   * domain cannot be forgotten by the form. What this asserts is that the mapping is over the
   * constant — writing the five out would pass an "every tag appears" check and still drift.
   */
  it('renders the tags from the constant rather than from a list of its own', () => {
    expect(SECTION).toContain('STYLE_TAGS.map((tag)')
    expect(SECTION).toContain('STYLE_TAG_LABELS[tag]')
    for (const tag of STYLE_TAGS) expect(SECTION).not.toContain(`'${tag}'`)
  })

  /** Multi-select, because none is required and several may hold at once. */
  it('offers the tags as a multi-select group, never a tablist (DDR-0036)', () => {
    expect(SECTION).toContain('mode="multiple"')
    expect(SECTION).not.toContain('role="tab"')
  })
})

/**
 * The story's own boundary: *nothing about the profile reaches the model here.* It is stored and
 * shown; the conversation beside it assembles its own context, and this section has no gateway to
 * reach through. Sharper since #310, not weaker — the two are now on one page, and the only thing
 * that crosses between them is a counter saying the standard changed (DDR-0108).
 */
describe('nothing about the profile leaves the machine', () => {
  it.each([SECTION, TARGETS])('makes no network call of any kind', (source) => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/)
    expect(source).not.toMatch(/https?:\/\//)
    expect(source.toLowerCase()).not.toContain('openai')
  })

  /** Everything it does reach is the local main process, over the typed bridge. */
  it('reaches storage only through window.api', () => {
    expect(SECTION).toContain('window.api.getInvestorProfile()')
    expect(SECTION).toContain('window.api.saveInvestorProfile(draft)')
    expect(SECTION).toContain('window.api.clearInvestorProfile()')
  })
})
