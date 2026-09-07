import { HttpException } from '@nestjs/common'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { SelfTrController } from '../src/controllers/public/self-tr/SelfTrController'

const PUBLIC_API_BASE_URL = 'https://agent.example.com'

describe('SelfTrController /vt dispatch', () => {
  let getVerifiableTrustCredential: ReturnType<typeof vi.fn>
  let getJsonSchemaCredential: ReturnType<typeof vi.fn>
  let controller: SelfTrController

  beforeEach(() => {
    getVerifiableTrustCredential = vi.fn(async () => ({ served: 'vtc' }))
    getJsonSchemaCredential = vi.fn(async () => ({ served: 'vtjsc' }))
    controller = new SelfTrController(
      {} as never,
      { getVerifiableTrustCredential, getJsonSchemaCredential } as never,
      PUBLIC_API_BASE_URL,
    )
  })

  it('routes the trust credential VP to getVerifiableTrustCredential', async () => {
    await controller.getCredentials('ecs-service-vtc-vp.json')
    expect(getVerifiableTrustCredential).toHaveBeenCalledWith(
      `${PUBLIC_API_BASE_URL}/vt/ecs-service-vtc-vp.json`,
    )
    expect(getJsonSchemaCredential).not.toHaveBeenCalled()
  })

  it('routes the schema credential VP to getJsonSchemaCredential', async () => {
    await controller.getCredentials('schemas-org-schema-vtjsc-vp.json')
    expect(getJsonSchemaCredential).toHaveBeenCalledWith(
      `${PUBLIC_API_BASE_URL}/vt/schemas-org-schema-vtjsc-vp.json`,
    )
    expect(getVerifiableTrustCredential).not.toHaveBeenCalled()
  })

  it('still routes the raw JsonSchemaCredential, which is not a VP and keeps its name', async () => {
    await controller.getCredentials('schemas-org-schema-jsc.json')
    expect(getJsonSchemaCredential).toHaveBeenCalledWith(
      `${PUBLIC_API_BASE_URL}/vt/schemas-org-schema-jsc.json`,
    )
  })

  it('rejects the pre-v4 names so a half-applied rename cannot pass silently', async () => {
    for (const legacy of ['ecs-service-c-vp.json', 'schemas-org-schema-jsc-vp.json']) {
      await expect(controller.getCredentials(legacy)).rejects.toBeInstanceOf(HttpException)
    }
    expect(getVerifiableTrustCredential).not.toHaveBeenCalled()
    expect(getJsonSchemaCredential).not.toHaveBeenCalled()
  })
})
