import type { DidCommMrtdModule } from '@credo-ts/didcomm-mrtd'
import type { BaseAgentModules } from '@verana-labs/vs-agent-sdk'

export type MrtdAgentModules = BaseAgentModules & {
  mrtd: DidCommMrtdModule
}
