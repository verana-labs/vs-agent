import type { VtFlowModuleConfigOptions } from './VtFlowModuleConfig'

import { VtFlowModule } from './VtFlowModule'

/** Plugin shape for `createVsAgent({ plugins: [...] })`. */
export interface VtFlowSetup {
  modules: { vtFlow: VtFlowModule }
}

/** Compose the vt-flow module into the vs-agent plugin pipeline. */
export function setupVtFlow(options?: VtFlowModuleConfigOptions): VtFlowSetup {
  return { modules: { vtFlow: new VtFlowModule(options) } }
}
