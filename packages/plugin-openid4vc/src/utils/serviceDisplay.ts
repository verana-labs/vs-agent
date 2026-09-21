import type { EcsClaims } from '@verana-labs/vs-agent-sdk'

export interface OpenId4VcServiceDisplay {
  name: string
  logoUri?: string
}

export function serviceDisplay(agent: { ecsClaims?: EcsClaims }): OpenId4VcServiceDisplay | undefined {
  const service = agent.ecsClaims?.service
  if (!service?.name) return undefined

  return {
    name: service.name,
    ...(service.logoUri ? { logoUri: service.logoUri } : {}),
  }
}
