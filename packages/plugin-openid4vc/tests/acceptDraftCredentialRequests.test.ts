import type { NextFunction, Request, Response } from 'express'

import { describe, expect, it, vi } from 'vitest'

import { acceptDraftCredentialRequests } from '../src/sdk/setupOpenId4Vc'
import type { OpenId4VcCredentialConfiguration } from '../src/types'

const configuration: OpenId4VcCredentialConfiguration = {
  id: 'demo-credential',
  format: 'dc+sd-jwt',
  vct: 'https://issuer.example/oid4vc/vct/demo-credential',
  name: 'DemoCredential',
  vtjscId: 'vtjsc:example',
  claims: ['name', 'demoId'],
  disclosureFrame: ['name', 'demoId'],
  ttlSeconds: 3600,
}

const run = (body: unknown, overrides: Partial<Request> = {}) => {
  const request = { method: 'POST', path: '/oid4vci/demo-did/credential', body, ...overrides } as Request
  const next = vi.fn() as unknown as NextFunction
  acceptDraftCredentialRequests([configuration])(request, {} as Response, next)
  return { body: request.body, next }
}

describe('acceptDraftCredentialRequests', () => {
  it('names the configuration a draft wallet described by vct', () => {
    const { body, next } = run({ format: 'dc+sd-jwt', vct: configuration.vct, proof: { proof_type: 'jwt' } })

    expect(body).toEqual({ credential_configuration_id: 'demo-credential', proof: { proof_type: 'jwt' } })
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves a 1.0 request untouched', () => {
    const original = { credential_configuration_id: 'demo-credential', proof: { proof_type: 'jwt' } }
    const { body } = run({ ...original })

    expect(body).toEqual(original)
  })

  it('leaves a vct it does not issue untouched, so the wallet still gets the real error', () => {
    const original = { format: 'dc+sd-jwt', vct: 'https://issuer.example/vct/unknown' }
    const { body } = run({ ...original })

    expect(body).toEqual(original)
  })

  it('does not touch a credential_identifier request', () => {
    const original = { credential_identifier: 'abc', vct: configuration.vct }
    const { body } = run({ ...original })

    expect(body).toEqual(original)
  })

  it('ignores anything that is not a credential POST', () => {
    const original = { format: 'dc+sd-jwt', vct: configuration.vct }
    expect(run({ ...original }, { method: 'GET' }).body).toEqual(original)
    expect(run({ ...original }, { path: '/oid4vci/demo-did/token' }).body).toEqual(original)
  })

  it('passes a non-object body through', () => {
    const { next } = run(undefined)
    expect(next).toHaveBeenCalledOnce()
  })
})
