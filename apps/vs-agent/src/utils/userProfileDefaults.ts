import type { DidCommUserProfileData } from '@2060.io/credo-ts-didcomm-user-profile'

import { ECS } from '@verana-labs/vs-agent-model'
import { linkedVpFragment, VsAgent } from '@verana-labs/vs-agent-sdk'

interface VtcEntry {
  credential?: { credentialSubject?: Record<string, unknown> }
  didDocumentServiceId?: string
}

// Read at call time, not at startup: the credential is published asynchronously after boot
export async function ecsServiceProfile(agent: VsAgent): Promise<DidCommUserProfileData | undefined> {
  if (!agent.did) return undefined

  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const metadata = didRecord?.metadata.get('_vt/vtc') as Record<string, VtcEntry> | undefined
  if (!metadata) return undefined

  const serviceId = `${agent.did}#${linkedVpFragment(ECS.SERVICE)}`
  const claims = Object.values(metadata).find(entry => entry.didDocumentServiceId === serviceId)?.credential
    ?.credentialSubject as { name?: string; description?: string; logoUri?: string } | undefined
  if (!claims) return undefined

  const profile: DidCommUserProfileData = {
    ...(claims.name ? { displayName: claims.name } : {}),
    ...(claims.description ? { description: claims.description } : {}),
    ...(claims.logoUri ? { displayPicture: { links: [claims.logoUri] } } : {}),
  }

  return Object.keys(profile).length > 0 ? profile : undefined
}
