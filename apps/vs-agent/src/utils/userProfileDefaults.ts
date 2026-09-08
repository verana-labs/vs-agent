import type { BaseLogger } from '@credo-ts/core'

import { DidCommUserProfileService } from '@2060.io/credo-ts-didcomm-user-profile'
import { ECS } from '@verana-labs/vs-agent-model'
import { linkedVpFragment, VsAgent } from '@verana-labs/vs-agent-sdk'

interface VtcEntry {
  credential?: { credentialSubject?: Record<string, unknown> }
  didDocumentServiceId?: string
}

export async function applyEcsServiceProfile(agent: VsAgent, logger: BaseLogger): Promise<void> {
  if (!agent.did) return
  const { dependencyManager } = agent.context
  if (!dependencyManager.isRegistered(DidCommUserProfileService)) return

  const claims = await ecsServiceClaims(agent)
  if (!claims) return

  const { name, description, logoUri } = claims as {
    name?: string
    description?: string
    logoUri?: string
  }

  await dependencyManager.resolve(DidCommUserProfileService).updateUserProfile(agent.context, {
    ...(name ? { displayName: name } : {}),
    ...(description ? { description } : {}),
    ...(logoUri ? { displayPicture: { links: [logoUri] } } : {}),
  })
  logger.info('[UserProfile] default profile taken from the ECS-Service credential')
}

async function ecsServiceClaims(agent: VsAgent): Promise<Record<string, unknown> | undefined> {
  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const metadata = didRecord?.metadata.get('_vt/vtc') as Record<string, VtcEntry> | undefined
  if (!metadata) return undefined

  const serviceId = `${agent.did}#${linkedVpFragment(ECS.SERVICE)}`
  return Object.values(metadata).find(entry => entry.didDocumentServiceId === serviceId)?.credential
    ?.credentialSubject
}
