import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATE_PANEL_SURFACE,
  DEFAULT_STATE_PANEL_VARIANT,
  STATE_PANEL_SURFACES,
  STATE_PANEL_VARIANTS,
  statePanelClassName,
  statePanelElement,
  statePanelRole,
  statePanelSurfaceClassName,
} from './statePanelVariants'

/**
 * The `StatePanel` contract (Story #133, DDR-0038).
 *
 * The same two halves as the rest of the family (DDR-0032 – DDR-0037) plus a third the earlier
 * primitives had no need of: this one *derives* two things a call site would otherwise decide
 * one view at a time — which element the panel is, and how it is announced. Those derivations are
 * the reason four states can share one presentation, so they are pinned here rather than left to
 * a component Vitest cannot render (DDR-0029).
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments removed. The "gone" assertions below have to read this rather
 * than `CSS`: the primitive's own comment block names the rules it replaced, which is exactly the
 * documentation worth keeping and would otherwise fail the test.
 */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Whether the stylesheet declares a rule carrying this exact class. */
function declaresRule(selector: string): boolean {
  return new RegExp(`^[^{\\n]*\\${selector}[\\s,:.{]`, 'm').test(CSS)
}

/** The body of the first rule whose selector is exactly this one. */
function ruleBody(selector: string): string {
  return new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

describe('statePanelClassName', () => {
  it('composes base and variant, and adds a surface class only where one exists', () => {
    expect(statePanelClassName('loading', 'panel')).toBe('state-panel state-panel-loading')
    expect(statePanelClassName('error', 'panel')).toBe('state-panel state-panel-error')
    expect(statePanelClassName('empty', 'inline')).toBe(
      'state-panel state-panel-empty state-panel-inline',
    )
  })

  it('defaults to the empty state on its own surface — the form most call sites use', () => {
    expect(DEFAULT_STATE_PANEL_VARIANT).toBe('empty')
    expect(DEFAULT_STATE_PANEL_SURFACE).toBe('panel')
    expect(statePanelClassName()).toBe('state-panel state-panel-empty')
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(statePanelClassName('notice', 'inline', 'country-map-unavailable')).toBe(
      'state-panel state-panel-notice state-panel-inline country-map-unavailable',
    )
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(statePanelClassName('empty', 'panel', undefined)).toBe('state-panel state-panel-empty')
    expect(statePanelClassName('empty', 'panel', '')).toBe('state-panel state-panel-empty')
  })

  /**
   * The panel surface *is* the card's (`default` at `lg`), so a class for it would have nothing
   * to declare — the same shape as `toneClassName('neutral')` returning `''` (DDR-0034). An empty
   * `.state-panel-panel` rule appearing later would mean someone had started drawing the surface
   * twice.
   */
  it('gives the panel surface no class of its own', () => {
    expect(statePanelSurfaceClassName('panel')).toBe('')
    expect(statePanelSurfaceClassName('inline')).toBe('state-panel-inline')
    expect(declaresRule('.state-panel-panel')).toBe(false)
  })
})

/**
 * How a state is announced. `not_connected`, `not_responding` and `needs_import` are conditions
 * the owner can act on but did not cause, and a screen reader interrupting for each of them on
 * every launch is the behaviour this rule prevents. A failed read is the one that interrupts.
 */
describe('statePanelRole', () => {
  it('announces an error live and everything else politely', () => {
    expect(statePanelRole('error')).toBe('alert')
    expect(statePanelRole('loading')).toBe('status')
    expect(statePanelRole('empty')).toBe('status')
    expect(statePanelRole('notice')).toBe('status')
  })

  it('gives every variant a role, so none can render unannounced', () => {
    for (const variant of STATE_PANEL_VARIANTS) {
      expect(['alert', 'status'], variant).toContain(statePanelRole(variant))
    }
  })
})

/**
 * Which element the panel is. A panel with no heading is a paragraph, which is what the
 * superseded call sites already rendered (`Card as="p"`) — and the UA margins on that `<p>` are
 * part of how `.dashboard`'s flex column spaces the dashboard (DDR-0033). Wrapping a one-line
 * loading state in a section would move the page for no reason.
 */
describe('statePanelElement', () => {
  it('is a paragraph whenever there is no heading, on either surface', () => {
    expect(statePanelElement('panel', false)).toBe('p')
    expect(statePanelElement('inline', false)).toBe('p')
  })

  it('becomes a section — or a plain div inline — once a heading is present', () => {
    expect(statePanelElement('panel', true)).toBe('section')
    expect(statePanelElement('inline', true)).toBe('div')
  })
})

describe('the stylesheet backs the primitive', () => {
  it('declares the shared base rule', () => {
    expect(CSS).toMatch(/^\.state-panel \{/m)
  })

  it('keeps the base muted, and free of the surface the card owns', () => {
    const base = ruleBody('.state-panel')
    expect(base).toContain('color: var(--muted)')
    for (const declaration of ['padding', 'background', 'border-radius']) {
      expect(base, declaration).not.toContain(declaration)
    }
  })

  /**
   * Only `error` paints, and that is the design rather than an omission: the axis exists because
   * the copy and the announcement differ. A rule appearing behind a quiet variant would be a
   * decoration inventing a distinction the app does not have.
   */
  it('gives the error variant a boundary and the other three none', () => {
    expect(ruleBody('.state-panel-error')).toContain('border-color')
    for (const variant of STATE_PANEL_VARIANTS.filter((v) => v !== 'error')) {
      expect(declaresRule(`.state-panel-${variant}`), variant).toBe(false)
    }
  })

  it('declares a rule for the one surface that needs one', () => {
    expect(STATE_PANEL_SURFACES).toContain('inline')
    expect(declaresRule('.state-panel-inline')).toBe(true)
  })

  /**
   * The inline form sits in a surface that already exists, so its spacing is the container's.
   * A UA margin here would push the map's degraded frame and every empty chart apart.
   */
  it('strips the margins from the inline form and its paragraphs', () => {
    expect(CSS).toMatch(/^\.state-panel-inline,\n\.state-panel-inline p \{\n {2}margin: 0;/m)
    expect(ruleBody('.state-panel-inline')).toContain('font-size: var(--text-sm)')
  })

  /** Heading, hint and action: the three parts, each on the scale (DDR-0031). */
  it('takes the heading and hint sizes from the type scale, never a raw length', () => {
    expect(ruleBody('.state-panel-heading')).toContain('font-size: var(--text-md)')
    expect(ruleBody('.state-panel-heading')).toContain('color: var(--text)')
    expect(ruleBody('.state-panel-hint')).toContain('font-size: var(--text-xs)')
  })

  it('keeps the action last, spaced by a step rather than a hand-picked gap', () => {
    expect(ruleBody('.state-panel .btn')).toContain('margin-top: var(--space-5)')
  })

  /** A state panel is prose plus a button; the button's ring is the base rule's (DDR-0031). */
  it('declares no focus ring of its own', () => {
    const bodies = [...CSS.matchAll(/^\.state-panel[\w-. ]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.filter((body) => body.includes('outline'))).toEqual([])
  })
})

/**
 * The rules the primitive replaced. Epic #125's stated risk is a consolidation that stalls
 * half-done, leaving a primitive beside the rules it was meant to retire — worse than either end
 * state. `.chart-empty` and `.snapshot-empty` were byte-identical to each other, which is the
 * drift this Epic exists to remove.
 */
describe('the superseded state rules are gone', () => {
  it.each(['.state-notice', '.state-error', '.snapshot-empty', '.chart-empty', '.country-map-unavailable-hint'])(
    '%s no longer appears in the stylesheet',
    (selector) => {
      expect(RULES).not.toContain(selector)
    },
  )

  /**
   * The map's frame survives: it is where the panel is drawn — a full-height, centred box
   * standing in for the basemap — not a second way of styling the panel itself (ADR-0008).
   */
  it('leaves the map’s degraded frame in place', () => {
    expect(declaresRule('.country-map-unavailable')).toBe(true)
  })

  /**
   * The Portfolio tab's refresh indicator is not a state panel: the figures stay on screen while
   * they are re-converted, which is the live-data half of DDR-0027. It borrowed `.state-panel`
   * for its muted ink, so it has to carry that itself now.
   */
  it('leaves the converting note standing on its own', () => {
    expect(ruleBody('.converting-note')).toContain('color: var(--muted)')
  })
})
