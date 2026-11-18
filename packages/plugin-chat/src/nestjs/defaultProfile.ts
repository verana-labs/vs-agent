import type { DidCommUserProfileData } from '@credo-ts/didcomm-user-profile'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

export const DEFAULT_PROFILE = 'CHAT_DEFAULT_PROFILE'

export type DefaultProfile = (agent: VsAgent<BaseAgentModules>) => Promise<DidCommUserProfileData | undefined>
