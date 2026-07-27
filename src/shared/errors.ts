/**
 * Typed application errors shared across the main process (services, repositories,
 * IPC handlers). Expected domain/infrastructure failures throw one of these rather
 * than a raw `Error`, so IPC handlers can map them to a serializable result the
 * renderer can render as a first-class state (see ADR-0002, ADR-0004).
 *
 * These are used only in the main process; the renderer never imports this module —
 * it receives the mapped, serialized result over IPC.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Input or domain-shape validation failed. */
export class ValidationError extends AppError {}

/** A requested entity does not exist. */
export class NotFoundError extends AppError {}

/**
 * The Interactive Brokers Client Portal Gateway is unreachable or the session is
 * not authenticated. Surfaced to the renderer as the `not_connected` state so the
 * UI can prompt the owner to start / log into the gateway (ADR-0004).
 */
export class IbkrNotConnectedError extends AppError {}

/**
 * A request to the IBKR gateway exceeded its bounded wait and was aborted (Story #104).
 * Deliberately *not* a subclass of `IbkrNotConnectedError`: a refused connection means the
 * gateway isn't running, whereas a stall means it accepted the connection and then went
 * quiet — usually a half-expired session — and the two need different recovery advice.
 * Surfaced to the renderer as its own `not_responding` state (DDR-0022).
 */
export class IbkrTimeoutError extends AppError {}

/** The IBKR gateway responded, but with an error status or an unexpected shape. */
export class IbkrGatewayError extends AppError {}
