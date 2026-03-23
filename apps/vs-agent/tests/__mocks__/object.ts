export const actionMenu = {
  title: 'Menu',
  description: 'Please choose an option from the menu below:',
  options: [
    {
      id: 'option_1',
      title: 'Option 1',
      description: 'This is the first option',
    },
  ],
}

// Mock Fetch
export const jsonSchemaCredentialMock = JSON.parse(
  '{"@context":["https://www.w3.org/2018/credentials/v1","https://www.w3.org/2018/credentials/examples/v1"],"id":"https://dm.chatbot.demos.dev.2060.io/vt/schemas-example-org-jsc.json","type":["VerifiableCredential","JsonSchemaCredential"],"issuer":"did:webvh:QmZq5CvJVgNk6k2gzze6A7z7PNrpYdpPxjeWD6rFxjfdzY:dm.chatbot.demos.dev.2060.io","issuanceDate":"2025-11-05T20:52:22.688Z","expirationDate":"2035-11-03T20:52:22.688Z","credentialSubject":{"type":"JsonSchema","jsonSchema":{"$ref":"https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org"},"digestSRI":"sha256-ttE9qtGhU8GrPI33/6Y0sc0AT5XEaBLo0O4z9AMeTBM=","id":"https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org"},"credentialSchema":{"id":"https://www.w3.org/ns/credentials/json-schema/v2.json","type":"JsonSchema","digestSRI":"sha256-qm/TCo3y3vnDW3lvcF42wTannkJbyU+uUxWHyl23NKM="},"proof":{"verificationMethod":"did:webvh:QmZq5CvJVgNk6k2gzze6A7z7PNrpYdpPxjeWD6rFxjfdzY:dm.chatbot.demos.dev.2060.io#z6MkukriSiZbUxTaiPMPQz6Lu6vEL6vB9vjwfRi4gjFLCx18","type":"Ed25519Signature2020","created":"2025-11-05T20:52:22Z","proofPurpose":"assertionMethod","proofValue":"zDAvpiww2mMp9XaUcWqpmjwEAds3KqauKE3oMVMnZfSWMfYb5vUwon8FfM4twZ6x5Hvcbga7U56HkHzp14GX46J4"}}',
)
export const jsonSchemaOrgMock = {
  $id: 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'OrganizationCredential',
  description: 'OrganizationCredential using JsonSchema',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uri' },
        name: { type: 'string', minLength: 0, maxLength: 256 },
        logo: { type: 'string', contentEncoding: 'base64', contentMediaType: 'image/png' },
        registryId: { type: 'string', minLength: 0, maxLength: 256 },
        registryUrl: { type: 'string', minLength: 0, maxLength: 256 },
        address: { type: 'string', minLength: 0, maxLength: 1024 },
        type: { type: 'string', enum: ['PUBLIC', 'PRIVATE', 'FOUNDATION'] },
        countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      },
      required: ['id', 'name', 'logo', 'registryId', 'registryUrl', 'address', 'type', 'countryCode'],
    },
  },
}

export const jsonSchemaServiceMock = {
  $id: 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-service',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ServiceCredential',
  description: 'ServiceCredential using JsonSchema',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uri' },
        name: { type: 'string', minLength: 0, maxLength: 512 },
      },
    },
  },
}

export const jsonSchemaV2Mock = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
}

export const mockResponses: { [key: string]: any } = {
  'https://example.org/vt/schemas-example-org-jsc.json': jsonSchemaCredentialMock,
  'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org': jsonSchemaOrgMock,
  'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-service': jsonSchemaServiceMock,
  'https://www.w3.org/ns/credentials/json-schema/v2.json': jsonSchemaV2Mock,
}
