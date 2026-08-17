/**
 * The figure role, read back out of `app.css` (Story #180, DDR-0053). Used only by tests.
 *
 * Like `tokenAdoption.ts` and `motionTokens.ts`, nothing imports this at runtime — the role is
 * CSS, and this is how a Node-only test asks which selectors are in it.
 *
 * It exists because three tests need the answer and none of them owns it. `figureRole.test.ts`
 * pins what the role declares; `statTileVariants.test.ts` and `dataTableVariants.test.ts` each
 * pin that *their* figure is in it, which is where the `font-variant-numeric` they used to assert
 * on their own rule went. Three copies of the same regex is three chances for one to keep passing
 * against a role that has moved.
 *
 * The role is deliberately **one rule**, so {@link figureRoleSelectors} throws rather than
 * returning a union if a second appears: two rules is the drift the role was built to prevent,
 * and a test that quietly accepted it would report the wrong thing.
 */
import { scanDeclarations } from './cssDeclarations'

/** The token every member of the role applies. Finding it is how the rule is located. */
export const FIGURE_FAMILY = 'var(--font-figure)'

/** The role's selector list, as written — the `context` every one of its declarations shares. */
export function figureRoleContext(css: string): string {
  const applied = scanDeclarations(css).filter(
    (declaration) =>
      declaration.property === 'font-family' && declaration.value === FIGURE_FAMILY,
  )
  if (applied.length !== 1) {
    throw new Error(
      `app.css applies ${FIGURE_FAMILY} in ${applied.length} rules; the figure role is exactly one`,
    )
  }
  return applied[0]!.context
}

/** The selectors in the role, trimmed. `.data-table .data-table-num` stays one entry. */
export function figureRoleSelectors(css: string): string[] {
  return figureRoleContext(css)
    .split(',')
    .map((selector) => selector.trim())
}

/** Whether a selector is in the role, and so renders in the figure face. */
export function isFigureSelector(css: string, selector: string): boolean {
  return figureRoleSelectors(css).includes(selector)
}
