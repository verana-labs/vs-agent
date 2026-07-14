import type { VsAgent } from '../../src/agent/VsAgent'

import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ParticipantRole,
  ParticipantState,
  VeranaChainService,
  VeranaIndexerService,
} from '../../src/blockchain'
import { EcsBootstrapService } from '../../src/bootstrap/EcsBootstrapService'

import { PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
import { COOLUSER_MNEMONIC, SETUP_TIMEOUT_MS, startStack, type StartedStack } from './helpers'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const AGENT_DID = `did:example:agent-${RUN_ID}`

const ecsSchema = (title: string) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: `e2e ${title}`,
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  })

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => undefined)
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 3_000))
  }
  throw new Error('condition did not resolve in time')
}

describeE2E('ECS bootstrap (V4): standalone against a live chain and indexer', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let agentChain: VeranaChainService
  let indexer: VeranaIndexerService
  let ecosystemId: number
  let orgSchemaId: number
  let serviceSchemaId: number

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    await chainA.fundCorporation(corp.policyAddress)
    await chainA.grantOperatorAuthorization(corp.policyAddress)
    const eco = await chainA.createEcosystem(corp.policyAddress, { did: `did:example:eco-${RUN_ID}` })
    ecosystemId = eco.ecosystemId

    const org = await chainA.createCredentialSchema(corp.policyAddress, {
      ecosystemId,
      jsonSchema: ecsSchema('OrganizationCredential'),
    })
    orgSchemaId = org.schemaId
    const service = await chainA.createCredentialSchema(corp.policyAddress, {
      ecosystemId,
      jsonSchema: ecsSchema('ServiceCredential'),
    })
    serviceSchemaId = service.schemaId

    const orgRoot = await chainA.createRootParticipant(corp.policyAddress, {
      schemaId: orgSchemaId,
      did: `did:example:org-root-${RUN_ID}`,
    })
    await chainA.createRootParticipant(corp.policyAddress, {
      schemaId: serviceSchemaId,
      did: `did:example:service-root-${RUN_ID}`,
    })

    agentChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corp.policyAddress,
      logger: new ConsoleLogger(LogLevel.Warn),
    })
    await agentChain.start()

    const issuer = await chainA.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: orgRoot.participantId,
      did: `did:example:org-issuer-${RUN_ID}`,
    })
    await agentChain.setParticipantOPToValidated({ id: issuer.participantId, opSummaryDigest: 'sha384-x' })

    indexer = new VeranaIndexerService({
      baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
      logger: new ConsoleLogger(LogLevel.Warn),
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'discovers the ECS schemas, starts both onboarding OPs, and is idempotent',
    async () => {
      await until(async () => {
        const issuers = await indexer.listParticipants({
          schemaId: orgSchemaId,
          role: ParticipantRole.Issuer,
          participantState: ParticipantState.Active,
        })
        return issuers.length > 0 ? issuers : undefined
      })

      const agent = {
        did: AGENT_DID,
        label: 'bootstrap-e2e',
        publicApiBaseUrl: 'https://agent.example',
        veranaChain: agentChain,
        config: { logger: new ConsoleLogger(LogLevel.Warn) },
        events: { on: () => undefined },
        dependencyManager: { resolve: () => ({ findAllByQuery: async () => [] }) },
      } as unknown as VsAgent

      const bootstrap = new EcsBootstrapService(
        agent,
        indexer,
        { mode: 'standalone', trustedEcosystemDids: [`did:example:eco-${RUN_ID}`] },
        new ConsoleLogger(LogLevel.Info),
      )
      await bootstrap.run()

      const holder = await until(async () => {
        const list = await indexer.listParticipants({ did: AGENT_DID, role: ParticipantRole.Holder })
        return list.length > 0 ? list[0] : undefined
      })
      expect(Number(holder.schema_id)).toBe(orgSchemaId)
      expect(holder.op_state).toBe('PENDING')

      const serviceIssuer = await until(async () => {
        const list = await indexer.listParticipants({ did: AGENT_DID, role: ParticipantRole.Issuer })
        return list.length > 0 ? list[0] : undefined
      })
      expect(Number(serviceIssuer.schema_id)).toBe(serviceSchemaId)

      await bootstrap.run()
      const all = await indexer.listParticipants({ did: AGENT_DID, role: undefined })
      expect(all).toHaveLength(2)
    },
    SETUP_TIMEOUT_MS,
  )
})
