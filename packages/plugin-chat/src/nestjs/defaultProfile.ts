import type { DidCommUserProfileData } from '@2060.io/credo-ts-didcomm-user-profile'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

export const DEFAULT_PROFILE = 'CHAT_DEFAULT_PROFILE'

export type DefaultProfile = (agent: VsAgent<BaseAgentModules>) => Promise<DidCommUserProfileData | undefined>
