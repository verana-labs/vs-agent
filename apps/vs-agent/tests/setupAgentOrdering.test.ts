import { ConsoleLogger, LogLevel, parseDid } from '@credo-ts/core'
import { VtFlowModuleConfig } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VeranaIndexerService, VsAgentWsInboundTransport } from '@verana-labs/vs-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import { setupAgent } from '../src/utils'

import { getAskarStoreConfig } from './__mocks__'

describe('setupAgent transport ordering', () => {
  it('registers inbound transports without starting them, after the public DID exists', async () => {
    const startSpy = vi.spyOn(VsAgentWsInboundTransport.prototype, 'start')

    const { agent } = await setupAgent({
      port: 3999,
      walletConfig: getAskarStoreConfig('setupAgent ordering'),
      endpoints: ['wss://ordering.example'],
      publicApiBaseUrl: 'https://ordering.example',
      indexer: new VeranaIndexerService({
        baseUrl: 'https://indexer.invalid',
        logger: new ConsoleLogger(LogLevel.Off),
      }),
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

describe('setupAgent vt-flow', () => {
  it('accepts an onboarding-request on its own ([VSA-VTI-FLOW-OP-OR])', async () => {
    const { agent } = await setupAgent({
      port: 3998,
      walletConfig: getAskarStoreConfig('setupAgent vt-flow'),
      endpoints: ['wss://vtflow.example'],
      publicApiBaseUrl: 'https://vtflow.example',
      indexer: new VeranaIndexerService({
        baseUrl: 'https://indexer.invalid',
        logger: new ConsoleLogger(LogLevel.Off),
      }),
      parsedDid: parseDid('did:webvh:vtflow.example'),
      logLevel: LogLevel.Off,
    })

    expect(agent.dependencyManager.resolve(VtFlowModuleConfig).autoAcceptOnboardingRequest).toBe(true)

    await agent.shutdown()
  }, 60_000)
})
