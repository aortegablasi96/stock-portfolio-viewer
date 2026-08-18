import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { figureRoleSelectors } from './figureRole'
import {
  DATA_TABLE_CELL_KINDS,
  DATA_TABLE_HEIGHTS,
  DATA_TABLE_SURFACES,
  DEFAULT_DATA_TABLE_HEIGHT,
  DEFAULT_DATA_TABLE_SURFACE,
  dataTableCellClassName,
  dataTableCellKindClassName,
  dataTableHeightClassName,
  dataTableRowClassName,
  dataTableScrollClassName,
  dataTableSurfaceClassName,
} from './dataTableVariants'

/**
 * The `DataTable` contract (Story #134, DDR-0039).
 *
 * Same two halves as the rest of the family (DDR-0032 – DDR-0038): the class composition, and
 * the stylesheet that has to back it. The second half is what stops the Epic's stated risk — a
 * primitive shipping beside the rules it was meant to retire, which is worse than either end
 * state.
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

/**
 * The body of a rule whose selector list is exactly these, one per line — the shape every
 * cell-level rule in this primitive has, since a `<th>` and a `<td>` are always styled together.
 */
function groupBody(...selectors: string[]): string {
  const pattern = selectors.map((selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${pattern.join(',\\n')} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

describe('dataTableScrollClassName', () => {
  it('is the bare container by default — a table inside a card body adds nothing', () => {
    expect(DEFAULT_DATA_TABLE_SURFACE).toBe('inline')
    expect(DEFAULT_DATA_TABLE_HEIGHT).toBe('auto')
    expect(dataTableScrollClassName()).toBe('data-table-scroll')
  })

  it('composes the surface and the cap, in that order', () => {
    expect(dataTableScrollClassName('card')).toBe('data-table-scroll data-table-scroll-card')
    expect(dataTableScrollClassName('inline', 'capped')).toBe(
      'data-table-scroll data-table-scroll-capped',
    )
    expect(dataTableScrollClassName('card', 'capped')).toBe(
      'data-table-scroll data-table-scroll-card data-table-scroll-capped',
    )
  })

  it('appends a caller’s className last, so a call site extends rather than forks', () => {
    expect(dataTableScrollClassName('inline', 'auto', 'realized-table')).toBe(
      'data-table-scroll realized-table',
    )
  })

  it('omits an absent or empty className rather than emitting a stray space', () => {
    expect(dataTableScrollClassName('inline', 'auto', undefined)).toBe('data-table-scroll')
    expect(dataTableScrollClassName('inline', 'auto', '')).toBe('data-table-scroll')
  })

  /**
   * The default of each axis carries no class, the same shape as `toneClassName('neutral')`
   * (DDR-0034) and `statePanelSurfaceClassName('panel')` (DDR-0038). An empty rule appearing
   * later would mean someone had started declaring the absence of something.
   */
  it('gives the default of each axis no class of its own', () => {
    expect(dataTableSurfaceClassName('inline')).toBe('')
    expect(dataTableHeightClassName('auto')).toBe('')
    expect(declaresRule('.data-table-scroll-inline')).toBe(false)
    expect(declaresRule('.data-table-scroll-auto')).toBe(false)
  })

  it('declares a rule for every axis value that has a class', () => {
    for (const surface of DATA_TABLE_SURFACES) {
      const className = dataTableSurfaceClassName(surface)
      if (className) expect(declaresRule(`.${className}`), surface).toBe(true)
    }
    for (const height of DATA_TABLE_HEIGHTS) {
      const className = dataTableHeightClassName(height)
      if (className) expect(declaresRule(`.${className}`), height).toBe(true)
    }
  })
})

describe('dataTableCellClassName', () => {
  it('joins the parts a cell is made of', () => {
    expect(dataTableCellClassName('data-table-num', 'stat-negative')).toBe(
      'data-table-num stat-negative',
    )
  })

  /** A cell with nothing to add should carry no `class` attribute, not an empty one. */
  it('drops falsy parts rather than emitting stray spaces', () => {
    expect(dataTableCellClassName(false, undefined, '')).toBe('')
    expect(dataTableCellClassName(false, 'data-table-name', undefined)).toBe('data-table-name')
  })

  /**
   * Each kind is declared **scoped to the table**, and that is load-bearing rather than tidy:
   * the base `.data-table th, .data-table td` rule is worth two selectors, so an unscoped
   * `.data-table-num` loses its `text-align` to it. `.holdings-table .num` was scoped all along;
   * flattening the three into the primitive's namespace is what would have dropped it.
   */
  it('names every cell kind, and the stylesheet scopes each one to the table', () => {
    expect(DATA_TABLE_CELL_KINDS).toEqual(['num', 'name', 'note'])
    for (const kind of DATA_TABLE_CELL_KINDS) {
      const className = dataTableCellKindClassName(kind)
      expect(declaresRule(`.${className}`), kind).toBe(true)
      expect(CSS, kind).toMatch(new RegExp(`^\\.data-table \\.${className} \\{`, 'm'))
    }
  })
})

/**
 * A row linked to something outside the table (Story #147, DDR-0040) — the donut slice under
 * the pointer, in the one view that pairs them.
 */
describe('dataTableRowClassName', () => {
  it('gives an ordinary row no class, so a table that links nothing is unchanged', () => {
    expect(dataTableRowClassName(false)).toBe('')
    expect(dataTableRowClassName(false, undefined)).toBe('')
  })

  it('marks the linked row and keeps a caller’s class after it', () => {
    expect(dataTableRowClassName(true)).toBe('data-table-row-active')
    expect(dataTableRowClassName(true, 'extra')).toBe('data-table-row-active extra')
    expect(dataTableRowClassName(false, 'extra')).toBe('extra')
  })

  it('is backed by a rule that tints the cells rather than the row box', () => {
    expect(CSS).toMatch(
      /^\.data-table tbody tr\.data-table-row-active > th,\n\.data-table tbody tr\.data-table-row-active > td \{/m,
    )
  })

  /**
   * The linked row and the hovered row are the same row whenever the pointer is what linked it
   * (Story #186), so the two rules meet on every pointer move in the Allocation breakdown. The
   * emphasis has to win, and it wins the way CSS decides: equal specificity, later in the file.
   * Before the row hover existed the active rule was unscoped, and `tbody tr:hover > th` carries
   * two more element selectors than `.data-table-row-active > th` — it would have taken the row
   * over silently, in the common case, leaving the link visible only from the keyboard.
   */
  it('lets the linked row out-weigh the hover it sits under', () => {
    const hover = CSS.indexOf('.data-table tbody tr:hover > th')
    const active = CSS.indexOf('.data-table tbody tr.data-table-row-active > th')
    expect(hover).toBeGreaterThan(-1)
    expect(active).toBeGreaterThan(hover)
  })
})

describe('the stylesheet backs the primitive', () => {
  it('declares the shared table and container rules', () => {
    expect(CSS).toMatch(/^\.data-table \{/m)
    expect(CSS).toMatch(/^\.data-table-scroll \{/m)
  })

  /**
   * The container's job is overflow and placement. Drawing a surface unasked is what forced the
   * `.card-content .table-scroll` override that this story retires — the surface now belongs to
   * the one axis value that names it.
   */
  it('keeps the bare container free of the surface the `card` value owns', () => {
    const base = ruleBody('.data-table-scroll')
    for (const declaration of ['background', 'border', 'border-radius']) {
      expect(base, declaration).not.toContain(declaration)
    }
    const card = ruleBody('.data-table-scroll-card')
    expect(card).toContain('background: var(--card)')
    expect(card).toContain('border-radius: var(--radius-lg)')
  })

  /** Padding, type and gaps come from the scale, never a hand-picked length (DDR-0031). */
  it('takes its padding and type from the token scale', () => {
    expect(CSS).toMatch(
      /^\.data-table th,\n\.data-table td \{[^}]*padding: var\(--space-4\) var\(--space-5\);/m,
    )
    expect(ruleBody('.data-table')).toContain('font-size: var(--text-sm)')
    expect(ruleBody('.data-table thead th')).toContain('font-size: var(--text-2xs)')
  })

  /**
   * The column head is the redesign's 11px micro-label (Story #186, DDR-0059), and the two halves
   * of it are asserted together because they only work together: `--text-2xs` alone is small
   * capitals set at the tracking of a body face, which is the thing eleven-pixel uppercase cannot
   * survive. It is the same argument the figure role makes for its three properties (DDR-0053),
   * and the same shape of assertion.
   */
  it('sets the column head one step smaller and one step wider-tracked', () => {
    const head = ruleBody('.data-table thead th')
    expect(head).toContain('font-size: var(--text-2xs)')
    expect(head).toContain('letter-spacing: 0.06em')
    expect(head).toContain('text-transform: uppercase')
    // Quieter, not fainter: the size step is the change, the ink is not.
    expect(head).toContain('color: var(--muted)')
    expect(head).toContain('font-weight: 600')
  })

  /**
   * The row hover (Story #186). CSS rather than the prototype's `onMouseEnter`/`onMouseLeave`
   * pair, which re-renders a 260-row table on every pointer move — the assertion that it is a
   * rule at all is in `DataTable`'s own scan below.
   *
   * `--duration-fast` is the token, not a number: it is the one that reduced motion zeroes
   * (DDR-0044), and a raw duration here would be a lift that keeps animating when the reader has
   * asked for none. `background-color` rather than `background`, so the transition names the one
   * property that changes.
   */
  it('lifts the hovered row in CSS, on the fast duration', () => {
    const hover = groupBody('.data-table tbody tr:hover > th', '.data-table tbody tr:hover > td')
    expect(hover).toContain('background: color-mix(in srgb, var(--text) 4%, transparent)')
    const transition = groupBody('.data-table tbody tr > th', '.data-table tbody tr > td')
    expect(transition).toContain('transition: background-color var(--duration-fast)')
  })

  /**
   * The trailing rule the redesign drops was already absent — `tbody tr:last-child` clears it —
   * and this pins it against a restyle that reaches for `border-bottom` on the table instead.
   * The header's own rule is the same declaration on `thead th`, which the base cell rule gives
   * it for free.
   */
  it('rules between rows and under the head, but not after the last row', () => {
    expect(groupBody('.data-table th', '.data-table td')).toContain('border-bottom: 1px solid')
    expect(
      groupBody('.data-table tbody tr:last-child th', '.data-table tbody tr:last-child td'),
    ).toContain('border-bottom: none')
  })

  /**
   * The AC the Epic inherited from the views that already had it: figures line up.
   *
   * `font-variant-numeric` left this rule in Story #180 — it only does its job beside the mono
   * family and the negative tracking, so the three are applied together by the figure role
   * (DDR-0053). The guarantee is the same and the assertion follows it: a numeric cell is still
   * asserted to be a figure, by membership rather than by declaration.
   */
  it('keeps tabular figures on numeric cells', () => {
    expect(figureRoleSelectors(CSS)).toContain('.data-table .data-table-num')
    expect(ruleBody('.data-table .data-table-num')).toContain('text-align: right')
  })

  /**
   * The sort control fills its header cell rather than sitting in it: the cell already carries
   * the padding, the sticky background and the uppercase label, so a `.btn` in here would draw a
   * second box inside that one. `font: inherit` and no box of its own is what makes a sortable
   * header identical to the plain header beside it.
   */
  it('gives the sort control no box of its own', () => {
    const sort = ruleBody('.data-table-sort')
    expect(sort).toContain('font: inherit')
    expect(sort).toContain('padding: 0')
    expect(sort).toContain('border: 0')
    expect(sort).toContain('background: none')
    expect(sort).not.toContain('border-radius')
  })

  /**
   * A `<button>` does not inherit the three properties that *are* this header's treatment — the
   * UA stylesheet resets them — so a sortable header rendered in sentence case, unspaced and
   * centred beside its uppercase neighbours until each was restated. This was caught on screen
   * rather than by any class-name assertion, which is the reason it is written down here.
   */
  it.each(['text-transform: inherit', 'letter-spacing: inherit', 'text-align: inherit'])(
    'restates %s, which a button would otherwise lose to the UA stylesheet',
    (declaration) => {
      expect(ruleBody('.data-table-sort')).toContain(declaration)
    },
  )

  /**
   * Direction has a second cue beyond the accent — the arrow's shape — which is DDR-0029's
   * "both cues are colour" rule applied to a header. The faint glyph on an unsorted column is
   * the affordance, and it is what keeps the header's width from jumping when the sort lands.
   */
  it('draws the sorted column with an accent and an arrow, not an accent alone', () => {
    expect(ruleBody('.data-table-sort.is-sorted')).toContain('color: var(--accent)')
    expect(ruleBody('.data-table-sort-glyph')).toContain('opacity')
    expect(ruleBody('.data-table-sort.is-sorted .data-table-sort-glyph')).toContain('opacity: 1')
  })

  /** One ring, applied by the `:where()` base rule at the top of the file (DDR-0031). */
  it('declares no focus ring of its own', () => {
    const bodies = [...CSS.matchAll(/^\.data-table[\w-. ]*\{([^}]*)\}/gm)].map((m) => m[1] ?? '')
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.filter((body) => body.includes('outline'))).toEqual([])
  })

  /** The capped form is the ~5-row window with the scroll-driven fade kept from Story #67. */
  it('caps the body and keeps the scroll-driven fade', () => {
    const capped = ruleBody('.data-table-scroll-capped')
    expect(capped).toContain('max-height')
    expect(capped).toContain('overflow-y: auto')
    expect(capped).toContain('animation-timeline: scroll(self block)')
    expect(CSS).toContain('@keyframes table-rows-fade')
  })
})

/**
 * The rules the primitive replaced. `.holdings-table` was the worst of them: a class named for
 * the Portfolio dashboard that eight other tables wore because it was there.
 */
describe('the superseded table rules are gone', () => {
  it.each(['.holdings-table', '.breakdown-table', '.table-scroll', '.table-scroll-rows'])(
    '%s no longer appears in the stylesheet',
    (selector) => {
      expect(RULES).not.toContain(selector)
    },
  )

  /**
   * The override that undid a container's own border inside a card body. A table that names
   * where it sits never has to be talked out of a border it drew on the wrong assumption.
   */
  it('no longer needs the card-body override', () => {
    expect(RULES).not.toContain('.card-content .table-scroll')
  })

  /**
   * `.breakdown-table` existed for a single `min-width: 0` on a grid child. Both halves of the
   * split need it, so it is one rule on the container now rather than a class per child.
   */
  it('lets the breakdown split size both its children instead', () => {
    expect(CSS).toMatch(/^\.breakdown-split > \* \{[^}]*min-width: 0;/m)
  })
})

/**
 * The component, read as text (Story #186). The row hover is a stylesheet rule, and the one way
 * to lose that is the shape the redesign's prototype ships: `onMouseEnter`/`onMouseLeave` writing
 * `currentTarget.style.background`. The pointer handlers themselves stay — they are how a row
 * reports the slice it is linked to (DDR-0040), which is data and not decoration — so what this
 * scans for is a component *writing a style*, not a component listening to a pointer.
 */
describe('the row hover belongs to the stylesheet', () => {
  const TSX = readFileSync(new URL('../components/ui/DataTable.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('sets no inline style and reads back no element style', () => {
    expect(TSX).not.toMatch(/\bstyle=\{/)
    expect(TSX).not.toContain('.style.')
  })

  /** The handlers that stay, and what they are for. */
  it('keeps the pointer and focus handlers that report the linked row', () => {
    for (const handler of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur']) {
      expect(TSX, handler).toContain(`${handler}={linked ?`)
    }
  })
})
