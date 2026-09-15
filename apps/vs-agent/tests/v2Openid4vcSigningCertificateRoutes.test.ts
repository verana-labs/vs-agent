import type { INestApplication, Provider } from '@nestjs/common'

import { VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IssuerService, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { ErrorEnvelopeFilter } from '../src/common'
import { V2Openid4vcSigningCertificatesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'

const issuerCertificate = {
  role: 'issuer',
  development: true,
  fingerprint: `SHA256:${'a'.repeat(64)}`,
  certificateChain: ['MIIB-issuer-leaf'],
}
const verifierCertificate = {
  role: 'verifier',
  development: false,
  fingerprint: `SHA256:${'b'.repeat(64)}`,
  certificateChain: ['MIIB-verifier-leaf', 'MIIB-intermediate', 'MIIB-root'],
}

const issuerService = {
  ensureInitialized: vi.fn().mockResolvedValue(undefined),
  getCertificateInfo: vi.fn(() => issuerCertificate),
}
const verifierService = {
  ensureInitialized: vi.fn().mockResolvedValue(undefined),
  getCertificateInfo: vi.fn(() => verifierCertificate),
}

async function createApp(providers: Provider[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [V2Openid4vcSigningCertificatesController],
    providers,
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()
  return app
}

describe('v2 openid4vc signing certificate routes', () => {
  let app: INestApplication | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('returns one record per configured capability, issuer first, as a bare array', async () => {
    app = await createApp([
      { provide: IssuerService, useValue: issuerService },
      { provide: VerifierService, useValue: verifierService },
    ])

    const response = await request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([issuerCertificate, verifierCertificate])
    expect(issuerService.ensureInitialized).toHaveBeenCalledOnce()
    expect(verifierService.ensureInitialized).toHaveBeenCalledOnce()
  })

  it('returns only the verifier certificate when the issuer capability is absent', async () => {
    app = await createApp([{ provide: VerifierService, useValue: verifierService }])

    const response = await request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([verifierCertificate])
  })

  it('ignores pagination parameters on this bounded collection', async () => {
    app = await createApp([
      { provide: IssuerService, useValue: issuerService },
      { provide: VerifierService, useValue: verifierService },
    ])

    const response = await request(app.getHttpServer()).get(
      '/v2/openid4vc/signing-certificates?limit=1&cursor=abc',
    )

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
  })

  it('never includes a private key', async () => {
    app = await createApp([{ provide: IssuerService, useValue: issuerService }])

    const response = await request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates')

    expect(JSON.stringify(response.body)).not.toContain('"d":')
    expect(Object.keys(response.body[0]).sort()).toEqual([
      'certificateChain',
      'development',
      'fingerprint',
      'role',
    ])
  })
})
