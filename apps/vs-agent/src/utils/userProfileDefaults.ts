import { ecsServiceClaims, VsAgent } from '@verana-labs/vs-agent-sdk'

export interface EcsServiceProfile {
  displayName?: string
  description?: string
  displayPicture?: { links: string[] }
}

export async function ecsServiceProfile(agent: VsAgent): Promise<EcsServiceProfile | undefined> {
  const claims = await ecsServiceClaims(agent)
  if (!claims) return undefined

  const profile: EcsServiceProfile = {
    ...(claims.name ? { displayName: claims.name } : {}),
    ...(claims.description ? { description: claims.description } : {}),
    ...(claims.logoUri ? { displayPicture: { links: [claims.logoUri] } } : {}),
  }

  return Object.keys(profile).length > 0 ? profile : undefined
}
