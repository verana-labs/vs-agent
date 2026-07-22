import type { OpenId4VcCredentialConfiguration } from '../src/types'
import type { DidDocument } from '@credo-ts/core'

import { describe, expect, it } from 'vitest'

import { createCertificateFixtures } from './helpers/certificates'
import { didDocumentWithKey, MapDidResolver } from './helpers/didResolver'
import {
  activeTcpServers,
  createVerifierCertificate,
  OpenId4VcTestStartupError,
  startOpenId4VcTestAgents,
  type TestAgentFailureHooks,
} from './helpers/testAgent'

const ISSUER_DID = 'did:web:issuer.example'
const VERIFIER_DID = 'did:web:verifier.example'
const CONFIGURATION: OpenId4VcCredentialConfiguration = {
  id: 'employee',
  format: 'dc+sd-jwt',
  vct: 'https://credentials.example/vct/employee',
  name: 'Employee credential',
  vtjscId: 'https://credentials.example/vt/employee.json',
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
  ttlSeconds: 3_600,
}

describe('OpenID4VC test-agent startup cleanup', () => {
  it('closes the acquired server when plugin option creation fails', async () => {
    const primary = new Error('deliberate issuer options failure')
    await expectCleanStartupFailure(
      {
        beforeOptions: role => {
          if (role === 'issuer') throw primary
        },
      },
      primary,
    )
  })

  it('shuts down an acquired holder agent when holder initialization fails', async () => {
    const primary = new Error('deliberate holder initialization failure')
    await expectCleanStartupFailure(
      {
        afterInitialize: role => {
          if (role === 'holder') throw primary
        },
      },
      primary,
    )
  })

  it('closes verifier resources and reports cleanup failure without losing the startup error', async () => {
    const primary = new Error('deliberate verifier initialization failure')
    const cleanup = new Error('deliberate verifier cleanup failure')
    const outcome = await captureStartup({
      afterInitialize: role => {
        if (role === 'verifier') throw primary
      },
      afterCleanup: role => {
        if (role === 'verifier') throw cleanup
      },
    })

    expect(outcome.error).toBeInstanceOf(OpenId4VcTestStartupError)
    expect(outcome.error).toMatchObject({ cause: primary, cleanupErrors: [cleanup] })
    expect(outcome.after).toEqual(outcome.before)
  })
})

async function expectCleanStartupFailure(hooks: TestAgentFailureHooks, primary: Error): Promise<void> {
  const outcome = await captureStartup(hooks)
  expect(outcome.error).toBe(primary)
  expect(outcome.after).toEqual(outcome.before)
}

async function captureStartup(hooks: TestAgentFailureHooks): Promise<{
  before: string[]
  after: string[]
  error?: unknown
}> {
  const input = await startupInput()
  const before = activeTcpServers()
  let error: unknown
  const started = await startOpenId4VcTestAgents({ ...input, failureHooks: hooks }).catch(cause => {
    error = cause
    return undefined
  })
  await started?.stop()
  await new Promise(resolve => setImmediate(resolve))
  return { before, after: activeTcpServers(), error }
}

async function startupInput() {
  const certificates = await createCertificateFixtures()
  const verifierCertificate = await createVerifierCertificate(certificates.root, VERIFIER_DID)
  const documents = new Map<string, DidDocument>()
  documents.set(
    ISSUER_DID,
    didDocumentWithKey(ISSUER_DID, certificates.leaf.publicJwk.toJson(), ['assertionMethod']),
  )
  documents.set(
    VERIFIER_DID,
    didDocumentWithKey(VERIFIER_DID, verifierCertificate.publicJwk.toJson(), ['authentication']),
  )
  return {
    certificates,
    verifierCertificate,
    didResolver: new MapDidResolver(documents),
    resolverUrl: 'http://127.0.0.1:9/v1/trust',
    issuerDid: ISSUER_DID,
    verifierDid: VERIFIER_DID,
    credentialConfiguration: CONFIGURATION,
  }
}
