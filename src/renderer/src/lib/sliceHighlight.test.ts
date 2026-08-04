import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OTHER_KEY } from './pie'
import {
  SLICE_EMPHASES,
  sliceClassName,
  sliceEmphasis,
  sliceEmphasisClassName,
  type SliceEmphasis,
} from './sliceHighlight'

/**
 * The linked emphasis shared by an allocation breakdown's table and its donut (Story #147,
 * DDR-0040).
 *
 * Kept out of the components because Vitest runs Node-only (DDR-0029). What is pinned here is
 * the rule rather than the pointer plumbing: three states, keyed on identity, and a highlight
 * that never touches the fill.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** The body of the first rule whose selector is exactly this one. */
function ruleBody(selector: string): string {
  return new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? ''
}

describe('sliceEmphasis', () => {
  it('rests the whole chart when nothing is hovered', () => {
    expect(sliceEmphasis(null, 'equity')).toBe('resting')
    expect(sliceEmphasis(null, OTHER_KEY)).toBe('resting')
  })

  it('activates the matching slice and mutes the rest', () => {
    expect(sliceEmphasis('equity', 'equity')).toBe('active')
    expect(sliceEmphasis('equity', 'cash')).toBe('muted')
  })

  /**
   * Identity, never index. The table sorts by any column since Story #134, so its row order and
   * the donut's arc order have no reason to agree — a positional link would light the wrong
   * wedge the moment a reader sorted by value.
   */
  it('pairs on the key, so a re-sorted table still lights the right wedge', () => {
    const arcOrder = ['equity', 'bond', 'cash']
    const rowOrder = ['cash', 'equity', 'bond']
    const active = 'bond'
    const litInArcOrder = arcOrder.filter((k) => sliceEmphasis(active, k) === 'active')
    const litInRowOrder = rowOrder.filter((k) => sliceEmphasis(active, k) === 'active')
    expect(litInArcOrder).toEqual(['bond'])
    expect(litInRowOrder).toEqual(['bond'])
  })

  /** `groupTail`'s aggregated tail is one slice with one key, so it needs no special case. */
  it('treats the grouped tail as a single slice', () => {
    expect(sliceEmphasis(OTHER_KEY, OTHER_KEY)).toBe('active')
    expect(sliceEmphasis(OTHER_KEY, 'equity')).toBe('muted')
  })

  it('lights exactly one slice at a time', () => {
    const keys = ['equity', 'bond', 'cash', OTHER_KEY]
    for (const active of keys) {
      const lit = keys.filter((k) => sliceEmphasis(active, k) === 'active')
      expect(lit, active).toHaveLength(1)
    }
  })

  it('only ever reports a state from the union', () => {
    for (const key of ['equity', 'cash', '']) {
      expect(SLICE_EMPHASES).toContain(sliceEmphasis('equity', key))
      expect(SLICE_EMPHASES).toContain(sliceEmphasis(null, key))
    }
  })
})

describe('sliceEmphasisClassName and sliceClassName', () => {
  /** Rest is the absence of emphasis, the same shape as `toneClassName('neutral')` (DDR-0034). */
  it('gives the resting state no class of its own', () => {
    expect(sliceEmphasisClassName('resting')).toBe('')
    expect(sliceClassName('pie-series-1', 'resting')).toBe('pie-slice pie-series-1')
  })

  it('composes the palette slot and the emphasis, in that order', () => {
    expect(sliceClassName('pie-series-2', 'active')).toBe(
      'pie-slice pie-series-2 pie-slice-active',
    )
    expect(sliceClassName('pie-series-3', 'muted')).toBe('pie-slice pie-series-3 pie-slice-muted')
  })

  it('emits no stray space when a slice has no palette class', () => {
    expect(sliceClassName('', 'resting')).toBe('pie-slice')
  })
})

describe('the stylesheet backs the emphasis', () => {
  it('declares a rule for each state that carries a class', () => {
    for (const emphasis of SLICE_EMPHASES.filter((e) => e !== 'resting')) {
      const className = sliceEmphasisClassName(emphasis satisfies SliceEmphasis)
      expect(ruleBody(`.${className}`), emphasis).not.toBe('')
    }
  })

  /**
   * The invariant this story must not break. Hue *is* identity in this app — one sector wears
   * one colour everywhere, the map included (DDR-0030) — and the scales are CVD-validated
   * (DDR-0021). A highlight that recoloured a wedge would be saying "a different slice".
   */
  it('never changes a slice’s fill', () => {
    for (const emphasis of SLICE_EMPHASES.filter((e) => e !== 'resting')) {
      const body = ruleBody(`.${sliceEmphasisClassName(emphasis satisfies SliceEmphasis)}`)
      expect(body, emphasis).not.toContain('fill')
    }
  })

  it('emphasises with ink and steps the others back', () => {
    expect(ruleBody('.pie-slice-active')).toContain('stroke: var(--text)')
    expect(ruleBody('.pie-slice-muted')).toContain('opacity')
  })

  /** The linked row is neutral: it is pointed at, not selected, and the accent means "sorted". */
  it('tints the linked table row without borrowing the accent', () => {
    const row = ruleBody('.data-table-row-active > th,\n.data-table-row-active > td')
    expect(row).toContain('background')
    expect(row).not.toContain('--accent')
  })

  it('drops the transition for readers who ask for less motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.pie-slice \{/)
  })
})
