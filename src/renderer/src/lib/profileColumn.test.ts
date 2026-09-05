import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADD_LIMIT_LABEL,
  ADD_MARK,
  ADD_TARGET_LABEL,
  CLEAR_ROW,
  EMPTY_POSITION_TEXT,
  PROFILE_COLUMN_TITLE,
  REMOVE_LIMIT_LABEL,
  SAVE_LABELS,
  SECTION_OPEN_ON_ARRIVAL,
  emptyTargetsText,
  saveLabel,
  saveVariant,
  styleTagPillClassName,
  styleTagPillLabel,
} from './profileColumn'
import { BUTTON_VARIANTS } from './buttonVariants'
import { TARGET_DIMENSIONS } from '@shared/domain/investorProfileTerms'

/**
 * The profile column's head, its five sections and the wording all of it uses (Story #347,
 * DDR-0115).
 *
 * Two halves, the shape every guard in this directory has: the module's own decisions, and the
 * stylesheet and components they only mean anything against. The head's *geometry* — that it stays
 * put while the sections scroll under it — is `e2e/investor-profile.spec.ts`'s, because a cascade
 * resolving is the one thing a Node-only suite cannot see (DDR-0029).
 */

const strip = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Comments stripped first — the trap DDR-0042, DDR-0047, DDR-0058, DDR-0070 and DDR-0075 record. */
const source = (path: string): string =>
  strip(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

const CSS = source('app.css')
const SECTION = source('components/ProfileSection.tsx')
const TARGETS = source('components/ProfileTargets.tsx')

/** One rule's body, by its selector — comments already stripped. */
const rule = (selector: string): string => {
  const start = CSS.indexOf(`\n${selector} {`)
  expect(start, `${selector} declares no rule`).toBeGreaterThan(0)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('the count beside the title', () => {
  it('is a count, singular at one, in the design’s own format', () => {
    expect(styleTagPillLabel(0)).toBe('0 style tags')
    expect(styleTagPillLabel(1)).toBe('1 style tag')
    expect(styleTagPillLabel(4)).toBe('4 style tags')
  })

  /**
   * The pill and the rail's dot report one number through one predicate. Two readings of "does
   * this profile say anything" are two answers waiting to disagree, which is the argument
   * `onStored` was added under in Story #343.
   */
  it('tones off the same predicate the rail’s dot uses', () => {
    expect(styleTagPillClassName(0)).toContain('assistant-chip-idle')
    expect(styleTagPillClassName(1)).toContain('assistant-chip-live')
    expect(styleTagPillClassName(9)).toContain('assistant-chip-live')
  })

  /**
   * It is the chat header's chip, not a second pill vocabulary one column over (DDR-0115
   * amendment 6). Both tones are rules, or the pill renders unclassed and its inks are measured
   * against a surface it does not stand on.
   */
  it.each(['assistant-chip', 'assistant-chip-live', 'assistant-chip-idle'])(
    'reaches .%s, which app.css declares',
    (name) => {
      expect(CSS).toContain(`\n.${name} {`)
      expect(styleTagPillClassName(1) + styleTagPillClassName(0)).toContain(name)
    },
  )
})

describe('Save says which of its two states it is in', () => {
  it('offers to store while there is something to store, and reports once there is not', () => {
    expect(saveLabel(true)).toBe(SAVE_LABELS.dirty)
    expect(saveLabel(false)).toBe(SAVE_LABELS.clean)
    expect(SAVE_LABELS.dirty).toBe('Save profile')
    expect(SAVE_LABELS.clean).toBe('Saved')
  })

  /** Colour is the `variant` axis's, never `className` (DDR-0032), and both values are real. */
  it('draws the accent fill only while there is something to save', () => {
    expect(saveVariant(true)).toBe('primary')
    expect(saveVariant(false)).toBe('secondary')
    for (const dirty of [true, false]) expect(BUTTON_VARIANTS).toContain(saveVariant(dirty))
  })

  /**
   * The check is a glyph beside the word, never inside it. `✓ Saved` as an accessible name is a
   * reader being told "check mark saved"; the word alone is the whole of the state.
   */
  it('keeps the check mark out of the accessible name', () => {
    expect(SAVE_LABELS.clean).not.toContain('✓')
    expect(SECTION).toContain('aria-hidden="true"')
  })
})

describe('the five sections and their controls', () => {
  /**
   * Four of the five arrive closed, which is a **call site** opting out of `Collapsible`'s default
   * rather than a change to the primitive (DDR-0106). The design opens *Investing style* alone.
   */
  it('opens Investing style alone, and says so through one constant', () => {
    expect(SECTION_OPEN_ON_ARRIVAL).toBe(false)
    expect(TARGETS).toContain('defaultOpen={SECTION_OPEN_ON_ARRIVAL}')
    // Three target sections are one component drawn three times, so the fourth is the position
    // band's — and Investing style is the one `Collapsible` in this file with no `defaultOpen`.
    expect([...SECTION.matchAll(/defaultOpen=\{SECTION_OPEN_ON_ARRIVAL\}/g)]).toHaveLength(1)
    expect([...SECTION.matchAll(/<Collapsible\b/g)]).toHaveLength(2)
  })

  /**
   * The design's `+` is a mark, not a word (`figma_design/src/App.tsx:1999`). Written into the
   * label it would become part of the button's name, and eight "plus add target"s are eight names
   * that start with punctuation.
   */
  it('keeps the plus out of every action’s name', () => {
    expect(ADD_MARK).toBe('+')
    for (const label of [ADD_TARGET_LABEL, ADD_LIMIT_LABEL, REMOVE_LIMIT_LABEL]) {
      expect(label).not.toContain(ADD_MARK)
    }
    expect(ADD_TARGET_LABEL).toBe('Add target')
    expect(ADD_LIMIT_LABEL).toBe('Add limit')
  })

  /**
   * A control belonging to a section goes beside the trigger and never inside it: a button within
   * a button is invalid markup that renders and then swallows one of the two clicks (DDR-0106).
   */
  it('puts every add control in the action slot', () => {
    expect(TARGETS).toMatch(/action=\{\s*<Button size="sm"/)
    expect(SECTION).toMatch(/action=\{\s*<Button\s+size="sm"/)
  })

  /**
   * An unset dimension is a valid profile, so its box states what is true rather than prompting a
   * fix (ADR-0012, DDR-0109). The wording is the design's and the noun is the domain's, so a
   * dimension renamed there cannot leave a sentence naming the old one behind.
   */
  it.each(TARGET_DIMENSIONS)('states "%s" as a policy nobody wrote, not as a gap', (dimension) => {
    expect(emptyTargetsText(dimension)).toMatch(/^No .+ targets — no policy stated here\.$/)
  })

  it('says the same of the position band', () => {
    expect(EMPTY_POSITION_TEXT).toBe('No position limit — no policy stated here.')
  })

  /**
   * The empty box stands on `--surface-raised`, which is a **counted** surface: every ink rendered
   * there is measured there rather than on `--card` (DDR-0069, DDR-0070). `sidebarRail.test.ts`
   * holds the count; this holds the half of the pairing that count cannot see, which is which rule
   * actually adopts the fill.
   */
  it('draws the empty box on the raised surface, italic, as the design does', () => {
    const empty = rule('.profile-empty')
    expect(empty).toContain('background: var(--surface-raised)')
    expect(empty).toContain('font-style: italic')
    expect(empty).toContain('color: var(--muted)')
  })
})

describe('the clear row', () => {
  /**
   * A row rather than a disclosure, and still behind the in-place confirm. DDR-0115 amendment 5
   * took the confirm off Clear chat because a transcript is session state; a profile is stored, so
   * DDR-0012's pattern stays exactly where it was and only its frame changes.
   */
  it('keeps ConfirmAction and its warning', () => {
    expect(SECTION).toMatch(/<ConfirmAction/)
    expect(SECTION).not.toContain('window.confirm')
    expect(SECTION).not.toContain('<dialog')
    expect(CLEAR_ROW.warning).toContain('holdings, snapshots and imported statements are untouched')
  })

  /** Its frame is the design's negative-bordered row, and the tone is a rule rather than a prop. */
  it('is a bordered row toned negative, not a Collapsible', () => {
    expect(SECTION).toContain('className="profile-clear-row"')
    expect(rule('.profile-clear-row')).toMatch(/border:[^;]*var\(--neg\)/)
  })
})

/**
 * The one thing ADR-0009 forbids outright, asserted over every word this column ships.
 *
 * The count is a fact; a profile stating nothing is a portfolio the owner has taken no view on,
 * and the app answers those dimensions from its own published baseline and says whose standard
 * that is (ADR-0012, DDR-0109). Nothing here may read as *finish your profile*, and nothing may
 * name a target for the owner to set.
 */
describe('nothing grades the profile or proposes a policy', () => {
  const WORDS = [
    ...Object.values(SAVE_LABELS),
    PROFILE_COLUMN_TITLE,
    styleTagPillLabel(0),
    styleTagPillLabel(2),
    ADD_TARGET_LABEL,
    ADD_LIMIT_LABEL,
    REMOVE_LIMIT_LABEL,
    EMPTY_POSITION_TEXT,
    ...TARGET_DIMENSIONS.map(emptyTargetsText),
    ...Object.values(CLEAR_ROW),
  ]

  it.each([
    /incomplete/i,
    /\bfinish\b/i,
    /you should/i,
    /we recommend/i,
    /\brecommend/i,
    /\bsuggest/i,
    /complete your/i,
    /\bmissing\b/i,
  ])('never says %s', (forbidden) => {
    for (const word of WORDS) expect(word).not.toMatch(forbidden)
  })

  /** And the column's own prose, which is where a sentence like that would actually be written. */
  it('leaves the same words out of the section itself', () => {
    for (const forbidden of [/incomplete/i, /complete your profile/i, /you should set/i]) {
      expect(SECTION).not.toMatch(forbidden)
    }
  })
})
