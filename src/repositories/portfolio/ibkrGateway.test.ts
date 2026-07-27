import { createServer, type RequestListener, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ibkrGateway } from './ibkrGateway'
import { IbkrGatewayError, IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

/**
 * Transport-level tests for the gateway client (Story #104).
 *
 * These drive a **real local HTTP server** rather than mocking `node:https`, because the
 * behaviour under test *is* the transport: a request whose connection is accepted and then
 * stalls must still settle. Mocking the socket would only prove the mock. The server binds
 * `127.0.0.1:0` (an OS-assigned port) and speaks plain HTTP, so nothing leaves the machine and
 * the self-signed-certificate path is untouched. The deadline is shortened through the same
 * `IBKR_GATEWAY_TIMEOUT_MS` env override the gateway reads in production.
 */

let server: Server | undefined

/** Start a local gateway stand-in on a short deadline and point the client at it. */
async function startGateway(handler: RequestListener, timeoutMs = 80): Promise<void> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port assigned')
  process.env['IBKR_GATEWAY_URL'] = `http://127.0.0.1:${address.port}`
  process.env['IBKR_GATEWAY_TIMEOUT_MS'] = String(timeoutMs)
}

afterEach(async () => {
  delete process.env['IBKR_GATEWAY_URL']
  delete process.env['IBKR_GATEWAY_TIMEOUT_MS']
  if (!server) return
  const closing = server
  server = undefined
  // Destroy in-flight sockets too: a stalled request is deliberately never answered, so
  // `close()` alone would wait on it forever and hang the suite.
  closing.closeAllConnections()
  await new Promise<void>((resolve) => closing.close(() => resolve()))
})

describe('ibkrGateway request timeout', () => {
  it('gives up on a connection that is accepted and then never answers', async () => {
    // The exact failure the story is about: the gateway completes the TCP handshake — so no
    // ECONNREFUSED is ever emitted — and then goes silent. Before the bound, this hung forever.
    await startGateway(() => {
      /* accept the request, write nothing, never end the response */
    })

    await expect(ibkrGateway.getAuthStatus()).rejects.toBeInstanceOf(IbkrTimeoutError)
  })

  it('gives up on a response whose body starts and then stalls mid-stream', async () => {
    // A socket-inactivity timeout would be reset by these bytes and never fire; the bound is a
    // whole-request deadline precisely so a trickling response is still bounded.
    await startGateway((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '64' })
      res.write('{"authenticated":')
      // deliberately never completed
    })

    await expect(ibkrGateway.getAuthStatus()).rejects.toBeInstanceOf(IbkrTimeoutError)
  })

  it('bounds every endpoint, not just the auth check', async () => {
    await startGateway(() => {
      /* stall */
    })

    await expect(ibkrGateway.getPositions('U1')).rejects.toBeInstanceOf(IbkrTimeoutError)
    await expect(ibkrGateway.getLedger('U1')).rejects.toBeInstanceOf(IbkrTimeoutError)
    await expect(ibkrGateway.getExchangeRate('USD', 'EUR')).rejects.toBeInstanceOf(IbkrTimeoutError)
    await expect(ibkrGateway.getContractClassification(1)).rejects.toBeInstanceOf(IbkrTimeoutError)
  })

  it('carries the bound in its message so the state is self-explaining', async () => {
    await startGateway(() => {
      /* stall */
    }, 250)

    await expect(ibkrGateway.getAuthStatus()).rejects.toThrow(/within 0\.25s/)
  })

  it('does not fire the timeout against a gateway that answers in time', async () => {
    await startGateway((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ authenticated: true, connected: true }))
    }, 2_000)

    await expect(ibkrGateway.getAuthStatus()).resolves.toMatchObject({ authenticated: true })
    // The deadline must not settle the promise a second time or leave a live timer behind.
    await expect(ibkrGateway.ensureAuthenticated()).resolves.toBeUndefined()
  })

  it('keeps an unauthenticated session distinct from a stall', async () => {
    // A 401 is a prompt answer, not a timeout — it must stay `not_connected` (log in), so the
    // two recovery paths don't collapse into one.
    await startGateway((_req, res) => {
      res.writeHead(401)
      res.end('Access Denied')
    }, 2_000)

    await expect(ibkrGateway.getAuthStatus()).rejects.toBeInstanceOf(IbkrNotConnectedError)
  })

  it('keeps a bad-status response an ordinary gateway error, not a stall', async () => {
    await startGateway((_req, res) => {
      res.writeHead(500)
      res.end('boom')
    }, 2_000)

    await expect(ibkrGateway.getAuthStatus()).rejects.toBeInstanceOf(IbkrGatewayError)
  })

  it('still reports a refused connection as not-connected, not a stall', async () => {
    // Nothing listening: the gateway isn't running, which is a different fix for the owner
    // than a gateway that is running and silent.
    process.env['IBKR_GATEWAY_URL'] = 'http://127.0.0.1:1'
    process.env['IBKR_GATEWAY_TIMEOUT_MS'] = '2000'

    await expect(ibkrGateway.getAuthStatus()).rejects.toBeInstanceOf(IbkrNotConnectedError)
  })
})
