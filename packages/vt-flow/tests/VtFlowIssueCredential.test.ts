import { EventEmitter } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommCredentialEventTypes,
  type DidCommCredentialExchangeRecord,
  DidCommCredentialState,
  DidCommCredentialV2Protocol,
  DidCommCredentialsApi,
  DidCommCredentialsModuleConfig,
  DidCommDataIntegrityCredentialFormatService,
  DidCommMessageRepository,
  DidCommRequestCredentialV2Message,
} from '@credo-ts/didcomm'
import { describe, expect, it, vi } from 'vitest'

import { VtFlowApi } from '../src/VtFlowApi'
import { VtFlowModule } from '../src/VtFlowModule'
import { VtFlowModuleConfig, type VtFlowModuleConfigOptions } from '../src/VtFlowModuleConfig'
import { VtFlowErrorCode } from '../src/errors'
import { VtFlowRecord } from '../src/repository'
import { VtFlowService } from '../src/services'
import { VtFlowRole, VtFlowState, VtFlowTxReason, VtFlowTxStatus, VtFlowVariant } from '../src/types'

const SIGNED_CREDENTIAL = { id: 'urn:uuid:vtc-1', proof: { proofValue: 'zSIG' } }

const buildApi = (
  options: VtFlowModuleConfigOptions,
  exchangeState = DidCommCredentialState.RequestReceived,
) => {
  const sendMessage = vi.fn(async () => undefined)
  const setCredentialDigest = vi.fn(async () => undefined)
  const recordIssuance = vi.fn(async () => undefined)
  const record = { id: 'flow-1', assertRole: (role: VtFlowRole) => role }

  const protocol = {
    version: 'v2',
    acceptRequest: vi.fn(async () => ({ message: { setThread: () => undefined } })),
    findCredentialMessage: vi.fn(async () => ({ setThread: () => undefined })),
    getFormatData: vi.fn(async () => ({ credential: { dataIntegrity: { credential: SIGNED_CREDENTIAL } } })),
  }

  const api = new VtFlowApi(
    { getById: async () => record, setCredentialDigest, recordIssuance } as never,
    { sendMessage } as never,
    { getById: async () => ({ assertReady: () => undefined }) } as never,
    {} as never,
    new VtFlowModuleConfig(options),
    { credentialProtocols: [protocol] } as never,
    {
      getById: async () => ({
        id: 'cx-1',
        protocolVersion: 'v2',
        connectionId: 'conn-1',
        state: exchangeState,
      }),
    } as never,
  )

  return { api, sendMessage, setCredentialDigest, recordIssuance, protocol }
}

const issue = (api: VtFlowApi) =>
  api.issueCredentialForSession({ vtFlowRecordId: 'flow-1', credentialExchangeRecordId: 'cx-1' })

describe('issueCredentialForSession', () => {
  it('does not deliver the credential when the anchoring hook throws', async () => {
    const { api, sendMessage, protocol } = buildApi({
      onBeforeCredentialIssued: async () => {
        throw new Error('chain tx failed')
      },
    })

    await expect(issue(api)).rejects.toThrow('chain tx failed')
    expect(protocol.acceptRequest).toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('signs with the module cryptosuite, which RFC 0809 leaves to the issuer', async () => {
    const { api, protocol } = buildApi({})

    await issue(api).catch(() => undefined)

    expect(protocol.acceptRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        credentialFormats: { dataIntegrity: { cryptosuite: 'eddsa-jcs-2022' } },
      }),
    )
  })

  it('hands the hook the signed credential and persists the digest before any delivery', async () => {
    let seenCredential: unknown
    const { api, sendMessage, setCredentialDigest } = buildApi({
      onBeforeCredentialIssued: async ({ credential }) => {
        seenCredential = credential
        return { credentialDigest: 'anchored-digest' }
      },
    })

    // the outbound context needs a real agent, so delivery throws after the hook has run
    await issue(api).catch(() => undefined)

    expect(seenCredential).toEqual(SIGNED_CREDENTIAL)
    expect(setCredentialDigest).toHaveBeenCalledWith(expect.anything(), 'flow-1', 'anchored-digest')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('records a failed anchoring and returns without delivering the credential', async () => {
    const issuance = {
      tx: { status: VtFlowTxStatus.Failed, reason: VtFlowTxReason.TxFailed, error: 'code 5' },
    }
    const { api, sendMessage, setCredentialDigest, recordIssuance } = buildApi({
      onBeforeCredentialIssued: async () => ({ credentialDigest: 'not-anchored', issuance }),
    })

    await issue(api)

    expect(recordIssuance).toHaveBeenCalledWith(expect.anything(), 'flow-1', issuance)
    expect(setCredentialDigest).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('anchors again the credential it signed before instead of signing a new one', async () => {
    const onBeforeCredentialIssued = vi.fn(async () => undefined)
    const { api, protocol } = buildApi({ onBeforeCredentialIssued }, DidCommCredentialState.CredentialIssued)

    await issue(api).catch(() => undefined)

    expect(protocol.acceptRequest).not.toHaveBeenCalled()
    expect(protocol.findCredentialMessage).toHaveBeenCalledWith(expect.anything(), 'cx-1')
    expect(onBeforeCredentialIssued).toHaveBeenCalledWith(
      expect.objectContaining({ credential: SIGNED_CREDENTIAL }),
    )
  })

  it('records an anchoring transaction SUBMITTED on the flow before it lands', async () => {
    const { api, recordIssuance } = buildApi({})
    const issuance = { tx: { hash: 'CD34', status: VtFlowTxStatus.Submitted } }

    await api.recordIssuance('flow-1', issuance)

    expect(recordIssuance).toHaveBeenCalledWith(expect.anything(), 'flow-1', issuance)
  })
})

describe('offerCredentialForSession', () => {
  it('refuses an Onboarding Process flow in VALIDATING before it creates the offer', async () => {
    const record = new VtFlowRecord({
      threadId: 'thid-1',
      participantSessionId: 'sess-1',
      connectionId: 'conn-1',
      role: VtFlowRole.Validator,
      state: VtFlowState.Validating,
      variant: VtFlowVariant.OnboardingProcess,
      agentParticipantId: '0',
      walletAgentParticipantId: '0',
    })
    const createOffer = vi.fn()
    const config = new VtFlowModuleConfig({})
    const api = new VtFlowApi(
      new VtFlowService({ getById: async () => record } as never, {} as never, {} as never, config),
      {} as never,
      {} as never,
      {} as never,
      config,
      { credentialProtocols: [{ version: 'v2', createOffer }] } as never,
      {} as never,
    )

    await expect(
      api.offerCredentialForSession({ vtFlowRecordId: record.id, credentialFormats: {} as never }),
    ).rejects.toThrow(/state 'VALIDATING'/)
    expect(createOffer).not.toHaveBeenCalled()
  })
})

describe('acceptCredentialOffer', () => {
  const DI_OFFER = 'didcomm/w3c-di-vc-offer@v0.1'
  const offerOf = (formats: string[], data: Record<string, unknown>) => ({
    formats: formats.map((format, index) => ({ attachmentId: `att-${index}`, format })),
    getOfferAttachmentById: () => ({ getDataAsJson: () => data }),
  })

  const buildApplicantApi = (offer: unknown) => {
    const credentialsApi = {
      findOfferMessage: vi.fn(async () => offer),
      acceptOffer: vi.fn(async () => undefined),
      declineOffer: vi.fn(async () => undefined),
    }
    const record = { id: 'flow-1', credentialExchangeRecordId: 'cx-1', assertRole: () => undefined }
    const api = new VtFlowApi(
      { getById: async () => record } as never,
      {} as never,
      {} as never,
      { dependencyManager: { resolve: () => credentialsApi } } as never,
      new VtFlowModuleConfig({}),
      {} as never,
      {} as never,
    )
    return { api, credentialsApi }
  }

  it('requests data model 2.0 even when the offer lists another version first', async () => {
    const { api, credentialsApi } = buildApplicantApi(
      offerOf([DI_OFFER], { data_model_versions_supported: ['1.1', '2.0'], binding_required: false }),
    )

    await api.acceptCredentialOffer('flow-1')

    expect(credentialsApi.acceptOffer).toHaveBeenCalledWith({
      credentialExchangeRecordId: 'cx-1',
      credentialFormats: { dataIntegrity: { dataModelVersion: '2.0' } },
      autoAcceptCredential: DidCommAutoAcceptCredential.Never,
    })
    expect(credentialsApi.declineOffer).not.toHaveBeenCalled()
  })

  it.each([
    ['verifies it', async () => true, 1],
    ['refuses it', async () => false, 0],
    ['throws', async () => Promise.reject(new Error('digest not anchored')), 0],
  ])('leaves the credential unaccepted until the verifyCredential hook %s', async (_, verdict, accepts) => {
    let release!: () => void
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    const exchange = { id: 'cx-1', parentThreadId: 'flow-thid' } as DidCommCredentialExchangeRecord
    const record = {
      id: 'flow-1',
      role: VtFlowRole.Applicant,
      credentialExchangeRecordId: 'cx-1',
      assertRole: () => undefined,
    }
    const config = new VtFlowModuleConfig({ verifyCredential: () => released.then(verdict) })
    const service = new VtFlowService(
      { getById: async () => record, findByThreadId: async () => record } as never,
      {} as never,
      { debug: vi.fn(), error: vi.fn() } as never,
      config,
    )
    const credentialsApi = {
      findOfferMessage: async () =>
        offerOf([DI_OFFER], { data_model_versions_supported: ['2.0'], binding_required: false }),
      acceptOffer: vi.fn(async (options: { autoAcceptCredential?: DidCommAutoAcceptCredential }) => {
        exchange.autoAcceptCredential = options.autoAcceptCredential
      }),
      acceptCredential: vi.fn(async () => undefined),
    }
    const message = (format: string) => ({
      formats: [{ format, attachmentId: format }],
      requestAttachments: [{ id: format }],
      credentialAttachments: [{ id: format }],
    })
    const listeners: Array<(event: unknown) => Promise<void>> = []
    const dependencies = new Map<unknown, unknown>([
      [VtFlowService, service],
      [DidCommCredentialsApi, credentialsApi],
      [
        EventEmitter,
        {
          on: (type: string, listener: (event: unknown) => Promise<void>) => {
            if (type === DidCommCredentialEventTypes.DidCommCredentialStateChanged) listeners.push(listener)
          },
        },
      ],
      [
        DidCommCredentialsModuleConfig,
        new DidCommCredentialsModuleConfig({
          autoAcceptCredentials: DidCommAutoAcceptCredential.ContentApproved,
          credentialProtocols: [],
        }),
      ],
      [
        DidCommMessageRepository,
        {
          findAgentMessage: async (_: unknown, { messageClass }: { messageClass: unknown }) =>
            messageClass === DidCommRequestCredentialV2Message
              ? message('didcomm/w3c-di-vc-request@v0.1')
              : null,
        },
      ],
    ])
    const agentContext = {
      dependencyManager: {
        resolve: (token: unknown) =>
          dependencies.get(token) ?? { registerMessageHandlers: vi.fn(), register: vi.fn() },
      },
    }
    await new VtFlowModule().initialize(agentContext as never)
    const api = new VtFlowApi(
      service,
      {} as never,
      {} as never,
      agentContext as never,
      config,
      {} as never,
      {} as never,
    )

    await api.acceptCredentialOffer('flow-1')
    exchange.state = DidCommCredentialState.CredentialReceived
    const received = Promise.all(
      listeners.map(listener => listener({ payload: { credentialExchangeRecord: exchange } })),
    )

    const protocol = new DidCommCredentialV2Protocol({
      credentialFormats: [new DidCommDataIntegrityCredentialFormatService()],
    })
    const credoAccepts = await protocol.shouldAutoRespondToCredential(agentContext as never, {
      credentialExchangeRecord: exchange,
      credentialMessage: message('didcomm/w3c-di-vc@v0.1') as never,
    })
    expect(credoAccepts).toBe(false)
    expect(credentialsApi.acceptCredential).not.toHaveBeenCalled()

    release()
    await received
    expect(credentialsApi.acceptCredential).toHaveBeenCalledTimes(accepts)
  })

  it.each([
    ['another attachment format', ['anoncreds/credential-offer@v1.0'], ['2.0'], false],
    ['a second attachment format', [DI_OFFER, 'anoncreds/credential-offer@v1.0'], ['2.0'], false],
    ['another data model version', [DI_OFFER], ['1.1'], false],
    ['a required binding', [DI_OFFER], ['2.0'], true],
  ])('answers an offer with %s with a problem report and no request', async (_, formats, versions, binding) => {
    const { api, credentialsApi } = buildApplicantApi(
      offerOf(formats, { data_model_versions_supported: versions, binding_required: binding }),
    )

    await api.acceptCredentialOffer('flow-1')

    expect(credentialsApi.declineOffer).toHaveBeenCalledWith(
      expect.objectContaining({ credentialExchangeRecordId: 'cx-1', sendProblemReport: true }),
    )
    expect(credentialsApi.acceptOffer).not.toHaveBeenCalled()
  })
})

describe('terminateByValidator', () => {
  it('lands in TERMINATED_BY_VALIDATOR and emits a problem report', async () => {
    const record = {
      id: 'flow-1',
      threadId: 'thid-1',
      connectionId: 'conn-1',
      role: VtFlowRole.Validator,
      state: VtFlowState.CredOffered,
      assertRole: (role: VtFlowRole) => {
        if (role !== VtFlowRole.Validator) throw new Error('wrong role')
      },
      assertState: () => undefined,
    } as never

    const updateState = vi.fn(async (_ctx: unknown, r: { state: VtFlowState }, next: VtFlowState) => {
      r.state = next
    })
    const service = new VtFlowService(
      { getById: async () => record } as never,
      {} as never,
      { error: () => undefined, warn: () => undefined, debug: () => undefined } as never,
      new VtFlowModuleConfig({}),
    )
    ;(service as never as { updateState: unknown }).updateState = updateState

    const { problemReport } = await service.terminateByValidator({} as never, 'flow-1', {
      code: VtFlowErrorCode.InternalError,
    })

    expect(updateState).toHaveBeenCalledWith(expect.anything(), record, VtFlowState.TerminatedByValidator)
    expect(problemReport).toBeDefined()
  })
})
