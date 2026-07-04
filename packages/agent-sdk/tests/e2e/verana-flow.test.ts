import '@openwallet-foundation/askar-nodejs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { VsAgent } from '../../src/agent'
import { IndexerWebSocketService } from '../../src/blockchain'
import { IndexerActivity } from '../../src/blockchain/types'
import { VsAgentEventTypes } from '../../src/events'
import { startAgent } from '../__mocks__/startTestAgent'

import { VeranaTestChain, type CorporationResult } from './VeranaTestChain'
import {
  CHAIN_ID,
  COOLUSER_MNEMONIC,
  EVENT_TIMEOUT_MS,
  IndexerSubscriber,
  SETUP_TIMEOUT_MS,
  sameTx,
  startStack,
  type StartedStack,
} from './helpers'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const CORP_DID = `did:example:corporation-${RUN_ID}`
const ECO_DID = `did:example:ecosystem-${RUN_ID}`

describeE2E('Verana blockchain integration (node + indexer, CosmJS + WebSocket)', () => {
  let stack: StartedStack
  let chain: VeranaTestChain
  let subscriber: IndexerSubscriber
  let corporation: CorporationResult
  let agent: VsAgent

  beforeAll(async () => {
    stack = await startStack()
    chain = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
    subscriber = await IndexerSubscriber.connect(stack.indexerWsUrl)
    agent = await startAgent({ label: 'IndexerAgent', domain: 'indexeragent' })
    await agent.initialize()
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    subscriber?.close()
    chain?.disconnect()
    await agent?.shutdown()
    await stack?.stop().catch(() => undefined)
  })

  it('connects to the expected chain with the funded operator wallet', () => {
    expect(chain.chainId).toBe(CHAIN_ID)
    expect(chain.address).toMatch(/^verana1/)
  })

  it(
    'creates a corporation and streams it over the WebSocket',
    async () => {
      corporation = await chain.createCorporation({ did: CORP_DID })
      expect(corporation.policyAddress).toMatch(/^verana1/)
      expect(corporation.corporationId).toBeGreaterThan(0)

      const event = await subscriber.waitForEvent(sameTx(corporation.txHash), EVENT_TIMEOUT_MS)
      expect(event.payload.message_type).toContain('MsgCreateCorporation')
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'creates an ecosystem and streams it over the WebSocket',
    async () => {
      await chain.fundCorporation(corporation.policyAddress)
      await chain.grantOperatorAuthorization(corporation.policyAddress)
      const ecosystem = await chain.createEcosystem(corporation.policyAddress, { did: ECO_DID })
      expect(ecosystem.ecosystemId).toBeGreaterThan(0)

      const event = await subscriber.waitForEvent(sameTx(ecosystem.txHash), EVENT_TIMEOUT_MS)
      expect(event.payload.message_type).toContain('MsgCreateEcosystem')

      // Include internal event validation
      const service = new IndexerWebSocketService({ indexerUrl: stack.indexerWsUrl, agent })
      const activity: IndexerActivity = {
        timestamp: event.timestamp,
        block_height: event.block_height,
        entity_type: event.payload.entity_type ?? 'Ecosystem',
        entity_id: event.payload.entity_id ?? '',
        msg: event.event_type,
        changes: {},
      }
      const emitSpy = vi.spyOn(agent.events, 'emit')
      await (service as any).applyChanges(event, activity)

      const notification = emitSpy.mock.calls
        .map(call => call[1] as any)
        .find(emitted => emitted?.type === VsAgentEventTypes.IndexerNotification)
      expect(notification).toBeDefined()
      expect(notification.payload.event).toMatchObject({
        msg: event.event_type,
        blockHeight: event.block_height,
        txHash: event.tx_hash,
      })
    },
    SETUP_TIMEOUT_MS,
  )
})
