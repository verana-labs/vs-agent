import type { BaseLogger } from '@credo-ts/core'
import type { BaseAgentModules, VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { Express } from 'express'

export const credoPluginsFromNestPlugins = (plugins: VsAgentNestPlugin[]) =>
  plugins.flatMap(plugin => (plugin.credoPlugin ? [plugin.credoPlugin] : []))

export const mountPublicPluginMiddleware = (
  app: Pick<Express, 'use'>,
  plugins: VsAgentNestPlugin[],
): void => {
  for (const plugin of plugins) {
    if (plugin.publicMiddleware) app.use(plugin.publicMiddleware)
  }
}

export const initializeNestPlugins = async (
  plugins: VsAgentNestPlugin[],
  agent: VsAgent<BaseAgentModules>,
  logger: BaseLogger,
): Promise<void> => {
  for (const plugin of plugins) await plugin.initialize?.(agent, logger)
}
