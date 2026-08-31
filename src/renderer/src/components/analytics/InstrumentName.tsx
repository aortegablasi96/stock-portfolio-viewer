import { instrumentName } from '@shared/format'

/**
 * The secondary line under a ticker: the instrument's name, where the import carries one
 * (Story #211, DDR-0066).
 *
 * Seven cells across Dividends, Trades and Allocation drew this line and disagreed about it —
 * three shortened the description through `formatCompanyName`, four rendered it raw, and all
 * seven used the same class, so the same holding read two ways depending on which view was open.
 * One component is what makes "identical on every view" true by construction rather than by
 * seven call sites remembering.
 *
 * It renders **nothing** where {@link instrumentName} finds no name — a currency pair or a bare
 * currency code, where the description is the ticker again. That subsumes the `{x.description &&
 * …}` guard three of the call sites already carried, so the guard does not have to be repeated
 * beside the one it does not cover.
 *
 * The component is four lines because Vitest runs Node-only and nothing inside one is testable
 * (DDR-0029); the decision lives in `@shared/format.ts`, which is where the tests are.
 */
export function InstrumentName({
  symbol,
  description,
}: {
  symbol: string
  description: string
}): React.JSX.Element {
  const name = instrumentName(symbol, description)
  if (name === null) return <></>
  return <span className="flex-import-file">{name}</span>
}
