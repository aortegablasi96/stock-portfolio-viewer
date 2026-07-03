import { describe, it, expect } from 'vitest'
import { systemService } from './systemService'

describe('systemService.ping', () => {
  it('replies pong and echoes the message', () => {
    const res = systemService.ping({ message: 'hi there' })

    expect(res.reply).toBe('pong')
    expect(res.echo).toBe('hi there')
  })

  it('stamps an ISO-8601 timestamp', () => {
    const res = systemService.ping({ message: 'x' })

    // Round-trips through Date without loss => valid ISO string.
    expect(res.at).toBe(new Date(res.at).toISOString())
  })
})
