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

const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')

const compactJws = (header: Record<string, unknown>, payload: Record<string, unknown>) =>
  `${encode(header)}.${encode(payload)}.credo-signature`

const runSigned = async (accept: string, body: string) => {
  const request = {
    method: 'GET',
    path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
    headers: { accept },
  } as unknown as Request
  let sent: unknown
  const response = {
    send: (payload?: unknown) => {
      sent = payload
      return response
    },
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  const sign = vi.fn(
    async (header: Record<string, unknown>, payload: Record<string, unknown>) =>
      `${encode(header)}.${encode(payload)}.our-signature`,
  )

  accommodateOpenId4VciKt(sign)(request, response, next)
  response.send(body)
  await vi.waitFor(() => expect(sent).toBeDefined())
  return { sent: sent as string, sign, next }
}

const decode = (segment: string) =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>

const SIGNED_HEADER = {
  alg: 'ES256',
  kid: 'did:webvh:issuer.example#key-1',
  typ: 'openidvci-issuer-metadata+jwt',
}
const signedPayload = (proofTypes: Record<string, unknown>) => ({
  ...JSON.parse(metadata(proofTypes)),
  sub: 'https://issuer.example/oid4vci/demo-did',
  iat: 1_757_000_000,
})

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

  // eudi-lib-android-wallet-core 0.29 corrected the spelling to two ranges, jwt first, which is
  // exactly what swiyu's ktor client sends once ContentNegotiation appends json to its jwt accept.
  it('recognises the corrected jwt-first spelling of wallet-core 0.29 as openid4vci-kt', () => {
    const { sent, accept } = run('application/jwt, application/json', metadata(jwtOnly))

    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual({ jwt: attested, attestation: attested })
  })

  it('tells swiyu apart by its user agent and serves it plain JSON without attestation', () => {
    const swiyu = run('application/jwt, application/json', metadata(withAttestation), {
      headers: { accept: 'application/jwt, application/json', 'user-agent': 'swiyuWallet' },
    } as Partial<Request>)

    expect(swiyu.accept).toBe('application/json')
    expect(proofTypesOf(swiyu.sent)).toEqual(jwtOnly)
  })

  it('leaves a jwt-only accept alone', () => {
    expect(run('application/jwt', metadata(jwtOnly)).accept).toBe('application/jwt')
  })

  // swiyu asks for application/jwt alone and gets Credo's DID-signed metadata JWT, whose payload is
  // the issuer record: the attestation member has to come out of there too, under the same header.
  it('re-signs the metadata JWT without the attestation proof type', async () => {
    const { sent, sign } = await runSigned(
      'application/jwt',
      compactJws(SIGNED_HEADER, signedPayload(withAttestation)),
    )
    const [header, payload, signature] = sent.split('.')

    expect(decode(header)).toEqual(SIGNED_HEADER)
    expect(decode(payload)).toEqual(signedPayload(jwtOnly))
    expect(signature).toBe('our-signature')
    expect(sign).toHaveBeenCalledOnce()
  })

  it('leaves a metadata JWT that carries no attestation proof type untouched', async () => {
    const body = compactJws(SIGNED_HEADER, signedPayload(jwtOnly))
    const { sent, sign } = await runSigned('application/jwt', body)

    expect(sent).toBe(body)
    expect(sign).not.toHaveBeenCalled()
  })

  it('never re-signs for a client that reads the plain metadata', async () => {
    const body = compactJws(SIGNED_HEADER, signedPayload(withAttestation))
    const kt = await runSigned(OPENID4VCI_KT_ACCEPT, body)
    const json = await runSigned('application/json', body)

    expect(kt.sent).toBe(body)
    expect(json.sent).toBe(body)
    expect(kt.sign).not.toHaveBeenCalled()
    expect(json.sign).not.toHaveBeenCalled()
  })

  it('forwards a signing failure to the error handler instead of serving the attestation member', async () => {
    const request = {
      method: 'GET',
      path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
      headers: { accept: 'application/jwt' },
    } as unknown as Request
    const send = vi.fn()
    const response = { send } as unknown as Response
    const next = vi.fn() as unknown as NextFunction
    const failure = new Error('issuer service is not initialized')

    accommodateOpenId4VciKt(() => Promise.reject(failure))(request, response, next)
    response.send(compactJws(SIGNED_HEADER, signedPayload(withAttestation)))
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure))

    expect(send).not.toHaveBeenCalled()
  })

  it('leaves other paths, unknown proof types and non-JSON bodies alone', () => {
    expect(run(OPENID4VCI_KT_ACCEPT, '{"plain":true}', { path: '/oid4vci/demo-did/credential' }).sent).toBe(
      '{"plain":true}',
    )
    expect(proofTypesOf(run(OPENID4VCI_KT_ACCEPT, metadata({ ldp_vp: {} })).sent)).toEqual({
      ldp_vp: {},
    })
    expect(run(OPENID4VCI_KT_ACCEPT, 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe(
      'eyJhbGciOiJFUzI1NiJ9.e30.sig',
    )
    expect(run('application/json', 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe('eyJhbGciOiJFUzI1NiJ9.e30.sig')
  })
})
