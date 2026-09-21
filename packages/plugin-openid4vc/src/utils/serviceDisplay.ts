import type { EcsClaims } from '@verana-labs/vs-agent-sdk'

export interface OpenId4VcServiceDisplay {
  name: string
  logoUri?: string
}

/** [VSA-VTI-CFG-ENV-OID] Display name and logo of both capabilities, from the ECS Service credential. */
export function serviceDisplay(agent: { ecsClaims?: EcsClaims }): OpenId4VcServiceDisplay | undefined {
  const service = agent.ecsClaims?.service
  if (!service?.name) return undefined

  return {
    name: service.name,
    ...(service.logoUri ? { logoUri: service.logoUri } : {}),
  }
}
