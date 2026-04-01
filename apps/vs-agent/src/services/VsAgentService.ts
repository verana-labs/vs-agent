import { VsAgent } from '@verana-labs/vs-agent-sdk'
import { Inject, Injectable } from '@nestjs/common'

@Injectable()
export class VsAgentService {
  constructor(@Inject('VSAGENT') private agent: VsAgent<any>) {}

  async getAgent(): Promise<VsAgent<any>> {
    if (!this.agent.isInitialized) {
      await this.agent.initialize()
    }

    return this.agent
  }
}
