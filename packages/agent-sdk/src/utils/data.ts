// Verbatim copies of the published v4 Essential Credential Schemas
// https://verana-labs.github.io/verifiable-trust-spec/schemas/v4/
export function getEcsSchemas(publicApiBaseUrl: string): Record<string, string> {
  return {
    'ecs-org': `{
  "$id": "${publicApiBaseUrl}/vt/cs/v1/js/ecs-org",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Identifies a legal organization that operates one or more Verifiable Services.",
  "properties": {
    "credentialSubject": {
      "properties": {
        "address": {
          "maxLength": 1024,
          "minLength": 1,
          "type": "string"
        },
        "countryCode": {
          "maxLength": 2,
          "minLength": 2,
          "pattern": "^[A-Z]{2}$",
          "type": "string"
        },
        "id": {
          "format": "uri",
          "maxLength": 2048,
          "type": "string"
        },
        "legalJurisdiction": {
          "maxLength": 64,
          "minLength": 1,
          "pattern": "^[A-Z]{2}(-[A-Z0-9]{1,3})?$",
          "type": "string"
        },
        "lei": {
          "pattern": "^[A-Z0-9]{20}$",
          "type": "string"
        },
        "logoDigestSri": {
          "maxLength": 256,
          "type": "string"
        },
        "logoUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        },
        "name": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "organizationKind": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "registryId": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        },
        "registryUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        }
      },
      "required": [
        "id",
        "name",
        "logoUri",
        "logoDigestSri",
        "registryId",
        "address",
        "countryCode"
      ],
      "type": "object"
    }
  },
  "title": "OrganizationCredential",
  "type": "object"
}`,
    'ecs-persona': `{
  "$id": "${publicApiBaseUrl}/vt/cs/v1/js/ecs-persona",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Identifies a Persona (human-controlled avatar) that operates one or more Verifiable Services.",
  "properties": {
    "credentialSubject": {
      "dependentRequired": {
        "avatarUri": [
          "avatarDigestSri"
        ]
      },
      "properties": {
        "avatarDigestSri": {
          "maxLength": 256,
          "type": "string"
        },
        "avatarUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        },
        "controllerCountryCode": {
          "maxLength": 2,
          "minLength": 2,
          "pattern": "^[A-Z]{2}$",
          "type": "string"
        },
        "controllerJurisdiction": {
          "maxLength": 64,
          "minLength": 1,
          "pattern": "^[A-Z]{2}(-[A-Z0-9]{1,3})?$",
          "type": "string"
        },
        "description": {
          "maxLength": 16384,
          "minLength": 0,
          "type": "string"
        },
        "descriptionFormat": {
          "default": "text/plain",
          "enum": [
            "text/plain",
            "text/markdown"
          ],
          "type": "string"
        },
        "id": {
          "format": "uri",
          "maxLength": 2048,
          "type": "string"
        },
        "name": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "id",
        "name",
        "controllerCountryCode"
      ],
      "type": "object"
    }
  },
  "title": "PersonaCredential",
  "type": "object"
}`,
    'ecs-service': `{
  "$id": "${publicApiBaseUrl}/vt/cs/v1/js/ecs-service",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Identifies a Verifiable Service and defines the minimum trust and access requirements required to interact with it.",
  "properties": {
    "credentialSubject": {
      "properties": {
        "description": {
          "maxLength": 4096,
          "type": "string"
        },
        "descriptionFormat": {
          "default": "text/plain",
          "enum": [
            "text/plain",
            "text/markdown"
          ],
          "type": "string"
        },
        "id": {
          "format": "uri",
          "maxLength": 2048,
          "type": "string"
        },
        "logoDigestSri": {
          "maxLength": 256,
          "type": "string"
        },
        "logoUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        },
        "minimumAgeRequired": {
          "maximum": 255,
          "minimum": 0,
          "type": "integer"
        },
        "name": {
          "maxLength": 512,
          "minLength": 1,
          "type": "string"
        },
        "privacyPolicyDigestSri": {
          "maxLength": 256,
          "type": "string"
        },
        "privacyPolicyUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        },
        "termsAndConditionsDigestSri": {
          "maxLength": 256,
          "type": "string"
        },
        "termsAndConditionsUri": {
          "format": "uri",
          "maxLength": 4096,
          "type": "string"
        },
        "type": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "id",
        "name",
        "type",
        "description",
        "logoUri",
        "logoDigestSri",
        "minimumAgeRequired",
        "termsAndConditionsUri",
        "termsAndConditionsDigestSri",
        "privacyPolicyUri",
        "privacyPolicyDigestSri"
      ],
      "type": "object"
    }
  },
  "title": "ServiceCredential",
  "type": "object"
}`,
    'ecs-user-agent': `{
  "$id": "${publicApiBaseUrl}/vt/cs/v1/js/ecs-user-agent",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Identifies a User Agent instance and the software version it runs. The issuer identifies the software product line.",
  "properties": {
    "credentialSubject": {
      "properties": {
        "build": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "version": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "version"
      ],
      "type": "object"
    }
  },
  "title": "UserAgentCredential",
  "type": "object"
}`,
  }
}
