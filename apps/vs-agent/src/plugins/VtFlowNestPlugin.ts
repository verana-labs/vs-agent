import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { TrustService } from '../controllers/admin/verifiable/TrustService'
import { VtFlowOnboardingController, VtFlowOnboardingService } from '../controllers/admin/vt-flow'
import { VsAgentService } from '../services/VsAgentService'

/**
 * NestJS wiring for the vt-flow admin surface. The Credo module itself is
 * registered via `setupVtFlow()` in `setupAgent.ts`. The onCompleted
 * auto-link listener is subscribed from `main.ts` where the Nest DI
 * container is available to resolve `TrustService`.
 */
export const VtFlowNestPlugin: VsAgentNestPlugin = {
  name: 'vt-flow',
  controllers: [VtFlowOnboardingController],
  providers: [VtFlowOnboardingService, VsAgentService, TrustService],
  registerEvents: (agent, config) => {
    void agent
    void config
  },
}
