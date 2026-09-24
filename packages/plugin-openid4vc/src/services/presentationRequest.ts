import type { OpenId4VcCredentialConfiguration } from '../types'

const PRESENTATION_ALGORITHMS = ['ES256'] as const

export const OPENID4VC_QUERY_LANGUAGES = ['dcql', 'presentation_exchange'] as const

export type OpenId4VcQueryLanguage = (typeof OPENID4VC_QUERY_LANGUAGES)[number]

export function presentationQueryFor(
  configuration: OpenId4VcCredentialConfiguration,
  requestedClaims: string[],
  queryLanguage: OpenId4VcQueryLanguage,
) {
  if (queryLanguage === 'presentation_exchange') {
    return {
      // OpenID4VP v1 forbids Presentation Exchange, so this rail is minted on the last draft that still
      // admits it.
      version: 'v1.draft21' as const,
      presentationExchange: { definition: presentationDefinitionFor(configuration, requestedClaims) },
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
            claims: requestedClaims.map(name => ({ path: [name] })),
          },
        ],
      },
    },
  }
}

function escapeForFilterPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function presentationDefinitionFor(
  configuration: { id: string; vct: string },
  requestedClaims: string[],
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
          // 'preferred': holders that can't enforce 'required' refuse it; the verifier re-checks the claims.
          limit_disclosure: 'preferred' as const,
          fields: [
            {
              path: ['$.vct'],
              // pattern beside const: a filter engine matching only 'pattern' finds nothing on 'const' alone.
              filter: {
                type: 'string' as const,
                const: configuration.vct,
                pattern: escapeForFilterPattern(configuration.vct),
              },
            },
            ...requestedClaims.map(name => ({ path: [`$.${name}`] })),
          ],
        },
      },
    ],
  }
}
