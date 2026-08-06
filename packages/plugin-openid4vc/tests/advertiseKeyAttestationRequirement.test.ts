import type { NextFunction, Request, Response } from 'express'

import { describe, expect, it, vi } from 'vitest'

import { advertiseKeyAttestationRequirement } from '../src/sdk/setupOpenId4Vc'

const metadata = (proofTypes: Record<string, unknown>) =>
  JSON.stringify({
    credential_issuer: 'https://issuer.example/oid4vci/demo-did',
    credential_configurations_supported: {
      'demo-credential': {
        format: 'dc+sd-jwt',
        proof_types_supported: proofTypes,
      },
    },
  })

const run = (body: string, overrides: Partial<Request> = {}) => {
  const request = {
    method: 'GET',
    path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
    ...overrides,
  } as Request
  let sent: unknown
  const response = {
    send: (payload?: unknown) => {
      sent = payload
      return response
    },
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  advertiseKeyAttestationRequirement(request, response, next)
  response.send(body)
  return { sent: sent as string, next }
}

describe('advertiseKeyAttestationRequirement', () => {
  it('adds an unconstrained requirement to a jwt proof type that lacks one', () => {
    const { sent, next } = run(metadata({ jwt: { proof_signing_alg_values_supported: ['ES256'] } }))

    const parsed = JSON.parse(sent)
    expect(
      parsed.credential_configurations_supported['demo-credential'].proof_types_supported.jwt,
    ).toEqual({ proof_signing_alg_values_supported: ['ES256'], key_attestations_required: {} })
    expect(next).toHaveBeenCalledOnce()
  })

  it('keeps an existing requirement untouched', () => {
    const existing = {
      jwt: {
        proof_signing_alg_values_supported: ['ES256'],
        key_attestations_required: { key_storage: ['iso_18045_high'] },
      },
    }
    const { sent } = run(metadata(existing))

    expect(
      JSON.parse(sent).credential_configurations_supported['demo-credential'].proof_types_supported,
    ).toEqual(existing)
  })

  it('leaves unknown proof types and non-JSON bodies alone', () => {
    const withLdp = run(metadata({ ldp_vp: {} }))
    expect(
      JSON.parse(withLdp.sent).credential_configurations_supported['demo-credential']
        .proof_types_supported,
    ).toEqual({ ldp_vp: {} })

    const jwt = run('eyJhbGciOiJFUzI1NiJ9.e30.sig')
    expect(jwt.sent).toBe('eyJhbGciOiJFUzI1NiJ9.e30.sig')
  })

  it('does not intercept other paths', () => {
    const { sent } = run('{"plain":true}', { path: '/oid4vci/demo-did/credential' })

    expect(sent).toBe('{"plain":true}')
  })
})
