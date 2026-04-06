import { Inject, Injectable } from '@nestjs/common'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

@Injectable()
export class VsAgentService {
  constructor(@Inject('VSAGENT') private agent: VsAgent) {}

  async getAgent(): Promise<VsAgent> {
    if (!this.agent.isInitialized) {
      await this.agent.initialize()
    }

    return this.agent
  }
}
