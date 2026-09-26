import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AuthorizationService, VeranaChainService, VeranaIndexerService } from '../../src/blockchain'
import { VtFlowOrchestrator } from '../../src/vtFlow/VtFlowOrchestrator'

import { PARTICIPANT_ROLE_HOLDER, PARTICIPANT_ROLE_ISSUER, VeranaTestChain } from './VeranaTestChain'
import { COOLUSER_MNEMONIC, SETUP_TIMEOUT_MS, startStack, type StartedStack } from './helpers'

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const HOLDER_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'E2eCredential',
  description: 'e2e credential for validateFlow',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
    },
  },
})

type FlowRecord = Record<string, unknown> & { id: string; state: string }

// validateFlow reads and writes the flow through VtFlowApi. The chain, the indexer and the
// authorization cache below are real, only the record store and the DIDComm offer are in memory.
function makeFlowStore() {
  const records = new Map<string, FlowRecord>()
  const get = (id: string): FlowRecord => {
    const record = records.get(id)
    if (!record) throw new Error(`no flow ${id}`)
    return record
  }
  const set = (id: string, patch: Record<string, unknown>) => {
    const next = { ...get(id), ...patch }
    records.set(id, next)
    return next
  }
  const api = {
    findById: async (id: string) => records.get(id) ?? null,
    findAllByQuery: async (query: Record<string, unknown>) =>
      [...records.values()].filter(r => !query.flowState || r.state === query.flowState),
    acceptOnboardingRequest: async (id: string) => set(id, { state: VtFlowState.Validating }),
    sendValidating: async (id: string) => set(id, { state: VtFlowState.Validating }),
    markValidated: async (id: string) => set(id, { state: VtFlowState.Validated }),
    markPendingClaims: async (id: string) => set(id, { state: VtFlowState.ValidatedPendingClaims }),
    markCompleted: async (id: string) => set(id, { state: VtFlowState.Completed }),
    recordValidation: async (id: string, validation: unknown, state?: string) =>
      set(id, { validation, ...(state && { state }) }),
  }
  const add = (record: FlowRecord) =>
    records.set(record.id, { role: VtFlowRole.Validator, variant: 'onboarding-process', ...record })
  return { api, add, get }
}

describe('validateFlow against the real chain and indexer', () => {
  let stack: StartedStack
  let indexer: VeranaIndexerService
  let chainA: VeranaTestChain
  let policyAddress: string
  let ecosystemId: number
  let validatorChain: VeranaChainService
  const logger = new ConsoleLogger(LogLevel.Warn)

  async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 120_000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await read().catch(() => undefined)
      if (value !== undefined) return value
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }
  }

  const opState = (id: number) => indexer.getParticipant(id).then(p => p.op_state)

  async function untilOpState(id: number, expected: string): Promise<void> {
    await until(
      async () => ((await opState(id)) === expected ? true : undefined),
      `participant ${id} ${expected}`,
    )
  }

  // The chain allows one onboarding per (schema, role, validator, Corporation), so each case gets its
  // own schema and root.
  async function makeRoot(tag: string): Promise<number> {
    const { schemaId } = await chainA.createCredentialSchema(policyAddress, {
      ecosystemId,
      jsonSchema: HOLDER_SCHEMA,
    })
    const root = await chainA.createRootParticipant(policyAddress, {
      schemaId,
      did: `did:example:root-${RUN_ID}-${tag}`,
    })
    return root.participantId
  }

  // An ISSUER entry validated by the Corporation, whose vs_operator gets the given message types.
  async function makeValidatorEntry(
    vsOperator: string,
    msgTypes: string[],
    withFeegrant = false,
  ): Promise<number> {
    const rootParticipantId = await makeRoot(vsOperator.slice(-6))
    const issuer = await chainA.startParticipantOp(policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: rootParticipantId,
      did: `did:example:issuer-${RUN_ID}-${vsOperator.slice(-6)}`,
      vsOperator,
      vsOperatorAuthzMsgTypes: msgTypes,
      vsOperatorAuthzWithFeegrant: withFeegrant,
      vsOperatorAuthzFeeSpendLimit: withFeegrant ? [{ denom: 'uvna', amount: '5000000' }] : undefined,
    })
    await validatorChain.setParticipantOPToValidated({ id: issuer.participantId, opSummaryDigest: '' })
    await untilOpState(issuer.participantId, 'VALIDATED')
    await until(async () => {
      const p = await indexer.getParticipant(issuer.participantId)
      return p.effective_from && Date.parse(p.effective_from) <= Date.now() ? true : undefined
    }, `issuer ${issuer.participantId} active`)
    return issuer.participantId
  }

  async function makeApplicant(validatorEntryId: number, tag: string): Promise<number> {
    const holder = await chainA.startParticipantOp(policyAddress, {
      role: PARTICIPANT_ROLE_HOLDER,
      validatorParticipantId: validatorEntryId,
      did: `did:example:holder-${RUN_ID}-${tag}`,
    })
    await untilOpState(holder.participantId, 'PENDING')
    return holder.participantId
  }

  async function makeOrchestrator(mnemonic: string) {
    const chain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic,
      corporationAddress: policyAddress,
      logger,
    })
    await chain.start()
    const authorizationService = new AuthorizationService({ chain, indexer, logger })
    const store = makeFlowStore()
    const agent = {
      did: 'did:example:validator-agent',
      config: { logger },
      dependencyManager: { resolve: () => store.api },
      veranaChain: chain,
      indexer,
      authorizationService,
    }
    const orchestrator = new VtFlowOrchestrator(agent as never)
    const offer = vi.fn(async ({ vtFlowRecordId }: { vtFlowRecordId: string }) =>
      store.api.recordValidation(
        vtFlowRecordId,
        store.get(vtFlowRecordId).validation,
        VtFlowState.CredOffered,
      ),
    )
    ;(orchestrator as unknown as { offerOnboardingCredential: unknown }).offerOnboardingCredential = offer
    return { chain, store, orchestrator, offer }
  }

  async function untilGranted(address: string, participantId: number, msgType: string): Promise<void> {
    await until(async () => {
      const vsoas = await indexer.listVsOperatorAuthorizations(address)
      const record = vsoas.flatMap(a => a.records).find(r => r.participantId === participantId)
      return record?.msgTypes.includes(msgType) ? true : undefined
    }, `grant of ${msgType} to ${address}`)
  }

  beforeAll(async () => {
    stack = await startStack()
    indexer = new VeranaIndexerService({ baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'), logger })
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    policyAddress = corp.policyAddress
    await chainA.fundCorporation(policyAddress)
    await chainA.grantOperatorAuthorization(policyAddress)
    ecosystemId = (await chainA.createEcosystem(policyAddress, { did: `did:example:eco-${RUN_ID}` }))
      .ecosystemId

    validatorChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: policyAddress,
      logger,
    })
    await validatorChain.start()
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'submits under the grant, returns in VALIDATION_TX_SUBMITTED, and lands VALIDATED with its fees',
    async () => {
      const operator = await chainA.createFundedOperator()
      const validatorEntry = await makeValidatorEntry(operator.address, [PP_VALIDATE, PP_SESSION])
      const applicant = await makeApplicant(validatorEntry, 'agent')
      await untilGranted(operator.address, validatorEntry, PP_VALIDATE)

      const { store, orchestrator, offer } = await makeOrchestrator(operator.mnemonic)
      store.add({
        id: 'flow-agent',
        state: VtFlowState.Validating,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
      })

      const returned = await orchestrator.validateFlow({ vtFlowRecordId: 'flow-agent', validationFees: 3 })
      expect(returned.state, JSON.stringify(returned.validation)).toBe(VtFlowState.ValidationTxSubmitted)
      expect(returned.validation).toMatchObject({ submission: 'AGENT', tx: { status: 'SUBMITTED' } })

      await until(
        async () => (store.get('flow-agent').state === VtFlowState.CredOffered ? true : undefined),
        'the flow to reach CRED_OFFERED',
      )
      expect(store.get('flow-agent').validation).toMatchObject({
        tx: { status: 'SUCCEEDED', height: expect.any(Number) },
      })
      expect(offer).toHaveBeenCalledTimes(1)

      await untilOpState(applicant, 'VALIDATED')
      expect((await indexer.getParticipant(applicant)).validation_fees).toBe(3)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'hands the transaction to an operator when the grant does not cover it, and leaves the entry PENDING',
    async () => {
      const operator = await chainA.createFundedOperator()
      const validatorEntry = await makeValidatorEntry(operator.address, [PP_SESSION])
      const applicant = await makeApplicant(validatorEntry, 'operator')
      await untilGranted(operator.address, validatorEntry, PP_SESSION)

      const { store, orchestrator } = await makeOrchestrator(operator.mnemonic)
      store.add({
        id: 'flow-op',
        state: VtFlowState.Validating,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
      })

      const returned = await orchestrator.validateFlow({ vtFlowRecordId: 'flow-op' })

      expect(returned.state).toBe(VtFlowState.AwaitingValidationTx)
      expect(returned.validation).toMatchObject({ submission: 'OPERATOR' })
      expect(returned.validation).not.toHaveProperty('tx')
      expect(await opState(applicant)).toBe('PENDING')
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'records a failed pre-flight when the agent account cannot pay, without broadcasting',
    async () => {
      const operator = await chainA.createFundedOperator('1')
      const validatorEntry = await makeValidatorEntry(operator.address, [PP_VALIDATE])
      const applicant = await makeApplicant(validatorEntry, 'broke')
      await untilGranted(operator.address, validatorEntry, PP_VALIDATE)

      const { store, orchestrator } = await makeOrchestrator(operator.mnemonic)
      store.add({
        id: 'flow-broke',
        state: VtFlowState.Validating,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
      })

      const returned = await orchestrator.validateFlow({ vtFlowRecordId: 'flow-broke' })

      expect(returned.state, JSON.stringify(returned.validation)).toBe(VtFlowState.ValidationTxFailed)
      expect(returned.validation).toMatchObject({ submission: 'AGENT', tx: { status: 'FAILED' } })
      expect((returned.validation as { tx: { reason: string } }).tx.reason).toMatch(
        /^(INSUFFICIENT_FUNDS_AGENT|PREFLIGHT_ERROR)$/,
      )
      expect(await opState(applicant)).toBe('PENDING')
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'lets the Corporation pay through its fee allowance',
    async () => {
      const operator = await chainA.createFundedOperator('1')
      const validatorEntry = await makeValidatorEntry(operator.address, [PP_VALIDATE], true)
      const applicant = await makeApplicant(validatorEntry, 'feegrant')
      await untilGranted(operator.address, validatorEntry, PP_VALIDATE)

      const { chain, store, orchestrator } = await makeOrchestrator(operator.mnemonic)
      const allowance = await until(() => chain.feeAllowance(policyAddress), 'the Corporation fee allowance')
      expect(allowance).toBeDefined()

      store.add({
        id: 'flow-grant',
        state: VtFlowState.Validating,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
      })
      const returned = await orchestrator.validateFlow({ vtFlowRecordId: 'flow-grant' })
      expect(returned.state, JSON.stringify(returned.validation)).toBe(VtFlowState.ValidationTxSubmitted)

      await until(
        async () => (store.get('flow-grant').state !== VtFlowState.ValidationTxSubmitted ? true : undefined),
        'the submission to resolve',
      )
      const resolved = store.get('flow-grant')
      expect(resolved.state, JSON.stringify(resolved.validation)).toBe(VtFlowState.CredOffered)
      await untilOpState(applicant, 'VALIDATED')
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'skips the submission for an entry already VALIDATED, and resolves a rejected duplicate as success',
    async () => {
      const operator = await chainA.createFundedOperator()
      const validatorEntry = await makeValidatorEntry(operator.address, [PP_VALIDATE])
      const applicant = await makeApplicant(validatorEntry, 'dup')
      await untilGranted(operator.address, validatorEntry, PP_VALIDATE)
      await validatorChain.setParticipantOPToValidated({ id: applicant, opSummaryDigest: '' })
      await untilOpState(applicant, 'VALIDATED')

      const { chain, store, orchestrator } = await makeOrchestrator(operator.mnemonic)
      store.add({
        id: 'flow-short',
        state: VtFlowState.Validating,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
      })
      const shortCircuit = await orchestrator.validateFlow({ vtFlowRecordId: 'flow-short' })
      expect(shortCircuit.state).toBe(VtFlowState.CredOffered)
      expect(shortCircuit.validation).toMatchObject({ submission: 'OPERATOR' })
      expect(shortCircuit.validation).not.toHaveProperty('tx')

      // A second SetParticipantOPtoValidated fails its simulation, but CheckTx runs no message
      // handler, so a broadcast that skips the simulation is only refused at delivery.
      const message = chain.setParticipantOPToValidatedMsg({ id: applicant })
      await expect(chain.estimateFee([message])).rejects.toThrow(/PENDING state/)
      const hash = await chain.broadcastWithoutWaiting([message], {
        amount: [{ denom: 'uvna', amount: '400000' }],
        gas: '400000',
      })

      store.add({
        id: 'flow-dup',
        state: VtFlowState.ValidationTxSubmitted,
        applicantParticipantId: String(applicant),
        claims: { name: 'Acme' },
        validation: {
          decidedAt: new Date().toISOString(),
          submission: 'AGENT',
          tx: { hash, status: 'SUBMITTED' },
        },
      })
      await orchestrator.resolveValidationTx('flow-dup')
      expect(store.get('flow-dup').state).toBe(VtFlowState.CredOffered)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'takes a fee discount from 0 to 10000 on chain and reads it back from the indexer as a ratio',
    async () => {
      const rootParticipantId = await makeRoot('discount')
      const applicant = await chainA.startParticipantOp(policyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: rootParticipantId,
        did: `did:example:issuer-${RUN_ID}-discount`,
      })
      await untilOpState(applicant.participantId, 'PENDING')

      const tooLarge = validatorChain.setParticipantOPToValidatedMsg({
        id: applicant.participantId,
        issuanceFeeDiscount: 10_001,
      })
      await expect(validatorChain.estimateFee([tooLarge])).rejects.toThrow()

      await validatorChain.setParticipantOPToValidated({
        id: applicant.participantId,
        issuanceFeeDiscount: 2500,
      })
      await untilOpState(applicant.participantId, 'VALIDATED')
      expect((await indexer.getParticipant(applicant.participantId)).issuance_fee_discount).toBe(0.25)
    },
    SETUP_TIMEOUT_MS,
  )
})
