import { z } from 'zod'
import { portfolioOverviewSchema } from '@shared/domain/portfolio'

/**
 * The typed contract for every IPC channel: the Zod schema used by the main
 * process to validate renderer input at the boundary, the inferred request/
 * response types, and the shape of the `window.api` bridge exposed to the
 * renderer.
 *
 * The renderer and preload import only the *types* from this module (erased at
 * compile time), so Zod never reaches the renderer bundle. The main process
 * imports the schemas at runtime to validate.
 */

// ---- app:ping ---------------------------------------------------------------

export const pingRequestSchema = z.object({
  message: z.string().min(1).max(200),
})
export type PingRequest = z.infer<typeof pingRequestSchema>

export const pingResponseSchema = z.object({
  reply: z.literal('pong'),
  echo: z.string(),
  at: z.string().datetime(),
})
export type PingResponse = z.infer<typeof pingResponseSchema>

// ---- portfolio:getOverview --------------------------------------------------

/**
 * The read-only portfolio overview result. Connection state is modelled as *data*,
 * not thrown exceptions, so the renderer can render the `not_connected` and `error`
 * states as first-class UI (see the M1 Architecture Review and ADR-0004). The IPC
 * handler maps `IbkrNotConnectedError` / other failures onto these variants.
 *
 * `getPortfolioOverview` takes no payload, so there is no request schema to validate.
 */
export const portfolioOverviewResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), overview: portfolioOverviewSchema }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type PortfolioOverviewResult = z.infer<typeof portfolioOverviewResultSchema>

// ---- window.api bridge shape ------------------------------------------------

/**
 * The API surface exposed on `window.api` by the preload script. Both the
 * preload (implementation) and the renderer (consumer) reference this type so
 * the bridge stays in sync with a single source of truth.
 */
export interface RendererApi {
  ping: (request: PingRequest) => Promise<PingResponse>
  getPortfolioOverview: () => Promise<PortfolioOverviewResult>
}
