import { TypeMetadataFormatSchema } from '@sd-jwt/sd-jwt-vc'
import { describe, expect, it } from 'vitest'

import { composeTypeMetadata, typeMetadataUrl } from '../src/utils/typeMetadata'

const SCHEMA_REF = 'vpr:verana:vna-testnet-1:cs:144'
const JSC_ID = 'https://ecosystem.example/vt/schemas-144-jsc.json'
const VCT = typeMetadataUrl('https://ecosystem.example', 144)

const jsonSchema = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'EmployeeCredential',
    description: 'Proves employment',
    properties: {
      credentialSubject: { properties: { name: { type: 'string' }, since: { type: 'string' } } },
    },
    ...overrides,
  })

describe('typeMetadataUrl', () => {
  it('composes the fixed [VSA-PUB-VT-5] path from the base URL and the on-chain schema id', () => {
    expect(VCT).toBe('https://ecosystem.example/vt/vct/144')
  })
})

describe('composeTypeMetadata', () => {
  const build = (schema = jsonSchema()) =>
    composeTypeMetadata({
      vct: VCT,
      jsonSchema: schema,
      credentialSchemaRef: SCHEMA_REF,
      jsonSchemaCredentialId: JSC_ID,
    })

  it('carries vct, the schema title, its claims and the VTJSC id', () => {
    expect(JSON.parse(build())).toEqual({
      vct: VCT,
      name: 'EmployeeCredential',
      description: 'Proves employment',
      claims: [
        { path: ['name'], sd: 'always' },
        { path: ['since'], sd: 'always' },
      ],
      relatedJsonSchemaCredentialId: JSC_ID,
    })
  })

  it('names the type after the on-chain schema id when the schema carries no title', () => {
    const document = JSON.parse(build(jsonSchema({ title: undefined, description: undefined })))
    expect(document.name).toBe(SCHEMA_REF)
    expect(document).not.toHaveProperty('description')
  })

  it('validates as SD-JWT VC Type Metadata and keeps the extension property', () => {
    const parsed = TypeMetadataFormatSchema.parse(JSON.parse(build()))
    expect(parsed.vct).toBe(VCT)
    expect(parsed.claims?.map(claim => claim.path)).toEqual([['name'], ['since']])
    expect((parsed as Record<string, unknown>).relatedJsonSchemaCredentialId).toBe(JSC_ID)
  })
})
