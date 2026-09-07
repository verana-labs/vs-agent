import type { NextFunction, Request, Response } from 'express'

import { describe, expect, it, vi } from 'vitest'

import { accommodateOpenId4VciKt } from '../src/sdk/setupOpenId4Vc'

const OPENID4VCI_KT_ACCEPT = 'application/jwt; application/json'

const metadata = (proofTypes: Record<string, unknown>) =>
  JSON.stringify({
    credential_issuer: 'https://issuer.example/oid4vci/demo-did',
    credential_configurations_supported: {
      'demo-credential': { format: 'dc+sd-jwt', proof_types_supported: proofTypes },
    },
  })

const run = (
  accept: string | undefined,
  body: string,
  overrides: Partial<Request> = {},
  hasAnchor = true,
) => {
  const request = {
    method: 'GET',
    path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
    headers: accept === undefined ? {} : { accept },
    ...overrides,
  } as unknown as Request
  let sent: unknown
  const response = {
    send: (payload?: unknown) => {
      sent = payload
      return response
    },
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  accommodateOpenId4VciKt(hasAnchor)(request, response, next)
  response.send(body)
  return { sent: sent as string, accept: request.headers.accept, next }
}

const proofTypesOf = (sent: string) =>
  JSON.parse(sent).credential_configurations_supported['demo-credential'].proof_types_supported

const jwtOnly = { jwt: { proof_signing_alg_values_supported: ['ES256'] } }

describe('accommodateOpenId4VciKt', () => {
  it('serves JSON and an unconstrained key-attestation requirement to openid4vci-kt', () => {
    const { sent, accept, next } = run(OPENID4VCI_KT_ACCEPT, metadata(jwtOnly))

    const expected = { proof_signing_alg_values_supported: ['ES256'], key_attestations_required: {} }
    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual({ jwt: expected, attestation: expected })
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves every other client untouched, so a Credo holder still binds a plain jwk', () => {
    const json = run('application/json', metadata(jwtOnly))
    const jwtOnlyClient = run('application/jwt', metadata(jwtOnly))
    const absent = run(undefined, metadata(jwtOnly))

    expect(proofTypesOf(json.sent)).toEqual(jwtOnly)
    expect(jwtOnlyClient.accept).toBe('application/jwt')
    expect(proofTypesOf(jwtOnlyClient.sent)).toEqual(jwtOnly)
    expect(proofTypesOf(absent.sent)).toEqual(jwtOnly)
  })

  it('never invents a proof type the issuer does not accept', () => {
    const { sent } = run(OPENID4VCI_KT_ACCEPT, metadata(jwtOnly), {}, false)

    expect(Object.keys(proofTypesOf(sent))).toEqual(['jwt'])
  })

  // swiyu models proof_types_supported as a closed enum, so an `attestation` member it does not
  // know makes it throw while deserializing and the credential offer dies before it renders.
  it('keeps attestation away from every client but openid4vci-kt', () => {
    const json = run('application/json', metadata(jwtOnly))
    const absent = run(undefined, metadata(jwtOnly))

    expect(Object.keys(proofTypesOf(json.sent))).toEqual(['jwt'])
    expect(Object.keys(proofTypesOf(absent.sent))).toEqual(['jwt'])
  })

  it('serves plain metadata to a client that asks for JSON first, without the payload change', () => {
    const swiyu = run('application/json, application/jwt', metadata(jwtOnly))

    expect(swiyu.accept).toBe('application/json')
    expect(Object.keys(proofTypesOf(swiyu.sent))).toEqual(['jwt'])
  })

  // The corrected comma spelling cannot identify openid4vci-kt: swiyu sends it too, and a client
  // told `key_attestations_required` stops binding a plain JWK. swiyu then asks its federal
  // attestation service for a key attestation it cannot obtain and the offer dies, so the
  // accommodation stays on the malformed spelling that only the older library sends.
  it('leaves a correctly spelled jwt-first accept untouched, so swiyu still binds a plain jwk', () => {
    const { sent, accept } = run('application/jwt, application/json', metadata(jwtOnly))

    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual(jwtOnly)
  })

  it('leaves a jwt-only accept alone', () => {
    expect(run('application/jwt', metadata(jwtOnly)).accept).toBe('application/jwt')
  })

  it('leaves other paths, unknown proof types and non-JSON bodies alone', () => {
    expect(run(OPENID4VCI_KT_ACCEPT, '{"plain":true}', { path: '/oid4vci/demo-did/credential' }).sent).toBe(
      '{"plain":true}',
    )
    expect(proofTypesOf(run(OPENID4VCI_KT_ACCEPT, metadata({ ldp_vp: {} }), {}, false).sent)).toEqual({
      ldp_vp: {},
    })
    expect(run(OPENID4VCI_KT_ACCEPT, 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe('eyJhbGciOiJFUzI1NiJ9.e30.sig')
  })
})
