import {
  createInvitation as sdkCreateInvitation,
  getWebDid,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { DidCommMessage } from '@credo-ts/didcomm'

import { AGENT_INVITATION_BASE_URL, AGENT_INVITATION_IMAGE_URL } from '../config/constants'
import { DidCommAgentModules } from '@verana-labs/vs-agent-sdk'

export { getWebDid }

/**
 * Creates an out of band invitation using app-level configuration.
 * Wraps the SDK createInvitation with constants from environment variables.
 */
export async function createInvitation(options: {
  agent: VsAgent<DidCommAgentModules>
  messages?: DidCommMessage[]
  useLegacyDid?: boolean
}) {
  return sdkCreateInvitation({
    ...options,
    invitationBaseUrl: AGENT_INVITATION_BASE_URL,
    imageUrl: AGENT_INVITATION_IMAGE_URL,
  })
}
