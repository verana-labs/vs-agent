import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { VeranaTestChain, type CorporationResult } from './VeranaTestChain'
import { CHAIN_ID, COOLUSER_MNEMONIC, startVeranaNode, type StartedVeranaNode } from './veranaNode'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const SETUP_TIMEOUT_MS = Number(process.env.FLOW_SETUP_TIMEOUT_MS || 1_200_000)
const STEP_TIMEOUT_MS = Number(process.env.FLOW_STEP_TIMEOUT_MS || 120_000)

const RUN_ID = String(Date.now())
const CORP_DID = `did:example:corporation-${RUN_ID}`
const ECO_DID = `did:example:ecosystem-${RUN_ID}`

describeE2E('Verana chain flow: corporation + ecosystem (testcontainers + CosmJS)', () => {
  let node: StartedVeranaNode
  let chain: VeranaTestChain
  let corporation: CorporationResult

  beforeAll(async () => {
    node = await startVeranaNode()
    chain = await VeranaTestChain.connect(node.rpcUrl, COOLUSER_MNEMONIC)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chain?.disconnect()
    await node?.stop().catch(() => undefined)
  })

  it('connects to the expected chain with the funded operator wallet', () => {
    expect(chain.chainId).toBe(CHAIN_ID)
    expect(chain.address).toMatch(/^verana1/)
  })

  it(
    'creates a corporation',
    async () => {
      corporation = await chain.createCorporation({ did: CORP_DID })
      expect(corporation.policyAddress).toMatch(/^verana1/)
      expect(corporation.corporationId).toBeGreaterThan(0)
    },
    STEP_TIMEOUT_MS,
  )

  it(
    'creates an ecosystem under the corporation',
    async () => {
      // The ecosystem path needs the corporation funded and the operator granted first.
      await chain.fundCorporation(corporation.policyAddress)
      await chain.grantOperatorAuthorization(corporation.policyAddress)

      const ecosystem = await chain.createEcosystem(corporation.policyAddress, { did: ECO_DID })
      expect(ecosystem.ecosystemId).toBeGreaterThan(0)
    },
    STEP_TIMEOUT_MS,
  )
})
