import { Inject, Injectable } from '@nestjs/common'
import { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

@Injectable()
export class VsAgentService {
  constructor(@Inject('VSAGENT') private agent: VsAgent<BaseAgentModules>) {}

  async getAgent(): Promise<VsAgent<BaseAgentModules>> {
    if (!this.agent.isInitialized) {
      await this.agent.initialize()
    }

    return this.agent
  }
}
