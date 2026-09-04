import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CHAT_SUBTITLE,
  CHAT_TITLE,
  CLEAR_CHAT_LABEL,
  CLEAR_CHAT_TITLE,
  EDIT_PROFILE_LABEL,
  GATEWAY_CHIP_LABELS,
  GATEWAY_CHIP_TONES,
  PROFILE_CHIP_LABELS,
  chipClassName,
  groundingLine,
  headerChips,
} from './assistantHeader'
import { groundingNotices } from './assistantAsk'
import type { GroundingReports } from './assistantContext'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import { balanceDriftResultSchema } from '@shared/domain/balanceDrift'

/**
 * The chat header and the line above the composer (Story #346, DDR-0115 amendments 3, 5 and 6).
 *
 * What is pinned here is **wording, tone and where a fact lives** — the three things the fold could
 * get wrong in silence. The cascade, the pill's corner and the hover that moves a border to the
 * negative tone are `e2e/assistant-ask.spec.ts`'s, which has a layout engine; this file has the
 * decisions, which is the same division every other `lib/` guard in this view makes (DDR-0029).
 */

const PROFILE: InvestorProfile = {
  ...EMPTY_INVESTOR_PROFILE,
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
}

const grounding = (over: Partial<GroundingReports> = {}): GroundingReports => ({
  allocation: { status: 'needs_import' },
  profile: PROFILE,
  drift: { status: 'no_data' },
  performance: { status: 'needs_import' },
  ...over,
})

/** Everything readable: the state the header has nothing left to report a gap about. */
const complete = (over: Partial<GroundingReports> = {}): GroundingReports =>
  grounding({
    allocation: { status: 'ok' } as never,
    drift: { status: 'ok' } as never,
    ...over,
  })

describe('the header names the view and says how it gets its figures', () => {
  it('keeps the design’s title', () => {
    expect(CHAT_TITLE).toBe('Ask about your portfolio')
  })

  /**
   * DDR-0115 amendment 10, and the Epic's one licensed departure from the design's text. The
   * design's sentence promises an assembled context, which #327 emptied: every figure is behind a
   * tool the model calls when it needs one (DDR-0111). The assertion is on the claim, not on the
   * phrasing — what must never come back is *included with every question*.
   */
  it('does not promise a context that is sent with every question', () => {
    expect(CHAT_SUBTITLE).not.toMatch(/included with every question/i)
    expect(CHAT_SUBTITLE).toMatch(/as it needs them/)
  })
})

describe('headerChips', () => {
  /**
   * Named and toned by what the state *is* (DDR-0022, DDR-0038). The record is total over the
   * drift result's own union, so a sixth state cannot ship without a name; the schema is read here
   * rather than a list being retyped, which is what makes that claim about the real union.
   */
  it('names every gateway state the drift report can be in', () => {
    const states = balanceDriftResultSchema.options.map((option) => option.shape.status.value)
    expect(Object.keys(GATEWAY_CHIP_LABELS).sort()).toEqual([...states].sort())
    expect(Object.keys(GATEWAY_CHIP_TONES).sort()).toEqual([...states].sort())
    expect(new Set(Object.values(GATEWAY_CHIP_LABELS)).size).toBe(states.length)
  })

  /** The pair DDR-0022 keeps apart, kept apart here: they differ by what the owner does next. */
  it('does not call a stalled gateway offline', () => {
    expect(GATEWAY_CHIP_LABELS.not_connected).not.toBe(GATEWAY_CHIP_LABELS.not_responding)
    expect(GATEWAY_CHIP_LABELS.not_connected).toBe('IBKR offline')
    expect(GATEWAY_CHIP_LABELS.not_responding).toMatch(/not responding/)
  })

  /**
   * The quiet state is not a failure. `no_data` is a gateway that answered and had nothing to
   * value — an empty account, or one with no convertible row (DDR-0007) — and toning it `warn`
   * would report a working gateway as broken.
   */
  it('tones a quiet gateway as quiet and a failed reading as a warning', () => {
    expect(GATEWAY_CHIP_TONES.ok).toBe('live')
    expect(GATEWAY_CHIP_TONES.no_data).toBe('idle')
    expect(GATEWAY_CHIP_TONES.not_connected).toBe('warn')
    expect(GATEWAY_CHIP_TONES.not_responding).toBe('warn')
    expect(GATEWAY_CHIP_TONES.error).toBe('warn')
  })

  it('reports the gateway and the profile, in that order', () => {
    const chips = headerChips(complete())
    expect(chips.map((chip) => chip.id)).toEqual(['gateway', 'profile'])
    expect(chips[0]!.label).toBe(GATEWAY_CHIP_LABELS.ok)
    expect(chips[1]!.label).toBe(PROFILE_CHIP_LABELS.stated)
    expect(chips[1]!.tone).toBe('live')
  })

  it('says the profile is not saved when the owner has written nothing', () => {
    const chips = headerChips(complete({ profile: EMPTY_INVESTOR_PROFILE }))
    expect(chips[1]!.label).toBe(PROFILE_CHIP_LABELS.absent)
    expect(chips[1]!.tone).toBe('idle')
  })

  /**
   * Absent, never guessed. Nothing has answered *yet* is not the same fact as nothing is
   * answering, and a chip drawn before the reading lands would assert the second (DDR-0038).
   */
  it('draws no state chip at all while the reading is still in flight', () => {
    expect(headerChips(null)).toEqual([])
  })

  it('carries the tone as a class rather than as a colour', () => {
    expect(chipClassName('warn')).toBe('assistant-chip assistant-chip-warn')
    expect(chipClassName('live')).toContain('assistant-chip ')
  })
})

describe('groundingLine', () => {
  /**
   * The fold's own criterion (DDR-0115 amendment 3): the line is built **from** `groundingNotices`
   * rather than beside it, so the chip and the line are two renderings of one computation and
   * cannot disagree. Asserted as a correspondence — one clause per notice, always.
   */
  it.each([
    ['nothing at all readable', grounding({ profile: EMPTY_INVESTOR_PROFILE })],
    ['no import, gateway quiet', grounding()],
    ['everything readable', complete()],
    ['a gateway that stalled', complete({ drift: { status: 'not_responding', message: 'x' } })],
  ])('states one consequence per gap the notices report — %s', (_case, reports) => {
    const notices = groundingNotices(reports)
    const line = groundingLine(reports)
    if (notices.length === 0) {
      expect(line).toBeNull()
      return
    }
    expect(line?.split(';')).toHaveLength(notices.length)
  })

  it('names what a silent gateway costs an answer, in the design’s register', () => {
    const line = groundingLine(complete({ drift: { status: 'not_connected', message: 'x' } }))
    expect(line).toBe(
      'The IBKR gateway is not answering, so live portfolio drift is not in answers.',
    )
  })

  it('names the import gap in the words the notice used, so nothing is renamed by the fold', () => {
    expect(groundingLine(complete({ allocation: { status: 'needs_import' } }))).toMatch(
      /^No Flex statements are imported/,
    )
  })

  /** Two gaps, one line — two lines with a glyph each is the list this story removed, one band down. */
  it('carries two gaps in one sentence', () => {
    const line = groundingLine(grounding({ profile: EMPTY_INVESTOR_PROFILE }))
    expect(line).toMatch(/^No Flex statements are imported/)
    expect(line).toMatch(/no investor profile is set/)
    expect(line?.endsWith('.')).toBe(true)
  })

  /** Absent, never empty: a line saying everything is fine is a line the eye learns to skip. */
  it('says nothing when there is nothing missing, and nothing while the reading is in flight', () => {
    expect(groundingLine(complete())).toBeNull()
    expect(groundingLine(null)).toBeNull()
  })
})

/**
 * The half that is not a function: what the component actually draws, and what the stylesheet
 * backs it with.
 *
 * A text scan, with every trap this repo has already paid for. Comments are stripped before
 * anything is asserted about code — `app.css` and the components quote their own values in prose,
 * so an assertion can otherwise pass off the commentary alone (DDR-0042, DDR-0075) — and the one
 * assertion that *is* about a comment reads the raw file on purpose and says so.
 */
const RAW_CONVERSATION = readFileSync(
  new URL('../components/AssistantConversation.tsx', import.meta.url),
  'utf8',
)
const RAW_CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

const strip = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CONVERSATION = strip(RAW_CONVERSATION)
const CSS = strip(RAW_CSS)

/** One rule's body, by its selector text — comments already stripped. */
const rule = (selector: string): string => {
  const start = CSS.indexOf(`\n${selector} {`)
  expect(start, `${selector} declares no rule`).toBeGreaterThan(0)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('the header the conversation draws', () => {
  /**
   * DDR-0115 amendment 6's one constraint on how the chips are built: **a chip that is a control
   * is a `<button>`**, and the two that only report are not. Asserted on the element, because that
   * is the whole of the distinction once both wear the same pill corner.
   */
  it('makes the two controls buttons and the two state chips not', () => {
    expect(CONVERSATION).toMatch(/<button\s+type="button"\s+className="assistant-chip assistant-chip-action/)
    expect(CONVERSATION).toMatch(/<span key={chip.id} className={chipClassName\(chip.tone\)}>/)
    // The state chips are spans, so nothing in the row is focusable but the two that act.
    expect(CONVERSATION).not.toMatch(/<button[^>]*className={chipClassName/)
  })

  /** Disabled is the design's own guard, and the whole of the protection now (amendment 5). */
  it('disables Clear chat when there is nothing to clear, and confirms nothing', () => {
    expect(CONVERSATION).toContain('disabled={turnCount === 0}')
    expect(CONVERSATION).not.toContain('ConfirmAction')
  })

  /** Only while the column is folded — the labelled half of the two collapsing affordances. */
  it('offers Edit profile only while the profile column is collapsed', () => {
    expect(CONVERSATION).toContain('{profileCollapsed && (')
    expect(CONVERSATION).toContain('aria-controls="assistant-profile-column"')
  })

  /**
   * The `<ul>` is gone and nothing rebuilt it one band lower: the facts it carried are in the
   * chips and in `groundingLine`, which is the fold DDR-0115 amendment 3 asked for.
   */
  it('renders no notices list, and states the gaps in one line above the box', () => {
    expect(CONVERSATION).not.toContain('assistant-notices')
    expect(CONVERSATION).not.toContain('groundingNotices')
    expect(CONVERSATION).toContain('className="assistant-grounding-line"')
    expect(CSS).not.toContain('.assistant-notices')
  })

  /**
   * **Nothing polls** — the story's own criterion, and an absence is the only way to assert it.
   * The reading is whatever the standing `readReports` call returned, re-read on the two version
   * dependencies every other read in this view uses (DDR-0027, DDR-0108). The sidebar's one
   * `setTimeout` is a *clock* arming the moment a live reading goes stale (DDR-0056); this header
   * gets neither that nor an interval.
   */
  it('adds no timer, no interval and no channel of its own', () => {
    expect(CONVERSATION).not.toContain('setInterval')
    expect(CONVERSATION).not.toContain('setTimeout')
    expect(CONVERSATION).not.toContain('getOverview')
  })

  /**
   * The two readings of *is the gateway answering* may legitimately differ, and the record says a
   * later reader must not "fix" one by making it read the other. Read from the **raw** file: this
   * is the one assertion in this suite whose subject really is a comment.
   */
  it('records why its reading differs from the sidebar badge’s', () => {
    expect(RAW_CONVERSATION).toContain('DDR-0056, DDR-0095')
  })
})

describe('the chips’ stylesheet', () => {
  /** A pill, a border and the raised fill — the box the design draws, entirely from tokens. */
  it('draws the chip from tokens, with no colour of its own', () => {
    const chip = rule('.assistant-chip')
    expect(chip).toContain('border-radius: var(--radius-pill)')
    expect(chip).toContain('background: var(--surface-raised)')
    expect(chip).toContain('border: 1px solid var(--border)')
    expect(chip).toContain('font-size: var(--text-2xs)')
    // A literal here is a pairing `lib/contrast.ts` does not cover (DDR-0046).
    expect(chip).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  /**
   * The tone is the mark's, and the label goes coloured only where the state is *good*. A chip
   * whose wording went red would paint a merely quiet gateway as a failure (DDR-0022, DDR-0038).
   */
  it('tones the warn state’s mark without toning its label', () => {
    expect(rule('.assistant-chip-warn')).toContain('--assistant-chip-mark: var(--neg)')
    expect(rule('.assistant-chip-warn')).not.toContain('color:')
    expect(rule('.assistant-chip-live')).toContain('color: var(--pos)')
  })

  /** The loss split, the right way round: the ink is `--neg-text`, the edge is `--neg`. */
  it('takes the loss split’s two halves for Clear chat’s hover', () => {
    const hover = rule('.assistant-chip-danger:hover:not(:disabled)')
    expect(hover).toContain('border-color: var(--neg)')
    expect(hover).toContain('color: var(--neg-text)')
  })

  /** No focus rule anywhere in the row: the `:where(...)` base rings both buttons (DDR-0026). */
  it('writes no focus rule of its own', () => {
    for (const selector of ['.assistant-chip', '.assistant-chip-action', '.assistant-chip-row']) {
      expect(CSS).not.toContain(`${selector}:focus`)
    }
  })

  /** Motion draws from the scale, so the reduced-motion block reaches it (DDR-0044). */
  it('transitions on the duration scale rather than a raw one', () => {
    expect(rule('.assistant-chip-action')).toContain('var(--duration-fast)')
  })
})

describe('the two controls in the chip row', () => {
  it('takes the design’s label for clearing the conversation', () => {
    expect(CLEAR_CHAT_LABEL).toBe('Clear chat')
    expect(EDIT_PROFILE_LABEL).toBe('Edit profile')
  })

  /**
   * The fact that lost its home when the confirm went (DDR-0115 amendment 5). The transcript
   * disappearing is visible; the assistant forgetting it is not, and it is the half that changes
   * what the next answer can refer to (DDR-0113).
   */
  it('keeps the memory half of the old warning on the button itself', () => {
    expect(CLEAR_CHAT_TITLE).toMatch(/stops remembering/)
    expect(CLEAR_CHAT_TITLE).toMatch(/fresh one/)
  })
})
