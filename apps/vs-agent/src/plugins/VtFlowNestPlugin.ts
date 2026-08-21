import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { V1VtFlowsController } from '../controllers/admin/vt-flow/V1VtFlowsController'
import { VtFlowsService } from '../controllers/admin/vt-flow/VtFlowsService'

export const VtFlowNestPlugin: VsAgentNestPlugin = {
  name: 'vt-flow',
  controllers: [V1VtFlowsController],
  providers: [VtFlowsService],
}
