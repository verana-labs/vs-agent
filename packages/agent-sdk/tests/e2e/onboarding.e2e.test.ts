import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ParticipantRole,
  ParticipantState,
  ValidationState,
  VeranaChainService,
  VeranaIndexerService,
} from '../../src/blockchain'

import {
  PARTICIPANT_ROLE_HOLDER,
  PARTICIPANT_ROLE_ISSUER,
  PP_TRIGGER_RESOLVER,
  VeranaTestChain,
} from './VeranaTestChain'
import { COOLUSER_MNEMONIC, SETUP_TIMEOUT_MS, startStack, type StartedStack } from './helpers'

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

// Split-account deployment: validation signed by an OA account and the session by a separate VSOA
// account, each through its own VeranaChainService. The single-account path (one vs_operator whose
// VSOA covers both msgs) is covered by applicant-ops.e2e.test.ts.
describeE2E('vt-flow onboarding chain integration (V4)', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let veranaChain: VeranaChainService

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'validates the applicant via the OA account and creates a 0/0 session via the VSOA account',
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

      // Operator B: the agent's session vs_operator (VSOA), distinct from operator A (OA).
      const opB = await chainA.createFundedOperator()
      const applicant = await chainA.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root.participantId,
        did: `did:example:applicant-${RUN_ID}`,
        vsOperator: opB.address,
      })

      veranaChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: COOLUSER_MNEMONIC, // operator A (OperatorAuthorization) -> setValidated
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Debug),
      })
      await veranaChain.start()

      const vsoaChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opB.mnemonic, // operator B (VSOperatorAuthorization) -> session
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      await vsoaChain.start()

      const digest = `sha384-${createHash('sha384').update(`cred-${RUN_ID}`).digest('base64')}`
      await veranaChain.setParticipantOPToValidated({
        id: applicant.participantId,
        opSummaryDigest: digest,
      })
      await vsoaChain.createOrUpdateParticipantSession({
        id: randomUUID(),
        issuerParticipantId: applicant.participantId,
        agentParticipantId: 0,
        walletAgentParticipantId: 0,
        digest,
      })

      const onChain = await veranaChain.getParticipant(applicant.participantId)
      expect(onChain?.opState).toBe(ValidationState.VALIDATED)

      expect(await vsoaChain.hasVsOperatorAuthorization()).toBe(true)
      expect(await veranaChain.hasVsOperatorAuthorization()).toBe(false)

      // V4 indexer REST: confirm the participant is indexed with the migrated wire fields
      // (/v4/participant/get/:id, {participant} wrapper, op_state/op_summary_digest/validator_participant_id).
      const indexer = new VeranaIndexerService({
        baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      let indexed: Awaited<ReturnType<VeranaIndexerService['getParticipant']>> | undefined
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        indexed = await indexer.getParticipant(applicant.participantId).catch(() => undefined)
        if (indexed?.op_state === 'VALIDATED') break
        await new Promise(resolve => setTimeout(resolve, 3_000))
      }
      expect(indexed?.op_state).toBe('VALIDATED')
      expect(indexed?.op_summary_digest).toBe(digest)
      expect(Number(indexed?.validator_participant_id)).toBe(root.participantId)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'triggers the resolver for a HOLDER participant via its own vs_operator (Path 1)',
    async () => {
      const suffix = `h-${RUN_ID}`
      const corp = await chainA.createCorporation({ did: `did:example:corp-${suffix}` })
      await chainA.fundCorporation(corp.policyAddress)
      await chainA.grantOperatorAuthorization(corp.policyAddress)
      const eco = await chainA.createEcosystem(corp.policyAddress, { did: `did:example:eco-${suffix}` })
      const schema = await chainA.createCredentialSchema(corp.policyAddress, {
        ecosystemId: eco.ecosystemId,
        jsonSchema: MINIMAL_SCHEMA,
      })
      const root = await chainA.createRootParticipant(corp.policyAddress, {
        schemaId: schema.schemaId,
        did: `did:example:eco-root-${suffix}`,
      })

      // HOLDER onboarding requires an ISSUER validator (chain holder_onboarding_mode = ISSUER_VALIDATION).
      const issuer = await chainA.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root.participantId,
        did: `did:example:issuer-${suffix}`,
      })

      // Only a HOLDER may be granted TriggerResolver as VSOA, so it self-triggers via Path 1 (AUTHZ-CHECK-3).
      const opHolder = await chainA.createFundedOperator()

      const oaChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: COOLUSER_MNEMONIC, // OA account -> setValidated
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Debug),
      })
      await oaChain.start()

      const digest = `sha384-${createHash('sha384').update(`cred-${suffix}`).digest('base64')}`
      await oaChain.setParticipantOPToValidated({ id: issuer.participantId, opSummaryDigest: digest })

      const holder = await chainA.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_HOLDER,
        validatorParticipantId: issuer.participantId,
        did: `did:example:holder-${suffix}`,
        vsOperator: opHolder.address,
        vsOperatorAuthzMsgTypes: [PP_TRIGGER_RESOLVER],
      })
      // A HOLDER's op_summary_digest must be null (chain rejects a digest for HOLDER type).
      await oaChain.setParticipantOPToValidated({ id: holder.participantId, opSummaryDigest: '' })

      const holderChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opHolder.mnemonic, // HOLDER vs_operator -> TriggerResolver
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Debug),
      })
      await holderChain.start()

      const triggered = await holderChain.triggerResolver(holder.participantId)
      expect(triggered.txHash).toMatch(/^[0-9A-F]{64}$/i)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'exposes the ParticipantSession, ISSUER participant and anchored digest to the applicant via the indexer',
    async () => {
      const suffix = `v-${RUN_ID}`
      const corp = await chainA.createCorporation({ did: `did:example:corp-${suffix}` })
      await chainA.fundCorporation(corp.policyAddress)
      await chainA.grantOperatorAuthorization(corp.policyAddress)
      const eco = await chainA.createEcosystem(corp.policyAddress, { did: `did:example:eco-${suffix}` })
      const schema = await chainA.createCredentialSchema(corp.policyAddress, {
        ecosystemId: eco.ecosystemId,
        jsonSchema: MINIMAL_SCHEMA,
      })
      const root = await chainA.createRootParticipant(corp.policyAddress, {
        schemaId: schema.schemaId,
        did: `did:example:validator-${suffix}`,
      })

      const opB = await chainA.createFundedOperator()
      const applicant = await chainA.startParticipantOp(corp.policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: root.participantId,
        did: `did:example:applicant-${suffix}`,
        vsOperator: opB.address,
      })

      const chain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: COOLUSER_MNEMONIC,
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Debug),
      })
      await chain.start()

      const vsoaChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opB.mnemonic,
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Warn),
      })
      await vsoaChain.start()

      // The validator (validateAndOfferCredential) writes this digest to the applicant's op_summary_digest
      // and to the ParticipantSession before offering the credential.
      const digest = `sha384-${createHash('sha384').update(`cred-${suffix}`).digest('base64')}`
      const sessionId = randomUUID()
      await chain.setParticipantOPToValidated({ id: applicant.participantId, opSummaryDigest: digest })
      await vsoaChain.createOrUpdateParticipantSession({
        id: sessionId,
        issuerParticipantId: applicant.participantId,
        agentParticipantId: 0,
        walletAgentParticipantId: 0,
        digest,
      })

      const indexer = new VeranaIndexerService({
        baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
        logger: new ConsoleLogger(LogLevel.Warn),
      })

      const untilDefined = async <T>(fn: () => Promise<T | undefined>): Promise<T | undefined> => {
        const deadline = Date.now() + 120_000
        while (Date.now() < deadline) {
          const value = await fn().catch(() => undefined)
          if (value != null) return value
          await new Promise(resolve => setTimeout(resolve, 3_000))
        }
        return undefined
      }

      const session = await untilDefined(() => indexer.getParticipantSession(sessionId))
      expect(session).toBeDefined()
      const issuerParticipantId = session?.session_records?.find(
        r => r.issuer_participant_id != null,
      )?.issuer_participant_id
      expect(Number(issuerParticipantId)).toBe(applicant.participantId)

      const issuer = await untilDefined(() =>
        indexer
          .getParticipant(applicant.participantId)
          .then(p => (p?.participant_state === ParticipantState.Active ? p : undefined)),
      )
      expect(issuer?.role).toBe(ParticipantRole.Issuer)
      expect(issuer?.participant_state).toBe(ParticipantState.Active)
      expect(Number(issuer?.schema_id)).toBe(schema.schemaId)

      const anchored = await untilDefined(() => indexer.getDigest(digest))
      expect(anchored?.digest).toBe(digest)
    },
    SETUP_TIMEOUT_MS,
  )
})
