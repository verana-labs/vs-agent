import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { VeranaChainService } from '@verana-labs/vs-agent-sdk'
import { describe, expect, it } from 'vitest'

import {
  PARTICIPANT_ROLE_ISSUER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import { COOLUSER_MNEMONIC } from '../../../../packages/agent-sdk/tests/e2e/helpers'

const SEED_ENABLED = process.env.SEED_DEMO === '1'
const describeSeed = SEED_ENABLED ? describe : describe.skip

const RPC_URL = process.env.DEMO_RPC_URL ?? 'http://localhost:26658'
const VALIDATOR_PUBLIC_URL = process.env.DEMO_VALIDATOR_URL ?? 'http://localhost:4001'
const VALIDATOR_OPERATOR = process.env.DEMO_VALIDATOR_OPERATOR ?? ''

const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const ecsSchema = (title: string) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: `demo ${title}`,
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  })

describeSeed('demo chain seed', () => {
  it('seeds corporation, ecosystem, ECS schemas, roots, and the validator grant', async () => {
    expect(VALIDATOR_OPERATOR, 'set DEMO_VALIDATOR_OPERATOR to the validator operator address').toBeTruthy()

    const didLog = await fetch(`${VALIDATOR_PUBLIC_URL}/.well-known/did.jsonl`).then(r => r.text())
    const validatorDid = JSON.parse(didLog.split('\n')[0]).state.id as string

    const chain = await VeranaTestChain.connect(RPC_URL, COOLUSER_MNEMONIC)
    const corp = await chain.createCorporation({ did: 'did:example:demo-corp' })
    await chain.fundCorporation(corp.policyAddress)
    await chain.grantOperatorAuthorization(corp.policyAddress)

    const eco = await chain.createEcosystem(corp.policyAddress, { did: 'did:example:demo-ecosystem' })
    const orgSchema = await chain.createCredentialSchema(corp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ecsSchema('OrganizationCredential'),
    })
    const serviceSchema = await chain.createCredentialSchema(corp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ecsSchema('ServiceCredential'),
    })
    const orgRoot = await chain.createRootParticipant(corp.policyAddress, {
      schemaId: orgSchema.schemaId,
      did: 'did:example:demo-org-root',
    })
    await chain.createRootParticipant(corp.policyAddress, {
      schemaId: serviceSchema.schemaId,
      did: 'did:example:demo-service-root',
    })

    await chain.fundAccount(VALIDATOR_OPERATOR)
    const validatorOp = await chain.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: orgRoot.participantId,
      did: validatorDid,
      vsOperator: VALIDATOR_OPERATOR,
      vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
    })

    const seeder = new VeranaChainService({
      rpcUrl: RPC_URL,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corp.policyAddress,
      logger: new ConsoleLogger(LogLevel.Warn),
    })
    await seeder.start()
    await seeder.setParticipantOPToValidated({ id: validatorOp.participantId, opSummaryDigest: 'sha384-v' })

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          corporationId: corp.corporationId,
          ecosystemDid: 'did:example:demo-ecosystem',
          orgSchemaId: orgSchema.schemaId,
          serviceSchemaId: serviceSchema.schemaId,
          validatorDid,
          validatorParticipantId: validatorOp.participantId,
        },
        null,
        2,
      ),
    )
    expect(corp.corporationId).toBe(1)
  }, 180_000)
})
