import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { VtFlowsController } from '../controllers/admin/vt-flow/VtFlowsController'
import { VtFlowsService } from '../controllers/admin/vt-flow/VtFlowsService'

export const VtFlowNestPlugin: VsAgentNestPlugin = {
  name: 'vt-flow',
  controllers: [VtFlowsController],
  providers: [VtFlowsService],
}
