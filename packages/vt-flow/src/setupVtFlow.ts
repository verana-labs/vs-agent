import type { VtFlowModuleConfigOptions } from './VtFlowModuleConfig'

import { VtFlowModule } from './VtFlowModule'

/** Plugin shape consumed by `createVsAgent({ plugins: [...] })` to compose the vt-flow module. */
export interface VtFlowSetup {
  modules: { vtFlow: VtFlowModule }
}

export function setupVtFlow(options?: VtFlowModuleConfigOptions): VtFlowSetup {
  return { modules: { vtFlow: new VtFlowModule(options) } }
}
