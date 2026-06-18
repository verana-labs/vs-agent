import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

  beforeAll(async () => {
    stack = await startStack()
    chain = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
    subscriber = await IndexerSubscriber.connect(stack.indexerWsUrl)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    subscriber?.close()
    chain?.disconnect()
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
    },
    SETUP_TIMEOUT_MS,
  )
})
