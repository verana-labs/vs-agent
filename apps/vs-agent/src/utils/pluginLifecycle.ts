import type { BaseLogger } from '@credo-ts/core'
import type { BaseAgentModules, VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { Express } from 'express'

export const credoPluginsFromNestPlugins = (plugins: VsAgentNestPlugin[]) =>
  plugins.flatMap(plugin => (plugin.credoPlugin ? [plugin.credoPlugin] : []))

export const nestPluginContributions = (plugins: VsAgentNestPlugin[]) => ({
  imports: plugins.flatMap(plugin => plugin.imports ?? []),
  controllers: plugins.flatMap(plugin => plugin.controllers ?? []),
  providers: plugins.flatMap(plugin => plugin.providers ?? []),
  didcommModules: plugins.flatMap(plugin => plugin.didcommModules ?? []),
})

export const mountPublicPluginMiddleware = (
  app: Pick<Express, 'use'>,
  plugins: VsAgentNestPlugin[],
): void => {
  for (const plugin of plugins) {
    if (plugin.publicMiddleware) app.use(plugin.publicMiddleware)
  }
}

export const registerNestPluginEvents = (
  plugins: VsAgentNestPlugin[],
  agent: VsAgent<BaseAgentModules>,
  logger: BaseLogger,
): void => {
  for (const plugin of plugins) plugin.registerEvents?.(agent, logger)
}
