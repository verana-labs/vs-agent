import type { EcsClaims } from '@verana-labs/vs-agent-sdk'

export interface OpenId4VcServiceDisplay {
  name: string
  logoUri?: string
}

/** [VSA-VTI-CFG-ENV-OID] Display name and logo of both capabilities, from the ECS Service credential. */
export function serviceDisplay(
  agent: { ecsClaims?: EcsClaims },
  publicApiBaseUrl: string,
): OpenId4VcServiceDisplay {
  const service = agent.ecsClaims?.service
  return {
    name: service?.name ?? new URL(publicApiBaseUrl).host,
    ...(service?.logoUri ? { logoUri: service.logoUri } : {}),
  }
}
