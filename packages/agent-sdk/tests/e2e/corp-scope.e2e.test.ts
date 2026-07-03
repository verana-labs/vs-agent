import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { VeranaIndexerService } from '../../src/blockchain'

import { PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  IndexerSubscriber,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from './helpers'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())

const MINIMAL_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'OrgCred',
  description: 'e2e org credential schema',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
})

const corpIdsOf = (event: {
  payload: { corporation_id?: number; related_corporation_ids?: number[] }
}): number[] => [
  ...(event.payload.corporation_id != null ? [event.payload.corporation_id] : []),
  ...(event.payload.related_corporation_ids ?? []),
]

describeE2E('indexer corp-scope (v4): chain -> indexer -> agent', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let subscriber: IndexerSubscriber | undefined

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    subscriber?.close()
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'delivers corp-scoped events with v4 payload values over WS subscribe and REST catch-up',
    async () => {
      const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
      await chainA.fundCorporation(corp.policyAddress)
      await chainA.grantOperatorAuthorization(corp.policyAddress)
      const eco = await chainA.createEcosystem(corp.policyAddress, { did: `did:example:eco-${RUN_ID}` })
      const schema = await chainA.createCredentialSchema(corp.policyAddress, {
        ecosystemId: eco.ecosystemId,
        jsonSchema: MINIMAL_SCHEMA,
      })
      const root = await chainA.createRootParticipant(corp.policyAddress, {
        schemaId: schema.schemaId,
        did: `did:example:validator-${RUN_ID}`,
      })

      // Subscribe corp-scoped BEFORE the next tx so it arrives on the live stream
      subscriber = await IndexerSubscriber.connect(stack.indexerWsUrl, { corporationId: corp.corporationId })

      const opB = await chainA.createFundedOperator()
      const applicant = await chainA.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root.participantId,
        did: `did:example:applicant-${RUN_ID}`,
        vsOperator: opB.address,
      })

      const live = await subscriber.waitForEvent(
        event => event.tx_hash.toLowerCase() === applicant.txHash.toLowerCase(),
        SETUP_TIMEOUT_MS,
      )

      expect(live.event_type).toBe('StartParticipantOP')
      expect(live.payload.module).toBe('pp')
      expect(live.payload.action).toBe('start_participant_op')
      expect(live.payload.message_type).toBe('MsgStartParticipantOP')
      expect(corpIdsOf(live)).toContain(corp.corporationId)

      const indexer = new VeranaIndexerService({
        baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      const page = await indexer.getEvents(`did:example:applicant-${RUN_ID}`, 0, 500, corp.corporationId)

      expect(page.events.some(event => event.tx_hash.toLowerCase() === applicant.txHash.toLowerCase())).toBe(
        true,
      )
      expect(page.events.every(event => corpIdsOf(event).includes(corp.corporationId))).toBe(true)

      const untilResolved = async <T>(fn: () => Promise<T | null | undefined>): Promise<T> => {
        const deadline = Date.now() + 60_000
        while (Date.now() < deadline) {
          const r = await fn().catch(() => undefined)
          if (r) return r
          await new Promise(res => setTimeout(res, 3_000))
        }
        throw new Error('indexer get endpoint did not resolve in time')
      }
      const indexedEco = await untilResolved(() => indexer.getEcosystem(eco.ecosystemId))
      expect(Number(indexedEco.id)).toBe(eco.ecosystemId)
      expect(Number(indexedEco.corporation_id)).toBe(corp.corporationId)

      const indexedSchema = await untilResolved(() => indexer.getCredentialSchema(schema.schemaId))
      expect(Number(indexedSchema.id)).toBe(schema.schemaId)
      expect(Number(indexedSchema.ecosystem_id)).toBe(eco.ecosystemId)
    },
    SETUP_TIMEOUT_MS,
  )
})
