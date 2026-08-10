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
// Verbatim copies of the published v4 ECS schemas, with $id pointing at the mocked URL.
export const jsonSchemaOrgMock = {
  $id: 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  description: 'Identifies a legal organization that operates one or more Verifiable Services.',
  properties: {
    credentialSubject: {
      properties: {
        address: {
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
        countryCode: {
          maxLength: 2,
          minLength: 2,
          pattern: '^[A-Z]{2}$',
          type: 'string',
        },
        id: {
          format: 'uri',
          maxLength: 2048,
          type: 'string',
        },
        legalJurisdiction: {
          maxLength: 64,
          minLength: 1,
          pattern: '^[A-Z]{2}(-[A-Z0-9]{1,3})?$',
          type: 'string',
        },
        lei: {
          pattern: '^[A-Z0-9]{20}$',
          type: 'string',
        },
        logoDigestSri: {
          maxLength: 256,
          type: 'string',
        },
        logoUri: {
          format: 'uri',
          maxLength: 4096,
          type: 'string',
        },
        name: {
          maxLength: 512,
          minLength: 1,
          type: 'string',
        },
        organizationKind: {
          maxLength: 64,
          minLength: 1,
          type: 'string',
        },
        registryId: {
          maxLength: 256,
          minLength: 1,
          type: 'string',
        },
        registryUri: {
          format: 'uri',
          maxLength: 4096,
          type: 'string',
        },
      },
      required: ['id', 'name', 'logoUri', 'logoDigestSri', 'registryId', 'address', 'countryCode'],
      type: 'object',
    },
  },
  title: 'OrganizationCredential',
  type: 'object',
}

export const jsonSchemaServiceMock = {
  $id: 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-service',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  description:
    'Identifies a Verifiable Service and defines the minimum trust and access requirements required to interact with it.',
  properties: {
    credentialSubject: {
      properties: {
        description: {
          maxLength: 4096,
          type: 'string',
        },
        descriptionFormat: {
          default: 'text/plain',
          enum: ['text/plain', 'text/markdown'],
          type: 'string',
        },
        id: {
          format: 'uri',
          maxLength: 2048,
          type: 'string',
        },
        logoDigestSri: {
          maxLength: 256,
          type: 'string',
        },
        logoUri: {
          format: 'uri',
          maxLength: 4096,
          type: 'string',
        },
        minimumAgeRequired: {
          maximum: 255,
          minimum: 0,
          type: 'integer',
        },
        name: {
          maxLength: 512,
          minLength: 1,
          type: 'string',
        },
        privacyPolicyDigestSri: {
          maxLength: 256,
          type: 'string',
        },
        privacyPolicyUri: {
          format: 'uri',
          maxLength: 4096,
          type: 'string',
        },
        termsAndConditionsDigestSri: {
          maxLength: 256,
          type: 'string',
        },
        termsAndConditionsUri: {
          format: 'uri',
          maxLength: 4096,
          type: 'string',
        },
        type: {
          maxLength: 128,
          minLength: 1,
          type: 'string',
        },
      },
      required: [
        'id',
        'name',
        'type',
        'description',
        'logoUri',
        'logoDigestSri',
        'minimumAgeRequired',
        'termsAndConditionsUri',
        'termsAndConditionsDigestSri',
        'privacyPolicyUri',
        'privacyPolicyDigestSri',
      ],
      type: 'object',
    },
  },
  title: 'ServiceCredential',
  type: 'object',
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
