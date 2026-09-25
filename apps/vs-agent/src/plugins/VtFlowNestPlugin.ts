import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { V2VtFlowsController, VtFlowsService } from '../controllers/admin/v2/vt'

export const VtFlowNestPlugin: VsAgentNestPlugin = {
  name: 'vt-flow',
  controllers: [V2VtFlowsController],
  providers: [VtFlowsService],
}
