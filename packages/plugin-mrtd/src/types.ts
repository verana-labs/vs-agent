import type { DidCommMrtdModule } from '@2060.io/credo-ts-didcomm-mrtd'
import type { BaseAgentModules } from '@verana-labs/vs-agent-sdk'

export type MrtdAgentModules = BaseAgentModules & {
  mrtd: DidCommMrtdModule
}
