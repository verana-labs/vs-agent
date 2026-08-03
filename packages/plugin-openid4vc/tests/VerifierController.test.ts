import type { OpenId4VcPluginOptions } from '../src/types'
import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VerifierController } from '../src/nestjs/VerifierController'
import { CreateOpenId4VcVerificationRequestDto } from '../src/nestjs/dto'
import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import {
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  VerifierService,
} from '../src/services/VerifierService'

describe('VerifierController', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  async function createApp(service: {
    createRequest: ReturnType<typeof vi.fn>
    getResult: ReturnType<typeof vi.fn>
  }) {
    const moduleRef = await Test.createTestingModule({
      controllers: [VerifierController],
      providers: [{ provide: VerifierService, useValue: service }],
    }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe())
    await app.init()
    return app
  }

  it('registers internal POST /v1/oid4vc/verifier/requests with a policy DTO', async () => {
    const service = {
      createRequest: vi.fn().mockResolvedValue({
        authorizationRequest: 'openid4vp://?request_uri=opaque',
        verificationSessionId: 'session-id',
      }),
      getResult: vi.fn(),
    }
    const nestApp = await createApp(service)

    const response = await request(nestApp.getHttpServer())
      .post('/v1/oid4vc/verifier/requests')
      .send({ policyId: 'employee-name' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSessionId: 'session-id',
    })
    expect(service.createRequest).toHaveBeenCalledWith('employee-name')
    expect(Reflect.getMetadata('adminAccessMode', VerifierController)).toBeUndefined()
    expect(Reflect.getMetadata('adminAccessMode', VerifierController.prototype.createRequest)).toBeUndefined()
  })

  it('registers internal GET /v1/oid4vc/verifier/sessions/:id', async () => {
    const service = {
      createRequest: vi.fn(),
      getResult: vi.fn().mockResolvedValue({
        state: 'ResponseVerified',
        cryptographicVerified: true,
        accepted: true,
        credential: { vct: 'https://agent.example/vct', disclosedClaims: { name: 'Ada' } },
        trust: { verdict: 'TRUSTED_AUTHORIZED', evidence: { queries: [] } },
      }),
    }
    const nestApp = await createApp(service)

    const response = await request(nestApp.getHttpServer()).get('/v1/oid4vc/verifier/sessions/session-id')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: true,
      credential: { vct: 'https://agent.example/vct', disclosedClaims: { name: 'Ada' } },
      trust: { verdict: 'TRUSTED_AUTHORIZED', evidence: { queries: [] } },
    })
    expect(service.getResult).toHaveBeenCalledWith('session-id')
    expect(Reflect.getMetadata('adminAccessMode', VerifierController.prototype.getResult)).toBeUndefined()
  })

  it('returns 400 for missing and unknown policies without exposing stack details', async () => {
    const service = {
      createRequest: vi
        .fn()
        .mockRejectedValue(new OpenId4VcVerifierRequestError("unknown verifier policy 'missing'")),
      getResult: vi.fn(),
    }
    const nestApp = await createApp(service)

    const missing = await request(nestApp.getHttpServer()).post('/v1/oid4vc/verifier/requests').send({})
    const unknown = await request(nestApp.getHttpServer())
      .post('/v1/oid4vc/verifier/requests')
      .send({ policyId: 'missing' })

    expect(missing.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(unknown.body.message).toBe("unknown verifier policy 'missing'")
    expect(unknown.body).not.toHaveProperty('stack')
  })

  it('maps only typed unknown session errors to 404', async () => {
    const service = {
      createRequest: vi.fn(),
      getResult: vi.fn().mockRejectedValue(new UnknownVerificationSessionError('session not found')),
    }
    const nestApp = await createApp(service)

    const response = await request(nestApp.getHttpServer()).get('/v1/oid4vc/verifier/sessions/missing')

    expect(response.status).toBe(404)
    expect(response.body.message).toBe('session not found')
    expect(response.body).not.toHaveProperty('stack')
  })

  it('defines the policy DTO without application-only or public decorators', async () => {
    const { validate } = await import('class-validator')
    const dto = Object.assign(new CreateOpenId4VcVerificationRequestDto(), { policyId: '' })

    expect(await validate(dto)).toHaveLength(1)
    expect(Reflect.getMetadata('adminAccessMode', VerifierController)).toBeUndefined()
  })

  it('does not mount verifier management or holder routes on the public middleware', async () => {
    const options: OpenId4VcPluginOptions = {
      publicApiBaseUrl: 'https://agent.example',
      verifier: {
        id: 'verifier',
        displayName: 'Example Verifier',
        signing: { development: { enabled: true, commonName: 'Example Verifier' } },
      },
      trust: {
        resolverUrl: 'https://resolver.example/v1/trust',
        timeoutMs: 5_000,
        allowedDidWebHosts: ['issuer.example'],
        credentialIssuerCertificates: ['trusted-root'],
      },
      credentialConfigurations: [],
      verifierPolicies: [],
    }
    const { publicMiddleware } = setupOpenId4Vc(options)

    const requestRoute = await request(publicMiddleware).post('/v1/oid4vc/verifier/requests').send({})
    const resultRoute = await request(publicMiddleware).get('/v1/oid4vc/verifier/sessions/session-id')
    const holderRoute = await request(publicMiddleware).get('/v1/oid4vc/holder/credentials')

    expect(requestRoute.status).toBe(404)
    expect(resultRoute.status).toBe(404)
    expect(holderRoute.status).toBe(404)
  })
})
