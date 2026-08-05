import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import {
  ParticipantRole,
  ParticipantState,
  parseSchemaRef,
  VeranaChainService,
  VeranaIndexerService,
} from '@verana-labs/vs-agent-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PARTICIPANT_ROLE_ISSUER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  CHAIN_ID,
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { buildIssuerRestrictions } from '../../src/controllers/admin/credentials/CredentialTypeService'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const badgeSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ECS-Badge',
  description: 'multi-issuer badge',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
})

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => undefined)
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 2_000))
  }
  throw new Error('condition did not resolve in time')
}

describeE2E('accredited issuer resolution for issuer-agnostic presentation requests', () => {
  let stack: StartedStack
  let chain: VeranaTestChain
  let seeder: VeranaChainService
  let indexer: VeranaIndexerService
  let schemaId: number
  const didIssuerA = `did:example:issuer-a-${RUN_ID}`
  const didIssuerB = `did:example:issuer-b-${RUN_ID}`
  const didIssuerPending = `did:example:issuer-pending-${RUN_ID}`
  const logger = new ConsoleLogger(LogLevel.Warn)

  beforeAll(async () => {
    stack = await startStack()
    chain = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
    indexer = new VeranaIndexerService({
      baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
      logger,
    })

    const corpEco = await chain.createCorporation({ did: `did:example:eco-corp-${RUN_ID}` })
    await chain.fundCorporation(corpEco.policyAddress)
    await chain.grantOperatorAuthorization(corpEco.policyAddress)
    const eco = await chain.createEcosystem(corpEco.policyAddress, { did: `did:example:eco-${RUN_ID}` })
    const schema = await chain.createCredentialSchema(corpEco.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: badgeSchema,
    })
    schemaId = schema.schemaId
    const root = await chain.createRootParticipant(corpEco.policyAddress, {
      schemaId,
      did: `did:example:badge-root-${RUN_ID}`,
    })

    seeder = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corpEco.policyAddress,
      logger,
    })
    await seeder.start()

    // The overlap check keys on (schema_id, role, validator_participant_id, corporation_id), so each
    // issuer of the same schema must live in its own corporation.
    const accreditIssuer = async (did: string, corpDid: string, opSummaryDigest?: string): Promise<void> => {
      const corp = await chain.createCorporation({ did: corpDid })
      await chain.fundCorporation(corp.policyAddress)
      await chain.grantOperatorAuthorization(corp.policyAddress)
      const operator = await chain.createFundedOperator()
      const op = await chain.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root.participantId,
        did,
        vsOperator: operator.address,
        vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
      })
      if (opSummaryDigest) {
        await seeder.setParticipantOPToValidated({ id: op.participantId, opSummaryDigest })
      }
    }

    await accreditIssuer(didIssuerA, `did:example:corp-a-${RUN_ID}`, 'sha384-a')
    await accreditIssuer(didIssuerB, `did:example:corp-b-${RUN_ID}`, 'sha384-b')
    await accreditIssuer(didIssuerPending, `did:example:corp-pending-${RUN_ID}`)

    await until(async () => {
      const issuers = await indexer.listParticipants({
        schemaId,
        role: ParticipantRole.Issuer,
        participantState: ParticipantState.Active,
      })
      const dids = issuers.map(issuer => issuer.did)
      return dids.includes(didIssuerA) && dids.includes(didIssuerB) ? true : undefined
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chain?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'resolves an issuer_id restriction for every accredited active issuer of the schema',
    async () => {
      const jsonSchemaRef = `vpr:verana:${CHAIN_ID}:cs:${schemaId}`
      const parsedSchemaId = parseSchemaRef(jsonSchemaRef)
      expect(parsedSchemaId).toBe(schemaId)

      const issuers = await indexer.listParticipants({
        schemaId: parsedSchemaId,
        role: ParticipantRole.Issuer,
        participantState: ParticipantState.Active,
      })
      const restrictions = buildIssuerRestrictions(issuers)

      expect(restrictions).toEqual(
        expect.arrayContaining([{ issuer_id: didIssuerA }, { issuer_id: didIssuerB }]),
      )
      expect(restrictions).not.toContainEqual({ issuer_id: didIssuerPending })
    },
    SETUP_TIMEOUT_MS,
  )
})
