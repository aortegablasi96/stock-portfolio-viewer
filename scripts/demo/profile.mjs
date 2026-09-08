/**
 * The demo owner's investor profile.
 *
 * The profile is not part of a Flex export — it is a *setting* the owner writes in the app, one
 * overwritten `app_meta` value (DDR-0094). So it is authored here and applied by `seed.mjs`
 * rather than generated into `demo/`.
 *
 * It is written to sit **mostly** on top of the demo portfolio, with a few deliberate gaps. A
 * profile that matched every weight would make the drift report say "balanced" eight times and
 * give the assistant nothing to talk about; a profile that matched nothing would make the app
 * look like it disapproves of the portfolio it was handed. The exceptions below are the ones
 * worth a conversation, and each demonstrates something different.
 *
 * Weights are percent of the **live** portfolio including cash, which is the drift report's
 * denominator (the overview's excludes it — DDR-0111). They are as of the last generated close;
 * regenerating moves them by a point or two, which is fine: the bands are ranges.
 */

/**
 * Three claims that hang together with the portfolio *and* with the gaps below. The owner says
 * they want defensive sectors, and the portfolio is underweight them — that is a coherent thing
 * to be wrong about, and a better demo than a preference nothing contradicts.
 */
const styleTags = ['mature_large_cap', 'dividend_income', 'defensive_sectors']

/**
 * Sector policy. Six of the eight bands hold; two do not, and one sector is left out entirely.
 *
 * - **Technology 18–25 against 29%** — over. The portfolio's two largest holdings are both
 *   semiconductors-and-software, which is the classic thing an owner does not notice until
 *   something adds the two up.
 * - **Consumer, Non-cyclical 10–16 against 7%** — under, and it contradicts the
 *   `defensive_sectors` tag above. The other half of the same conversation.
 * - **Communications is absent.** Not a target of zero — no policy at all, so its 7% surfaces as
 *   an untargeted residual rather than a breach. The distinction is the one DDR-0094 says an
 *   owner cannot see if the app quietly fills blanks with defaults.
 */
const sectorTargets = [
  { key: 'Technology', low: 18, high: 25 },
  { key: 'Financial', low: 10, high: 16 },
  { key: 'Basic Materials', low: 6, high: 12 },
  { key: 'Industrial', low: 6, high: 12 },
  { key: 'Energy', low: 5, high: 10 },
  { key: 'Consumer, Cyclical', low: 5, high: 10 },
  { key: 'Consumer, Non-cyclical', low: 10, high: 16 },
]

/**
 * Currency policy. Five of six bands hold — the home currency among them, at 42% inside 40–55 —
 * and one does not: **GBP 5–12 against 13%**. One mining holding has quietly grown into more
 * sterling than the owner said they wanted, which is the kind of drift nobody notices, because
 * nothing about the position itself changed.
 *
 * Currency is also the one dimension where the app has no baseline of its own to fall back on:
 * ADR-0012 deliberately declines to set a currency ceiling, since the app cannot know where the
 * owner's liabilities are. Leave this dimension blank and the app says nothing about currency at
 * all — correctly, and unhelpfully for a demo.
 */
const currencyTargets = [
  { key: 'EUR', low: 40, high: 55 },
  { key: 'USD', low: 15, high: 30 },
  { key: 'GBP', low: 5, high: 12 },
  { key: 'JPY', low: 3, high: 10 },
  { key: 'CHF', low: 3, high: 10 },
  { key: 'CAD', low: 3, high: 10 },
]

/**
 * Asset class and position size are **left unset on purpose**, so the app's own published
 * baseline is what speaks for them (ADR-0012) and the demo shows both standards side by side,
 * each attributed.
 *
 * - No asset-class target, so the baseline's cash ceiling applies (9% against 15%: inside) and
 *   its coverage check observes that the portfolio holds nothing but equities and cash.
 * - No position-size range, so the baseline's 10% ceiling applies and flags the largest holding
 *   (ASML, 15%). A nine-position portfolio averages 11%, so this is not a trap the demo fell
 *   into — it is the app correctly reporting a concentrated book against a standard the owner
 *   never set, and saying out loud whose standard it is.
 *
 * The sector check is *deferred* rather than applied, because the owner did set sector targets.
 * That contrast — three baseline checks applied, one stood down — is the whole of ADR-0012 on
 * one screen.
 */
export const DEMO_PROFILE = {
  styleTags,
  currencyTargets,
  sectorTargets,
  assetClassTargets: [],
  positionSize: null,
}
