import type { OpenId4VcPluginOptions } from '../src/types'
import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IssuerController } from '../src/nestjs/IssuerController'
import { CreateOpenId4VcOfferDto } from '../src/nestjs/dto'
import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'
import { IssuerService, OpenId4VcIssuerRequestError } from '../src/services/IssuerService'

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {
    id: 'issuer',
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
  },
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: 'https://agent.example/oid4vc/vct/employee',
      name: 'Employee credential',
      description: 'Proof of employment',
      vtjscId: 'https://agent.example/vt/employee.json',
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
      ttlSeconds: 3_600,
    },
  ],
  verifierPolicies: [],
})

describe('IssuerController', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  async function createApp(service: {
    createOffer: ReturnType<typeof vi.fn>
    getOfferState: ReturnType<typeof vi.fn>
  }) {
    const moduleRef = await Test.createTestingModule({
      controllers: [IssuerController],
      providers: [{ provide: IssuerService, useValue: service }],
    }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe())
    await app.init()
    return app
  }

  it('registers POST /v1/oid4vc/offers and returns only the offer handoff', async () => {
    const service = {
      createOffer: vi.fn().mockResolvedValue({
        credentialOffer: 'openid-credential-offer://?credential_offer_uri=opaque',
        issuanceSessionId: 'session-id',
      }),
      getOfferState: vi.fn(),
    }
    const nestApp = await createApp(service)

    const response = await request(nestApp.getHttpServer())
      .post('/v1/oid4vc/offers')
      .send({
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada', role: 'engineer' },
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=opaque',
      issuanceSessionId: 'session-id',
    })
    expect(service.createOffer).toHaveBeenCalledWith('employee', { name: 'Ada', role: 'engineer' })
  })

  it('registers GET /v1/oid4vc/offers/:id and returns safe offer state', async () => {
    const service = {
      createOffer: vi.fn(),
      getOfferState: vi.fn().mockResolvedValue({
        id: 'session-id',
        state: 'OfferCreated',
        createdAt: new Date('2026-07-21T10:00:00.000Z'),
        expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      }),
    }
    const nestApp = await createApp(service)

    const response = await request(nestApp.getHttpServer()).get('/v1/oid4vc/offers/session-id')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      id: 'session-id',
      state: 'OfferCreated',
      createdAt: '2026-07-21T10:00:00.000Z',
      expiresAt: '2026-07-21T10:05:00.000Z',
    })
    expect(response.body).not.toHaveProperty('preAuthorizedCode')
    expect(response.body).not.toHaveProperty('issuanceMetadata')
  })

  it('rejects missing DTO fields and invalid or arbitrary claims as client errors', async () => {
    const service = {
      createOffer: vi.fn().mockRejectedValue(new OpenId4VcIssuerRequestError("unknown claim 'admin'")),
      getOfferState: vi.fn(),
    }
    const nestApp = await createApp(service)

    const missing = await request(nestApp.getHttpServer()).post('/v1/oid4vc/offers').send({
      credentialConfigurationId: 'employee',
    })
    const arbitrary = await request(nestApp.getHttpServer())
      .post('/v1/oid4vc/offers')
      .send({
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada', role: 'engineer', admin: true },
      })

    expect(missing.status).toBe(400)
    expect(arbitrary.status).toBe(400)
    expect(arbitrary.body.message).toContain("unknown claim 'admin'")
  })

  it('defines a class-validator DTO without application-only decorators', async () => {
    const moduleName = await import('../src/nestjs/dto')
    const dto = Object.assign(new CreateOpenId4VcOfferDto(), {
      credentialConfigurationId: '',
      claims: null,
    })
    const { validate } = await import('class-validator')

    expect(await validate(dto)).toHaveLength(2)
    expect(Object.keys(moduleName)).toEqual(['CreateOpenId4VcOfferDto'])
  })

  it('mounts only public VCT metadata and no offer control, list, or delete route', async () => {
    const service = {
      mapCredentialRequest: vi.fn(),
      getVctMetadata: vi.fn((id: string) =>
        id === 'employee'
          ? {
              vct: 'https://agent.example/oid4vc/vct/employee',
              name: 'Employee credential',
              display: [{ locale: 'en', name: 'Employee credential' }],
              claims: [{ path: ['name'] }, { path: ['role'] }],
            }
          : undefined,
      ),
    }
    const setup = setupOpenId4Vc(options(), () => service as never)

    const metadata = await request(setup.publicMiddleware).get('/oid4vc/vct/employee')
    const unknown = await request(setup.publicMiddleware).get('/oid4vc/vct/unknown')
    const create = await request(setup.publicMiddleware).post('/v1/oid4vc/offers').send({})
    const list = await request(setup.publicMiddleware).get('/v1/oid4vc/offers')
    const remove = await request(setup.publicMiddleware).delete('/v1/oid4vc/offers/session-id')

    expect(metadata.status).toBe(200)
    expect(metadata.body.vct).toBe('https://agent.example/oid4vc/vct/employee')
    expect(unknown.status).toBe(404)
    expect(create.status).toBe(404)
    expect(list.status).toBe(404)
    expect(remove.status).toBe(404)
  })
})
