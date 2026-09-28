import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../src/types'

import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { findCredentialConfiguration } from '../src/config'
import { createCredentialConfigurationRegistry } from '../src/credentialConfigurationRegistry'
import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'

const configuration = (id: string): OpenId4VcCredentialConfiguration => ({
  id,
  format: 'dc+sd-jwt',
  vct: `https://issuer.example/vct/${id}`,
  name: id,
  vtjscId: `vtjsc:${id}`,
  claims: ['name'],
  disclosureFrame: ['name'],
})

const registeredOptions = () => {
  const credentialConfigurationRegistry = createCredentialConfigurationRegistry()
  const options: OpenId4VcPluginOptions = {
    publicApiBaseUrl: 'https://agent.example',
    credentialConfigurations: credentialConfigurationRegistry.configurations,
    credentialConfigurationRegistry,
  }

  return { options, registry: credentialConfigurationRegistry }
}

describe('createCredentialConfigurationRegistry', () => {
  it('starts empty and answers findCredentialConfiguration from the replaced set', () => {
    const { options, registry } = registeredOptions()
    expect(findCredentialConfiguration(options, 'employee')).toBeUndefined()

    registry.replace([configuration('employee')])

    expect(findCredentialConfiguration(options, 'employee')).toBe(registry.configurations[0])

    registry.replace([configuration('member')])

    expect(findCredentialConfiguration(options, 'employee')).toBeUndefined()
    expect(findCredentialConfiguration(options, 'member')).toBeDefined()
  })

  it('reaches the draft credential request middleware set up before the replace', async () => {
    const { options, registry } = registeredOptions()
    const setup = setupOpenId4Vc(options, () => {
      throw new Error('OpenID4VC issuer service is not initialized')
    })

    registry.replace([configuration('employee')])

    const app = express()
    app.use(setup.publicMiddleware)
    app.post('*', (incoming, response) => response.json(incoming.body))

    const response = await request(app)
      .post('/oid4vci/demo-did/credential')
      .send({ format: 'dc+sd-jwt', vct: 'https://issuer.example/vct/employee' })

    expect(response.body).toEqual({ credential_configuration_id: 'employee' })
  })

  it('rejects a duplicate id and names the offender', () => {
    const { registry } = registeredOptions()

    expect(() =>
      registry.replace([
        configuration('employee'),
        { ...configuration('employee'), vct: 'https://issuer.example/vct/other' },
      ]),
    ).toThrow('duplicate credential configuration id "employee"')
    expect(registry.configurations).toEqual([])
  })

  it('rejects a duplicate vct and names the offender', () => {
    const { registry } = registeredOptions()

    expect(() =>
      registry.replace([
        configuration('employee'),
        { ...configuration('member'), vct: 'https://issuer.example/vct/employee' },
      ]),
    ).toThrow('duplicate credential configuration vct "https://issuer.example/vct/employee"')
    expect(registry.configurations).toEqual([])
  })
})
