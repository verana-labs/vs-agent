import { LogLevel, parseDid } from '@credo-ts/core'
import { VsAgentWsInboundTransport } from '@verana-labs/vs-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import { setupAgent } from '../src/utils'

import { getAskarStoreConfig } from './__mocks__'

describe('setupAgent transport ordering', () => {
  it('registers inbound transports without starting them, after the public DID exists', async () => {
    const startSpy = vi.spyOn(VsAgentWsInboundTransport.prototype, 'start')

    const { agent } = await setupAgent({
      port: 3999,
      walletConfig: getAskarStoreConfig('setupAgent ordering'),
      label: 'Ordering Test',
      endpoints: ['wss://ordering.example'],
      publicApiBaseUrl: 'https://ordering.example',
      parsedDid: parseDid('did:webvh:ordering.example'),
      logLevel: LogLevel.Off,
    })

    expect(agent.did).toMatch(/^did:webvh:[^:]+:ordering\.example$/)
    expect(await agent.dids.getCreatedDids({ method: 'webvh' })).toHaveLength(1)
    expect(agent.didcomm.inboundTransports).toHaveLength(1)
    expect(startSpy).not.toHaveBeenCalled()

    await agent.shutdown()
  }, 60_000)
})
