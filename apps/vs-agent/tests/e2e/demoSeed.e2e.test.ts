import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { getEcsSchemas, VeranaChainService } from '@verana-labs/vs-agent-sdk'
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
const APPLICANT_OPERATOR = process.env.DEMO_APPLICANT_OPERATOR ?? ''

const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const ECS_SCHEMAS = getEcsSchemas(process.env.DEMO_ECS_SCHEMA_BASE_URL ?? 'https://agent-validator.demo')

describeSeed('demo chain seed', () => {
  it('seeds corporation, ecosystem, ECS schemas, roots, and the validator grant', async () => {
    expect(VALIDATOR_OPERATOR, 'set DEMO_VALIDATOR_OPERATOR to the validator operator address').toBeTruthy()
    expect(APPLICANT_OPERATOR, 'set DEMO_APPLICANT_OPERATOR to the applicant operator address').toBeTruthy()
    expect(
      VALIDATOR_OPERATOR,
      'the validator and applicant must use distinct accounts: the validator receives a VSOA on its participant OP, ' +
        'the applicant an OperatorAuthorization, and the chain forbids one account from holding both on a corporation',
    ).not.toBe(APPLICANT_OPERATOR)

    const didLog = await fetch(`${VALIDATOR_PUBLIC_URL}/.well-known/did.jsonl`).then(r => r.text())
    const validatorDid = JSON.parse(didLog.split('\n')[0]).state.id as string

    const chain = await VeranaTestChain.connect(RPC_URL, COOLUSER_MNEMONIC)
    // The corporation each agent operates for. Each one holds only its own participants.
    const corp = await chain.createCorporation({ did: 'did:example:demo-corp' })
    await chain.fundCorporation(corp.policyAddress)
    await chain.grantOperatorAuthorization(corp.policyAddress)

    // The ecosystem belongs to a corporation of its own, and no agent operates for it. An agent
    // publishes a VTJSC for every schema its own corporation owns, and a Verifiable Service that
    // presents self-issued credentials owns no schema, so it must reference only its own URLs.
    const ecosystemCorp = await chain.createCorporation({ did: 'did:example:demo-ecosystem-corp' })
    await chain.fundCorporation(ecosystemCorp.policyAddress)
    await chain.grantOperatorAuthorization(ecosystemCorp.policyAddress)

    const eco = await chain.createEcosystem(ecosystemCorp.policyAddress, {
      did: 'did:example:demo-ecosystem',
    })
    const orgSchema = await chain.createCredentialSchema(ecosystemCorp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ECS_SCHEMAS['ecs-org'],
    })
    const serviceSchema = await chain.createCredentialSchema(ecosystemCorp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ECS_SCHEMAS['ecs-service'],
    })
    const orgRoot = await chain.createRootParticipant(ecosystemCorp.policyAddress, {
      schemaId: orgSchema.schemaId,
      did: 'did:example:demo-org-root',
    })
    const serviceRoot = await chain.createRootParticipant(ecosystemCorp.policyAddress, {
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

    // The applicant is a separate organization joining the ecosystem, so it gets its own
    // corporation: a participant OP is unique per (schema, role, validator, authority), and one
    // shared corporation would collide with the validator's own Service OP below.
    const applicantCorp = await chain.createCorporation({ did: 'did:example:demo-applicant-corp' })
    await chain.fundCorporation(applicantCorp.policyAddress)

    // The applicant self-onboards: its ECS bootstrap signs MsgStartParticipantOP with its own
    // account, so that account needs funds and an OperatorAuthorization on its corporation.
    await chain.fundAccount(APPLICANT_OPERATOR)
    await chain.grantOperatorAuthorization(applicantCorp.policyAddress, APPLICANT_OPERATOR)

    // The applicant runs VS-CONN-VS against the validator before it will send an onboarding
    // request, and that resolves the validator's self-issued ECS Service credential. So the
    // validator needs an active ISSUER participant on the Service schema too. No vsOperator here:
    // it already holds its VSOA from the OP above, and one per corporation/operator pair is the max.
    const validatorServiceOp = await chain.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: serviceRoot.participantId,
      did: validatorDid,
    })

    // The roots that validate these OPs belong to the ecosystem corporation, so the seeder signs
    // the validation on its behalf.
    const seeder = new VeranaChainService({
      rpcUrl: RPC_URL,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: ecosystemCorp.policyAddress,
      logger: new ConsoleLogger(LogLevel.Warn),
    })
    await seeder.start()
    await seeder.setParticipantOPToValidated({ id: validatorOp.participantId, opSummaryDigest: 'sha384-v' })
    await seeder.setParticipantOPToValidated({
      id: validatorServiceOp.participantId,
      opSummaryDigest: 'sha384-s',
    })

    // biome-ignore lint/suspicious/noConsole: prints the seeded ids for the demo walkthrough
    console.log(
      JSON.stringify(
        {
          validatorCorporationId: corp.corporationId,
          applicantCorporationId: applicantCorp.corporationId,
          ecosystemCorporationId: ecosystemCorp.corporationId,
          ecosystemDid: 'did:example:demo-ecosystem',
          orgSchemaId: orgSchema.schemaId,
          serviceSchemaId: serviceSchema.schemaId,
          validatorDid,
          validatorParticipantId: validatorOp.participantId,
          validatorServiceParticipantId: validatorServiceOp.participantId,
        },
        null,
        2,
      ),
    )
    expect(corp.corporationId).toBe(1)
    expect(applicantCorp.corporationId).not.toBe(corp.corporationId)
  }, 180_000)
})
