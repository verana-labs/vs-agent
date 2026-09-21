import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcVerifierPolicy,
} from '../types'
import type { OpenId4VpVerifiedAuthorizationResponse } from '@credo-ts/openid4vc'

import { findCredentialConfiguration } from '../config'
import { isRecord } from '../utils/isRecord'

const PRESENTATION_ALGORITHMS = ['ES256'] as const

export type OpenId4VcQueryLanguage = 'dcql' | 'presentation_exchange'

type PolicyOptions = Pick<OpenId4VcPluginOptions, 'credentialConfigurations' | 'verifierPolicies'>

type DcqlCredentials = NonNullable<OpenId4VpVerifiedAuthorizationResponse['dcql']>['query']['credentials']

export function presentationQueryFor(
  configuration: OpenId4VcCredentialConfiguration,
  policy: OpenId4VcVerifierPolicy,
  queryLanguage: OpenId4VcQueryLanguage,
) {
  if (queryLanguage === 'presentation_exchange') {
    return {
      // OpenID4VP v1 forbids Presentation Exchange, so this rail is minted on the last draft that still admits it.
      version: 'v1.draft21' as const,
      presentationExchange: { definition: presentationDefinitionFor(configuration, policy) },
    }
  }
  return {
    dcql: {
      query: {
        credentials: [
          {
            id: configuration.id,
            format: 'dc+sd-jwt' as const,
            meta: { vct_values: [configuration.vct] },
            claims: policy.requestedClaims.map(name => ({ path: [name] })),
          },
        ],
      },
    },
  }
}

export function matchVerifierPolicy(
  options: PolicyOptions,
  verified: OpenId4VpVerifiedAuthorizationResponse,
): OpenId4VcVerifierPolicy | undefined {
  if (verified.presentationExchange) {
    return matchPresentationExchangePolicy(options, verified.presentationExchange.definition)
  }
  return matchDcqlPolicy(options, verified.dcql?.query.credentials)
}

function matchDcqlPolicy(
  options: PolicyOptions,
  credentials: DcqlCredentials | undefined,
): OpenId4VcVerifierPolicy | undefined {
  if (!credentials || credentials.length !== 1) return undefined

  const query = credentials[0]
  if (query.format !== 'dc+sd-jwt') return undefined

  const configuration = findCredentialConfiguration(options, query.id)
  if (!configuration) return undefined
  if (query.meta?.vct_values?.length !== 1 || query.meta.vct_values[0] !== configuration.vct) {
    return undefined
  }

  const requestedClaims = query.claims?.map(claim => {
    const path = claim.path
    return path.length === 1 && typeof path[0] === 'string' ? path[0] : undefined
  })
  if (!requestedClaims || requestedClaims.some(claim => claim === undefined)) return undefined

  const policy = options.verifierPolicies.find(
    candidate =>
      candidate.credentialConfigurationId === configuration.id &&
      equalStrings(candidate.requestedClaims, requestedClaims),
  )
  return policy
}

function matchPresentationExchangePolicy(
  options: PolicyOptions,
  definition: unknown,
): OpenId4VcVerifierPolicy | undefined {
  if (!isRecord(definition) || !Array.isArray(definition.input_descriptors)) return undefined
  if (definition.input_descriptors.length !== 1) return undefined

  const descriptor: unknown = definition.input_descriptors[0]
  if (!isRecord(descriptor) || typeof descriptor.id !== 'string') return undefined

  const configuration = findCredentialConfiguration(options, descriptor.id)
  if (!configuration) return undefined

  if (!isRecord(descriptor.constraints) || !Array.isArray(descriptor.constraints.fields)) return undefined

  let vctMatched = false
  const requestedClaims: string[] = []
  for (const field of descriptor.constraints.fields) {
    if (!isRecord(field) || !Array.isArray(field.path) || field.path.length !== 1) return undefined
    const path = field.path[0]
    if (typeof path !== 'string' || !path.startsWith('$.')) return undefined
    const name = path.slice(2)

    if (name === 'vct') {
      const filter = field.filter
      if (!isRecord(filter) || filter.const !== configuration.vct) return undefined
      vctMatched = true
      continue
    }
    requestedClaims.push(name)
  }
  if (!vctMatched) return undefined

  const policy = options.verifierPolicies.find(
    candidate =>
      candidate.credentialConfigurationId === configuration.id &&
      equalStrings(candidate.requestedClaims, requestedClaims),
  )
  return policy
}

function escapeForFilterPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function presentationDefinitionFor(
  configuration: { id: string; vct: string },
  policy: { requestedClaims: string[] },
) {
  return {
    id: `${configuration.id}-presentation-exchange`,
    format: {
      // vc+sd-jwt: Presentation Exchange has no dc+sd-jwt format key.
      'vc+sd-jwt': {
        'sd-jwt_alg_values': [...PRESENTATION_ALGORITHMS],
        'kb-jwt_alg_values': [...PRESENTATION_ALGORITHMS],
      },
    },
    input_descriptors: [
      {
        id: configuration.id,
        constraints: {
          // 'preferred', not 'required': MOSIP rejects any other value; the verifier fails closed regardless.
          limit_disclosure: 'preferred' as const,
          fields: [
            {
              path: ['$.vct'],
              // pattern beside const: MOSIP requires filter.pattern, not const alone.
              filter: {
                type: 'string' as const,
                const: configuration.vct,
                pattern: escapeForFilterPattern(configuration.vct),
              },
            },
            ...policy.requestedClaims.map(name => ({ path: [`$.${name}`] })),
          ],
        },
      },
    ],
  }
}

function equalStrings(left: string[], right: Array<string | undefined>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
