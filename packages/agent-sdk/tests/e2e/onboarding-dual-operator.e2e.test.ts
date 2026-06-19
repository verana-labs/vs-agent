import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ValidationState, VeranaChainService } from '../../src/blockchain'

import { PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
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

// Until the chain authorizes both setValidated and the session under one vs_operator (AUTHZ-CHECK-3),
// they need mutually-exclusive authz (OperatorAuthorization vs VSOperatorAuthorization), so the agent
// signs the session with a second account. This exercises that dual-operator path end-to-end through
// VeranaChainService on a local V4 node.
describeE2E('vt-flow onboarding chain integration: dual-operator validate + 0/0 session (V4)', () => {
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
        sessionOperatorMnemonic: opB.mnemonic, // operator B (VSOperatorAuthorization) -> session
        corporationAddress: corp.policyAddress,
        logger: new ConsoleLogger(LogLevel.Debug),
      })
      await veranaChain.start()

      const digest = `sha384-${createHash('sha384').update(`cred-${RUN_ID}`).digest('base64')}`
      await veranaChain.setPermissionVPToValidated({
        id: applicant.participantId,
        vpSummaryDigest: digest,
      })
      await veranaChain.createOrUpdatePermissionSession({
        id: randomUUID(),
        issuerPermId: applicant.participantId,
        agentPermId: 0,
        walletAgentPermId: 0,
        digest,
      })

      const onChain = await veranaChain.getPermission(applicant.participantId)
      expect(onChain?.vpState).toBe(ValidationState.VALIDATED)
    },
    SETUP_TIMEOUT_MS,
  )
})
