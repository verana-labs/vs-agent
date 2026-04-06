import { Inject, Injectable } from '@nestjs/common'
import { DidCommAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

@Injectable()
export class VsAgentService {
  constructor(@Inject('VSAGENT') private agent: VsAgent<DidCommAgentModules>) {}

  async getAgent(): Promise<VsAgent<DidCommAgentModules>> {
    if (!this.agent.isInitialized) {
      await this.agent.initialize()
    }

    return this.agent
  }
}
