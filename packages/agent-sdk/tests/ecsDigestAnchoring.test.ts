import { DidDocument, VerificationMethod } from '@credo-ts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SelfTrDefaults } from '../src/utils/setupSelfTr'
import { rebindEcsCredentialSchema } from '../src/utils/trustCredentialStore'

const DID = 'did:web:agent.example'
const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

vi.mock('@verana-labs/verre', () => ({
  computeCredentialDigestJCS: () => DIGEST,
}))

const generateVerifiablePresentation = vi.fn()
vi.mock('../src/utils/setupSelfTr', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils/setupSelfTr')>()),
  generateVerifiablePresentation: (...args: unknown[]) => generateVerifiablePresentation(...args),
}))

const defaults = {} as SelfTrDefaults

function makeAgent(chain?: Record<string, unknown>) {
  const metadata = new Map<string, Record<string, unknown>>()
  const didDocument = new DidDocument({
    id: DID,
    verificationMethod: [
      new VerificationMethod({
        id: `${DID}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: DID,
        publicKeyMultibase: 'z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG',
      }),
    ],
    assertionMethod: [`${DID}#key-1`],
  })
  const didRecord = {
    did: DID,
    didDocument,
    metadata: {
      get: (key: string) => metadata.get(key),
      set: (key: string, value: Record<string, unknown>) => metadata.set(key, value),
    },
  }
  const repositoryUpdate = vi.fn()
  const didsUpdate = vi.fn()
  const agent = {
    did: DID,
    config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    dids: { getCreatedDids: async () => [didRecord], update: didsUpdate },
    context: { dependencyManager: { resolve: () => ({ update: repositoryUpdate }) } },
    veranaChain: chain,
  }
  return { agent, didDocument, didsUpdate }
}

function makeChain(overrides: Record<string, unknown> = {}) {
  return {
    address: 'verana1operator',
    getCredentialSchema: vi.fn(async () => ({ id: 5, digestAlgorithm: 'sha256' })),
    getDigest: vi.fn(async () => undefined),
    createOrUpdateParticipantSession: vi.fn(async () => ({ txHash: 'ABC' })),
    ...overrides,
  }
}

const JSC_ID = 'https://ecosystem.example/vt/schemas-5-jsc.json'
const ISSUER_PARTICIPANT_ID = 42

async function rebind(agent: unknown) {
  // The VTJSC comes from the Ecosystem, which may be another party entirely, and the caller
  // supplies the ISSUER participant that anchors the digest.
  await rebindEcsCredentialSchema(
    agent as never,
    'https://agent.example',
    '5',
    'ecs-service',
    defaults,
    JSC_ID,
    ISSUER_PARTICIPANT_ID,
  )
}

describe('ECS credential digest anchoring', () => {
  beforeEach(() => {
    generateVerifiablePresentation.mockReset()
    // the real function calls the beforePublish step with the signed presentation
    generateVerifiablePresentation.mockImplementation(async (...args: unknown[]) => {
      const verifiablePresentation = { id: 'vp', verifiableCredential: [{ id: 'credential' }] }
      const beforePublish = args[7] as (vp: unknown) => Promise<void>
      await beforePublish?.(verifiablePresentation)
      return verifiablePresentation
    })
  })

  it('anchors the digest that the chain does not hold yet', async () => {
    const chain = makeChain()
    const { agent } = makeAgent(chain)

    await rebind(agent)

    expect(chain.createOrUpdateParticipantSession).toHaveBeenCalledWith(
      expect.objectContaining({ digest: DIGEST, issuerParticipantId: ISSUER_PARTICIPANT_ID }),
    )
  })

  it('names only the issuer, because a self-issued credential has no counterparty', async () => {
    const chain = makeChain()
    const { agent } = makeAgent(chain)

    await rebind(agent)

    const [session] = chain.createOrUpdateParticipantSession.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ]
    expect(session.agentParticipantId).toBe(0)
    expect(session.walletAgentParticipantId).toBe(0)
    expect(session.id).toEqual(expect.any(String))
  })

  it('sends no transaction when the digest is already anchored', async () => {
    const chain = makeChain({ getDigest: vi.fn(async () => ({ digest: DIGEST, created: new Date() })) })
    const { agent } = makeAgent(chain)

    await rebind(agent)

    expect(chain.createOrUpdateParticipantSession).not.toHaveBeenCalled()
  })

  it('publishes nothing when the agent cannot anchor the digest', async () => {
    const chain = makeChain({
      createOrUpdateParticipantSession: vi.fn(async () => {
        throw new Error('chain is unreachable')
      }),
    })
    const { agent, didsUpdate } = makeAgent(chain)

    await expect(rebind(agent)).rejects.toThrow('chain is unreachable')
    expect(didsUpdate).not.toHaveBeenCalled()
  })

  it('fails when the schema is not on chain', async () => {
    const chain = makeChain({ getCredentialSchema: vi.fn(async () => undefined) })
    const { agent } = makeAgent(chain)

    await expect(rebind(agent)).rejects.toThrow('not on chain')
    expect(chain.createOrUpdateParticipantSession).not.toHaveBeenCalled()
  })

  it('publishes the credential of an agent that has no chain connection', async () => {
    const { agent, didsUpdate } = makeAgent(undefined)

    await rebind(agent)

    expect(didsUpdate).toHaveBeenCalledTimes(1)
  })
})
