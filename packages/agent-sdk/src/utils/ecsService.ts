import type { VsAgent } from '../agent/VsAgent'

import { ECS } from '@verana-labs/vs-agent-model'

import { linkedVpFragment } from './setupSelfTr'

export interface EcsServiceClaims {
  name?: string
  description?: string
  logoUri?: string
}

interface VtcEntry {
  credential?: { credentialSubject?: Record<string, unknown> }
  didDocumentServiceId?: string
}

// Read at call time, not at startup: the credential is published asynchronously after boot
export async function ecsServiceClaims(agent: VsAgent): Promise<EcsServiceClaims | undefined> {
  if (!agent.did) return undefined

  const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const metadata = didRecord?.metadata.get('_vt/vtc') as Record<string, VtcEntry> | undefined
  if (!metadata) return undefined

  const serviceId = `${agent.did}#${linkedVpFragment(ECS.SERVICE)}`
  return Object.values(metadata).find(entry => entry.didDocumentServiceId === serviceId)?.credential
    ?.credentialSubject as EcsServiceClaims | undefined
}

export async function agentDisplayName(agent: VsAgent): Promise<string> {
  return (await ecsServiceClaims(agent))?.name ?? new URL(agent.publicApiBaseUrl).host
}
