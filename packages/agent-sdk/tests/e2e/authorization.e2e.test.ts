import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AuthorizationService,
  IndexerEventRecord,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
  isActiveParticipant,
  registerAuthorizationHandlers,
  VeranaChainService,
  VeranaIndexerService,
} from '../../src/blockchain'

import { PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  IndexerSubscriber,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from './helpers'

const RUN_ID = String(Date.now())
const PP_START_OP = '/verana.pp.v1.MsgStartParticipantOP'
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
}

const MINIMAL_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'OrgCred',
  description: 'e2e org credential schema',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
})

describe('authorization cache (V4): indexer events drive grant -> activate -> revoke', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let veranaChain: VeranaChainService
  let authzChain: VeranaChainService
  let subscriber: IndexerSubscriber | undefined
  let corpId: number
  let policyAddress: string
  let rootParticipantId: number

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    corpId = corp.corporationId
    policyAddress = corp.policyAddress
    await chainA.fundCorporation(policyAddress)
    await chainA.grantOperatorAuthorization(policyAddress)
    const eco = await chainA.createEcosystem(policyAddress, { did: `did:example:eco-${RUN_ID}` })
    const schema = await chainA.createCredentialSchema(policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: MINIMAL_SCHEMA,
    })
    const root = await chainA.createRootParticipant(policyAddress, {
      schemaId: schema.schemaId,
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
    subscriber?.close()
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'refreshes the cache from live indexer events and answers caller checks',
    async () => {
      const opB = await chainA.createFundedOperator()
      authzChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opB.mnemonic,
        corporationAddress: policyAddress,
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      await authzChain.start()

      const indexer = new VeranaIndexerService({
        baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      const authz = new AuthorizationService({
        chain: authzChain,
        indexer,
        logger: new ConsoleLogger(LogLevel.Warn),
        minRefreshIntervalMs: 0,
      })
      const registry = new IndexerHandlerRegistry()
      registerAuthorizationHandlers(registry, authz)

      subscriber = await IndexerSubscriber.connect(stack.indexerWsUrl, { corporationId: corpId })
      const dispatchFromEvent = async (event: IndexerEventRecord): Promise<void> => {
        const ctx: IndexerHandlerContext = {
          agent: {
            config: { logger: new ConsoleLogger(LogLevel.Warn) },
          } as unknown as IndexerHandlerContext['agent'],
          blockHeight: event.block_height,
          operatorAddress: event.payload.sender,
          state: { lastBlockHeight: 0, ecosystems: {}, credentialSchemas: {}, participants: {} },
          txHash: event.tx_hash,
        }
        await registry.dispatch(
          {
            timestamp: event.timestamp,
            block_height: event.block_height,
            entity_type: event.payload.entity_type ?? '',
            entity_id: event.payload.entity_id ?? '',
            msg: event.event_type,
            changes: {},
          },
          ctx,
        )
      }

      const applicant = await chainA.startParticipantOp(policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: rootParticipantId,
        did: `did:example:applicant-${RUN_ID}`,
        vsOperator: opB.address,
        vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
        vsOperatorAuthzWithFeegrant: true,
      })
      await dispatchFromEvent(
        await subscriber.waitForEvent(
          e => e.tx_hash.toLowerCase() === applicant.txHash.toLowerCase(),
          SETUP_TIMEOUT_MS,
        ),
      )

      const granted = authz.getVsOperatorAuthorizationRecord(applicant.participantId)
      expect(granted).toBeDefined()
      expect(granted?.msgTypes).toEqual(expect.arrayContaining([PP_VALIDATE, PP_SESSION]))
      expect(granted?.withFeegrant).toBe(true)
      expect(granted?.expiration).toBeInstanceOf(Date)
      const pending = await until(
        () => indexer.getParticipant(applicant.participantId),
        'the applicant entry',
      )
      expect(authz.canSign(pending, PP_SESSION)).toBe(false)

      const digest = `sha384-${createHash('sha384').update(`cred-${RUN_ID}`).digest('base64')}`
      const validated = await veranaChain.setParticipantOPToValidated({
        id: applicant.participantId,
        opSummaryDigest: digest,
      })
      await dispatchFromEvent(
        await subscriber.waitForEvent(
          e => e.tx_hash.toLowerCase() === validated.txHash.toLowerCase(),
          SETUP_TIMEOUT_MS,
        ),
      )

      // effective_from is the block time, which can run ahead of this clock
      const active = await until(async () => {
        const entry = await indexer.getParticipant(applicant.participantId)
        return isActiveParticipant(entry) ? entry : undefined
      }, 'the applicant entry to turn active')
      expect(authz.canSign(active, PP_VALIDATE)).toBe(true)
      expect(authz.canSign(active, PP_SESSION)).toBe(true)
      expect(authz.canSign(active, PP_START_OP)).toBe(false)

      await expect(authz.callerHoldsOperatorGrant(chainA.address, PP_START_OP)).resolves.toBe(true)
      await expect(authz.callerHoldsOperatorGrant(opB.address, PP_START_OP)).resolves.toBe(false)
      await expect(authz.agentHoldsOperatorGrant(PP_START_OP)).resolves.toBe(false)

      const revoked = await chainA.revokeParticipant(policyAddress, applicant.participantId)
      await dispatchFromEvent(
        await subscriber.waitForEvent(
          e => e.tx_hash.toLowerCase() === revoked.txHash.toLowerCase(),
          SETUP_TIMEOUT_MS,
        ),
      )

      expect(authz.getVsOperatorAuthorizationRecord(applicant.participantId)).toBeUndefined()
      expect(authz.canSign(active, PP_SESSION)).toBe(false)
    },
    SETUP_TIMEOUT_MS,
  )
})
