import type { ChatAgentModules } from '../types'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { moduleNotServed } from '@verana-labs/vs-agent-sdk'

type ChatAgent = VsAgent<ChatAgentModules>

export function chatModuleApi<K extends keyof ChatAgent['modules']>(
  agent: VsAgent<BaseAgentModules>,
  key: K,
  module: string,
): ChatAgent['modules'][K] {
  const { modules } = agent as unknown as ChatAgent
  if (!(key in modules)) throw moduleNotServed(module)
  return modules[key]
}
