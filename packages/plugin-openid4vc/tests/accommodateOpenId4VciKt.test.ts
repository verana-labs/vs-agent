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

const run = (accept: string | undefined, body: string, overrides: Partial<Request> = {}) => {
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
  accommodateOpenId4VciKt()(request, response, next)
  response.send(body)
  return { sent: sent as string, accept: request.headers.accept, next }
}

const proofTypesOf = (sent: string) =>
  JSON.parse(sent).credential_configurations_supported['demo-credential'].proof_types_supported

const jwtOnly = { jwt: { proof_signing_alg_values_supported: ['ES256'] } }
const withAttestation = {
  jwt: { proof_signing_alg_values_supported: ['ES256'] },
  attestation: { proof_signing_alg_values_supported: ['ES256'], key_attestations_required: {} },
}
const attested = { proof_signing_alg_values_supported: ['ES256'], key_attestations_required: {} }

describe('accommodateOpenId4VciKt', () => {
  it('serves JSON and both attested proof types to openid4vci-kt', () => {
    const { sent, accept, next } = run(OPENID4VCI_KT_ACCEPT, metadata(jwtOnly))

    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual({ jwt: attested, attestation: attested })
    expect(next).toHaveBeenCalledOnce()
  })

  it('attests the attestation proof type the issuer record already advertises', () => {
    const { sent } = run(OPENID4VCI_KT_ACCEPT, metadata(withAttestation))

    expect(proofTypesOf(sent)).toEqual({ jwt: attested, attestation: attested })
  })

  it('leaves every other client with a plain jwt proof type, so a Credo holder still binds a plain jwk', () => {
    const json = run('application/json', metadata(jwtOnly))
    const jwtOnlyClient = run('application/jwt', metadata(jwtOnly))
    const absent = run(undefined, metadata(jwtOnly))

    expect(proofTypesOf(json.sent)).toEqual(jwtOnly)
    expect(jwtOnlyClient.accept).toBe('application/jwt')
    expect(proofTypesOf(jwtOnlyClient.sent)).toEqual(jwtOnly)
    expect(proofTypesOf(absent.sent)).toEqual(jwtOnly)
  })

  // swiyu models proof_types_supported as a closed enum, so an `attestation` member it does not
  // know makes it throw while deserializing and the credential offer dies before it renders.
  it('strips the record attestation member from every client but openid4vci-kt', () => {
    const json = run('application/json', metadata(withAttestation))
    const swiyu = run('application/json, application/jwt', metadata(withAttestation))
    const jwtOnlyClient = run('application/jwt', metadata(withAttestation))
    const absent = run(undefined, metadata(withAttestation))

    expect(Object.keys(proofTypesOf(json.sent))).toEqual(['jwt'])
    expect(Object.keys(proofTypesOf(swiyu.sent))).toEqual(['jwt'])
    expect(Object.keys(proofTypesOf(jwtOnlyClient.sent))).toEqual(['jwt'])
    expect(Object.keys(proofTypesOf(absent.sent))).toEqual(['jwt'])
    expect(proofTypesOf(json.sent)).toEqual(jwtOnly)
  })

  it('serves plain metadata to a client that asks for JSON first, without the payload change', () => {
    const swiyu = run('application/json, application/jwt', metadata(jwtOnly))

    expect(swiyu.accept).toBe('application/json')
    expect(proofTypesOf(swiyu.sent)).toEqual(jwtOnly)
  })

  // eudi-lib-android-wallet-core 0.29 corrected the spelling to two ranges, jwt first; swiyu asks
  // for application/jwt alone, so the order still identifies openid4vci-kt.
  it('recognises the corrected jwt-first spelling of wallet-core 0.29 as openid4vci-kt', () => {
    const { sent, accept } = run('application/jwt, application/json', metadata(jwtOnly))

    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual({ jwt: attested, attestation: attested })
  })

  it('leaves a jwt-only accept alone', () => {
    expect(run('application/jwt', metadata(jwtOnly)).accept).toBe('application/jwt')
  })

  it('leaves other paths, unknown proof types and non-JSON bodies alone', () => {
    expect(run(OPENID4VCI_KT_ACCEPT, '{"plain":true}', { path: '/oid4vci/demo-did/credential' }).sent).toBe(
      '{"plain":true}',
    )
    expect(proofTypesOf(run(OPENID4VCI_KT_ACCEPT, metadata({ ldp_vp: {} })).sent)).toEqual({
      ldp_vp: {},
    })
    expect(run(OPENID4VCI_KT_ACCEPT, 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe('eyJhbGciOiJFUzI1NiJ9.e30.sig')
    expect(run('application/json', 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe('eyJhbGciOiJFUzI1NiJ9.e30.sig')
  })
})
