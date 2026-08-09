import { describe, expect, it } from 'vitest'
import { scanDeclarations, stripComments } from './cssDeclarations'

/**
 * The scanner behind the token-adoption guard (Story #151).
 *
 * These run on synthetic CSS on purpose. The guard's own contract test reads the real `app.css`,
 * so if the scanner is wrong it fails there too — but it fails as "the baseline doesn't match",
 * which says nothing about why. The cases below are the ones the scanner has to get right for
 * that message to ever be trustworthy.
 */

describe('stripComments', () => {
  it('blanks a comment without moving the lines after it', () => {
    const css = ['/* first', '   second */', '.a {', '  gap: 1rem;', '}'].join('\n')
    const stripped = stripComments(css)
    expect(stripped.split('\n')).toHaveLength(5)
    expect(stripped.split('\n')[3]).toBe('  gap: 1rem;')
  })

  it('removes a length quoted in prose, which app.css line 904 really does', () => {
    const css = '/* Was a hand-picked 0.7rem; --space-4 is the step. */\n.a {\n  gap: 0;\n}'
    expect(stripComments(css)).not.toContain('0.7rem')
  })
})

describe('scanDeclarations', () => {
  it('keys a declaration on its selector and property', () => {
    const declaration = scanDeclarations('.dashboard-header {\n  gap: 1.5rem;\n}')[0]!
    expect(declaration.key).toBe('.dashboard-header | gap')
    expect(declaration.value).toBe('1.5rem')
    expect(declaration.line).toBe(2)
  })

  it('puts the at-rule in the key, so a media override never collides with its base rule', () => {
    const css = [
      '.snapshot-item {',
      '  gap: 1rem;',
      '}',
      '@media (max-width: 720px) {',
      '  .snapshot-item {',
      '    gap: 0.5rem;',
      '  }',
      '}',
    ].join('\n')
    expect(scanDeclarations(css).map((d) => d.key)).toEqual([
      '.snapshot-item | gap',
      '@media (max-width: 720px) >> .snapshot-item | gap',
    ])
  })

  it('collapses a selector that spans lines', () => {
    const css = '.country-mark-slice,\n.country-mark-dot {\n  stroke-width: 0.75;\n}'
    expect(scanDeclarations(css)[0]!.context).toBe('.country-mark-slice, .country-mark-dot')
  })

  it('walks @keyframes bodies like any other block', () => {
    const css = '@keyframes fade {\n  86% {\n    margin: 1rem;\n  }\n}'
    expect(scanDeclarations(css)[0]!.key).toBe('@keyframes fade >> 86% | margin')
  })

  it('keeps longhands distinct from their shorthand', () => {
    const css = '.a {\n  margin: 1rem;\n  margin-top: 2rem;\n}'
    expect(scanDeclarations(css).map((d) => d.property)).toEqual(['margin', 'margin-top'])
  })

  it('is not desynchronised by a brace inside a quoted string', () => {
    const css = '.a::after {\n  content: "}";\n  gap: 1rem;\n}\n.b {\n  gap: 2rem;\n}'
    expect(scanDeclarations(css).map((d) => d.key)).toEqual([
      '.a::after | content',
      '.a::after | gap',
      '.b | gap',
    ])
  })

  it('is not desynchronised by a semicolon inside a quoted string', () => {
    const css = ".a {\n  syntax: '<length>;';\n  gap: 1rem;\n}"
    expect(scanDeclarations(css).map((d) => d.property)).toEqual(['syntax', 'gap'])
  })

  it('ignores a selector that never opens a block', () => {
    expect(scanDeclarations('.a, .b\n')).toEqual([])
  })

  it('reads a declaration split across lines', () => {
    const css = '.a {\n  padding:\n    1rem\n    2rem;\n}'
    const declaration = scanDeclarations(css)[0]!
    expect(declaration.value).toBe('1rem 2rem')
  })

  it('finds no declarations in a stylesheet of only comments', () => {
    expect(scanDeclarations('/* gap: 1rem; */')).toEqual([])
  })
})
