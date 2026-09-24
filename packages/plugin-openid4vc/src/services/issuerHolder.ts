import type { OpenId4VcIssuerRequestMapper } from '../sdk/setupOpenId4Vc'

// `setupOpenId4Vc` builds the credo module and the well-known routes at plugin construction, long before
// Nest builds the issuer, and a class provider gives the plugin no handle on the instance Nest built.
let issuerService: OpenId4VcIssuerRequestMapper | undefined

export function publishIssuerService(service: OpenId4VcIssuerRequestMapper): void {
  issuerService = service
}

export function requireIssuerService(): OpenId4VcIssuerRequestMapper {
  if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
  return issuerService
}
