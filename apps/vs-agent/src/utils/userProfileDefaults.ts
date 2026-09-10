import type { DidCommUserProfileData } from '@2060.io/credo-ts-didcomm-user-profile'

import { ecsServiceClaims, VsAgent } from '@verana-labs/vs-agent-sdk'

export async function ecsServiceProfile(agent: VsAgent): Promise<DidCommUserProfileData | undefined> {
  const claims = await ecsServiceClaims(agent)
  if (!claims) return undefined

  const profile: DidCommUserProfileData = {
    ...(claims.name ? { displayName: claims.name } : {}),
    ...(claims.description ? { description: claims.description } : {}),
    ...(claims.logoUri ? { displayPicture: { links: [claims.logoUri] } } : {}),
  }

  return Object.keys(profile).length > 0 ? profile : undefined
}
