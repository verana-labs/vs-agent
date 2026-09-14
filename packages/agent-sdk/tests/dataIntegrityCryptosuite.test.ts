import '@openwallet-foundation/askar-nodejs'

import type { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import {
  ConsoleLogger,
  JsonTransformer,
  LogLevel,
  W3cV2DataIntegrityVerifiableCredential,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { DEFAULT_DATA_INTEGRITY_CRYPTOSUITE, VtFlowModuleConfig } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { createVsAgent, type VsAgent } from '../src/agent'
import { VeranaIndexerService } from '../src/blockchain/VeranaIndexerService'
import { setupBaseDidComm } from '../src/plugins/setupBaseDidComm'
import {
  createCredential,
  createPresentation,
  getDataIntegrityCryptosuite,
  signerW3c,
} from '../src/utils/setupSelfTr'
import { signLinkedDataIntegrityPresentation } from '../src/utils/trustCredentialStore'

const DID = 'did:web:agent.example'
const VERIFICATION_METHOD = `${DID}#key-1`
const CONFIGURED = 'eddsa-rdfc-2022'

const credential = createCredential({
  id: `${DID}#vtc-1`,
  type: ['VerifiableCredential', 'VerifiableTrustCredential'],
  issuer: DID,
  credentialSubject: { id: DID, name: 'Test Service' },
})

const securedCredential = new W3cV2DataIntegrityVerifiableCredential({
  securedCredential: {
    ...JsonTransformer.toJSON(credential),
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: DEFAULT_DATA_INTEGRITY_CRYPTOSUITE,
      proofPurpose: 'assertionMethod',
      verificationMethod: VERIFICATION_METHOD,
      proofValue: 'z-stub',
    },
  },
})

/**
 * An agent whose dependency manager holds the given vt-flow config, or no vt-flow module at all
 * when omitted, with a V2 signer that records the options it receives.
 */
function makeAgent(config?: VtFlowModuleConfig) {
  const signCredential = vi.fn(async () => securedCredential)
  const signPresentation = vi.fn(async () => ({ securedPresentation: {} }))
  const agent = {
    context: {
      dependencyManager: {
        isRegistered: (token: unknown) => config !== undefined && token === VtFlowModuleConfig,
        resolve: (token: unknown) => {
          if (config && token === VtFlowModuleConfig) return config
          throw new Error(`Unexpected dependency: ${String(token)}`)
        },
      },
    },
    w3cV2Credentials: { signCredential, signPresentation },
  }
  return { agent: agent as never, signCredential, signPresentation }
}

describe('getDataIntegrityCryptosuite', () => {
  it('returns the cryptosuite the vt-flow module is configured with', () => {
    const { agent } = makeAgent(new VtFlowModuleConfig({ dataIntegrityCryptosuite: CONFIGURED }))
    expect(getDataIntegrityCryptosuite(agent)).toBe(CONFIGURED)
  })

  it('returns the module default when no cryptosuite is configured', () => {
    const { agent } = makeAgent(new VtFlowModuleConfig())
    expect(getDataIntegrityCryptosuite(agent)).toBe(DEFAULT_DATA_INTEGRITY_CRYPTOSUITE)
  })

  it('returns the module default when the vt-flow module is not registered', () => {
    const { agent } = makeAgent()
    expect(getDataIntegrityCryptosuite(agent)).toBe(DEFAULT_DATA_INTEGRITY_CRYPTOSUITE)
  })
})

describe('on a VsAgent built with setupBaseDidComm', () => {
  const publicApiBaseUrl = 'https://agent.example'
  const walletConfig: AskarModuleConfigStoreOptions = {
    id: 'data-integrity-cryptosuite-test',
    key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
    keyDerivationMethod: 'raw',
    database: { type: 'sqlite', config: { inMemory: true } },
  }
  // Module registration happens in the constructor, so the config is reachable without initializing
  const makeVsAgent = (vtFlow?: { dataIntegrityCryptosuite?: string }) =>
    createVsAgent({
      plugins: [
        setupBaseDidComm({ walletConfig, publicApiBaseUrl, endpoints: ['rxjs:agent.example'], vtFlow }),
      ],
      walletConfig,
      did: DID,
      dependencies: agentDependencies,
      publicApiBaseUrl,
      indexer: new VeranaIndexerService({
        baseUrl: 'https://indexer.invalid',
        logger: new ConsoleLogger(LogLevel.Off),
      }),
    }) as unknown as VsAgent

  it('resolves the registered VtFlowModuleConfig rather than falling back', () => {
    const agent = makeVsAgent()
    expect(agent.context.dependencyManager.isRegistered(VtFlowModuleConfig)).toBe(true)
    expect(getDataIntegrityCryptosuite(agent)).toBe(DEFAULT_DATA_INTEGRITY_CRYPTOSUITE)
  })

  it('reads the cryptosuite passed through the vtFlow plugin options', () => {
    expect(getDataIntegrityCryptosuite(makeVsAgent({ dataIntegrityCryptosuite: CONFIGURED }))).toBe(
      CONFIGURED,
    )
  })
})

describe('self trust registry signers follow the configured cryptosuite', () => {
  const config = new VtFlowModuleConfig({ dataIntegrityCryptosuite: CONFIGURED })

  it('signerW3c secures a credential with it', async () => {
    const { agent, signCredential } = makeAgent(config)
    await signerW3c(agent, credential, VERIFICATION_METHOD)
    expect(signCredential).toHaveBeenCalledWith(
      expect.objectContaining({ cryptosuite: CONFIGURED, verificationMethod: VERIFICATION_METHOD }),
    )
  })

  it('signerW3c secures a presentation with it', async () => {
    const { agent, signPresentation } = makeAgent(config)
    const presentation = createPresentation({
      id: `${DID}/vt/vp.json`,
      holder: DID,
      verifiableCredential: [securedCredential],
    })
    await signerW3c(agent, presentation, VERIFICATION_METHOD)
    expect(signPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ cryptosuite: CONFIGURED, verificationMethod: VERIFICATION_METHOD }),
    )
  })

  it('signLinkedDataIntegrityPresentation secures the linked VP with it', async () => {
    const { agent, signPresentation } = makeAgent(config)
    await signLinkedDataIntegrityPresentation(agent, {
      id: `${DID}/vt/schemas-1-vtc-vp.json`,
      holder: DID,
      credential: securedCredential,
      verificationMethodId: VERIFICATION_METHOD,
    })
    expect(signPresentation).toHaveBeenCalledWith(expect.objectContaining({ cryptosuite: CONFIGURED }))
  })

  it('falls back to the module default without the vt-flow module', async () => {
    const { agent, signCredential } = makeAgent()
    await signerW3c(agent, credential, VERIFICATION_METHOD)
    expect(signCredential).toHaveBeenCalledWith(
      expect.objectContaining({ cryptosuite: DEFAULT_DATA_INTEGRITY_CRYPTOSUITE }),
    )
  })
})
