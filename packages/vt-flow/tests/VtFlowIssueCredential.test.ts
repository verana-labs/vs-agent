import { describe, expect, it, vi } from 'vitest'

import { VtFlowApi } from '../src/VtFlowApi'
import { VtFlowModuleConfig, type VtFlowModuleConfigOptions } from '../src/VtFlowModuleConfig'
import { VtFlowErrorCode } from '../src/errors'
import { VtFlowService } from '../src/services'
import { VtFlowRole, VtFlowState } from '../src/types'

const SIGNED_CREDENTIAL = { id: 'urn:uuid:vtc-1', proof: { proofValue: 'zSIG' } }

const buildApi = (options: VtFlowModuleConfigOptions) => {
  const sendMessage = vi.fn(async () => undefined)
  const setCredentialDigest = vi.fn(async () => undefined)
  const record = { id: 'flow-1', assertRole: (role: VtFlowRole) => role }

  const protocol = {
    version: 'v2',
    acceptRequest: vi.fn(async () => ({ message: { setThread: () => undefined } })),
    findRequestMessage: vi.fn(async () => ({})),
    findOfferMessage: vi.fn(async () => ({})),
    getFormatData: vi.fn(async () => ({ credential: { jsonld: SIGNED_CREDENTIAL } })),
  }

  const api = new VtFlowApi(
    { getById: async () => record, setCredentialDigest } as never,
    { sendMessage } as never,
    { getById: async () => ({ assertReady: () => undefined }) } as never,
    {} as never,
    new VtFlowModuleConfig(options),
    { credentialProtocols: [protocol] } as never,
    { getById: async () => ({ id: 'cx-1', protocolVersion: 'v2', connectionId: 'conn-1' }) } as never,
  )

  return { api, sendMessage, setCredentialDigest, protocol }
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
