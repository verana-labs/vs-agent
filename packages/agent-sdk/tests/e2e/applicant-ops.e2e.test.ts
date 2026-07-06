import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ValidationState, VeranaChainService, VeranaIndexerService } from '../../src/blockchain'

import { PARTICIPANT_ROLE_HOLDER, PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
import { COOLUSER_MNEMONIC, SETUP_TIMEOUT_MS, startStack, type StartedStack } from './helpers'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const MINIMAL_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'OrgCred',
  description: 'e2e org credential schema',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
})

// The root validator has a future effective_from; retry until it is ACTIVE.
async function untilEffective<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < 12; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!String((e as Error).message).includes('not yet effective')) throw e
      await new Promise(r => setTimeout(r, 3_000))
    }
  }
  throw lastErr
}

describeE2E('applicant-side chain ops (V4)', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let veranaChain: VeranaChainService
  let rootParticipantId: number
  let schemaId: number
  let ecosystemId: number
  let corpId: number
  let corp2Id: number | undefined
  let policyAddress: string

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    corpId = corp.corporationId
    policyAddress = corp.policyAddress
    await chainA.fundCorporation(policyAddress)
    await chainA.grantOperatorAuthorization(policyAddress)
    const eco = await chainA.createEcosystem(policyAddress, { did: `did:example:eco-${RUN_ID}` })
    ecosystemId = eco.ecosystemId
    const schema = await chainA.createCredentialSchema(policyAddress, {
      ecosystemId,
      jsonSchema: MINIMAL_SCHEMA,
    })
    schemaId = schema.schemaId
    const root = await chainA.createRootParticipant(policyAddress, {
      schemaId,
      did: `did:example:validator-${RUN_ID}`,
    })
    rootParticipantId = root.participantId

    veranaChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: policyAddress,
      logger: new ConsoleLogger(LogLevel.Warn),
    })
    await veranaChain.start()
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'runs the full applicant OP lifecycle: start, validate, renew, cancel-renewal, cancel-pending',
    async () => {
      const { participantId } = await untilEffective(() =>
        veranaChain.startParticipantOP({
          role: PARTICIPANT_ROLE_ISSUER,
          validatorParticipantId: rootParticipantId,
          did: `did:example:applicant-${RUN_ID}`,
        }),
      )
      expect(participantId).toBeGreaterThan(0)
      expect((await veranaChain.getParticipant(participantId))?.opState).toBe(ValidationState.PENDING)

      const digest = `sha384-${createHash('sha384').update(`cred-${RUN_ID}`).digest('base64')}`
      await veranaChain.setParticipantOPToValidated({ id: participantId, opSummaryDigest: digest })
      expect((await veranaChain.getParticipant(participantId))?.opState).toBe(ValidationState.VALIDATED)

      await veranaChain.renewParticipantOP(participantId)
      expect((await veranaChain.getParticipant(participantId))?.opState).toBe(ValidationState.PENDING)

      await veranaChain.cancelParticipantOPLastRequest(participantId)
      expect((await veranaChain.getParticipant(participantId))?.opState).toBe(ValidationState.VALIDATED)

      const second = await veranaChain.startParticipantOP({
        role: 2,
        validatorParticipantId: rootParticipantId,
        did: `did:example:applicant2-${RUN_ID}`,
      })
      await veranaChain.cancelParticipantOPLastRequest(second.participantId)
      expect((await veranaChain.getParticipant(second.participantId))?.opState).toBe(
        ValidationState.TERMINATED,
      )
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'self-creates an ISSUER participant on an OPEN-mode schema',
    async () => {
      const open = await chainA.createCredentialSchema(policyAddress, {
        ecosystemId,
        jsonSchema: MINIMAL_SCHEMA,
        issuerOnboardingMode: 1,
      })

      const openRoot = await chainA.createRootParticipant(policyAddress, {
        schemaId: open.schemaId,
        did: `did:example:open-root-${RUN_ID}`,
      })

      const { participantId, txHash } = await veranaChain.selfCreateParticipant({
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: openRoot.participantId,
        did: `did:example:self-${RUN_ID}`,
        effectiveFrom: new Date(Date.now() + 5_000),
        effectiveUntil: new Date(Date.now() + 30 * 24 * 3_600_000),
      })
      expect(txHash).toMatch(/^[0-9A-F]{64}$/i)
      expect(participantId).toBeGreaterThan(0)
      expect((await veranaChain.getParticipant(participantId))?.did).toBe(`did:example:self-${RUN_ID}`)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'reads ecosystem, schema, and authorizations through the chain query surface',
    async () => {
      const eco = await veranaChain.getEcosystem(ecosystemId)
      expect(eco?.id).toBe(ecosystemId)
      expect(eco?.did).toBe(`did:example:eco-${RUN_ID}`)
      expect(eco?.corporationId).toBe(corpId)

      const schema = await veranaChain.getCredentialSchema(schemaId)
      expect(schema?.id).toBe(schemaId)
      expect(schema?.ecosystemId).toBe(ecosystemId)
      expect(JSON.parse(schema?.jsonSchema ?? '{}').title).toBe('OrgCred')

      const oas = await veranaChain.listOperatorAuthorizations()
      expect(oas.some(a => a.msgTypes.includes('/verana.pp.v1.MsgStartParticipantOP'))).toBe(true)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'validates and creates the session under ONE vs_operator (AUTHZ-CHECK-3 single-account)',
    async () => {
      const single = await chainA.createFundedOperator()

      const corp2 = await chainA.createCorporation({ did: `did:example:corp2-${RUN_ID}` })
      corp2Id = corp2.corporationId
      await chainA.fundCorporation(corp2.policyAddress)
      await chainA.grantOperatorAuthorization(corp2.policyAddress)
      const eco2 = await chainA.createEcosystem(corp2.policyAddress, { did: `did:example:eco2-${RUN_ID}` })
      const schema2 = await chainA.createCredentialSchema(corp2.policyAddress, {
        ecosystemId: eco2.ecosystemId,
        jsonSchema: MINIMAL_SCHEMA,
      })
      const root2 = await chainA.createRootParticipant(corp2.policyAddress, {
        schemaId: schema2.schemaId,
        did: `did:example:validator2-${RUN_ID}`,
      })

      const issuer = await chainA.startParticipantOp(corp2.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root2.participantId,
        did: `did:example:issuer-${RUN_ID}`,
        vsOperator: single.address,
        vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
      })
      const digest = `sha384-${createHash('sha384').update(`issuer-${RUN_ID}`).digest('base64')}`
      const validatorChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: COOLUSER_MNEMONIC,
        corporationAddress: corp2.policyAddress,
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      await validatorChain.start()
      await validatorChain.setParticipantOPToValidated({ id: issuer.participantId, opSummaryDigest: digest })

      const holder = await chainA.startParticipantOp(corp2.policyAddress, {
        role: PARTICIPANT_ROLE_HOLDER,
        validatorParticipantId: issuer.participantId,
        did: `did:example:holder-${RUN_ID}`,
      })

      const singleChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: single.mnemonic,
        corporationAddress: corp2.policyAddress,
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      await singleChain.start()

      const vsoas = await singleChain.listVsOperatorAuthorizations()
      const record = vsoas.flatMap(a => a.records).find(r => r.participantId === issuer.participantId)
      expect(record?.msgTypes).toEqual(expect.arrayContaining([PP_VALIDATE, PP_SESSION]))

      await singleChain.setParticipantOPToValidated({ id: holder.participantId, opSummaryDigest: '' })
      expect((await singleChain.getParticipant(holder.participantId))?.opState).toBe(
        ValidationState.VALIDATED,
      )
      const session = await singleChain.createOrUpdateParticipantSession({
        id: randomUUID(),
        issuerParticipantId: issuer.participantId,
        agentParticipantId: 0,
        walletAgentParticipantId: 0,
        digest,
      })
      expect(session.txHash).toMatch(/^[0-9A-F]{64}$/i)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'is indexed with the exact event_type strings the notification handlers key on',
    async () => {
      const indexer = new VeranaIndexerService({
        baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
        logger: new ConsoleLogger(LogLevel.Warn),
      })

      const expected = [
        'StartParticipantOP',
        'SetParticipantOPToValidated',
        'RenewParticipantOP',
        'CancelParticipantOPLastRequest',
        'SelfCreateParticipant',
      ]
      const deadline = Date.now() + 120_000
      let seen = new Set<string>()
      while (Date.now() < deadline) {
        seen = new Set<string>()
        for (const corp of [corpId, corp2Id].filter((c): c is number => c != null)) {
          const page = await indexer.getEvents('', 0, 500, corp).catch(() => undefined)
          for (const e of page?.events ?? []) seen.add(e.event_type)
        }
        if (expected.every(t => seen.has(t))) break
        await new Promise(r => setTimeout(r, 3_000))
      }
      for (const t of expected) {
        expect(seen).toContain(t)
      }
    },
    SETUP_TIMEOUT_MS,
  )
})
