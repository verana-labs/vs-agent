import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { AgentDependencies, InitConfig, LogLevel } from '@credo-ts/core'

import { BaseDidCommPlugin } from '../plugins/setupBaseDidComm'
import { ChatPlugin } from '../plugins/setupChatProtocols'
import { DidCommPlugin } from '../plugins/setupDidComm'
import { MrtdPlugin } from '../plugins/setupMrtdProtocol'

import { VsAgent } from './VsAgent'
import { BaseAgentModules } from './types'

export type Plugin = BaseDidCommPlugin | ChatPlugin | MrtdPlugin | DidCommPlugin

type MergePluginModules<T extends Plugin[]> = T extends [infer First, ...infer Rest]
  ? First extends { modules: infer M }
    ? Rest extends Plugin[]
      ? M & MergePluginModules<Rest>
      : M
    : never
  : object

type PluginModules<T extends Plugin[]> = MergePluginModules<T> & BaseAgentModules

export interface CreateVsAgentOptions<T extends Plugin[]> {
  plugins: T
  config?: Partial<InitConfig>
  walletConfig?: AskarModuleConfigStoreOptions
  endpoints?: string[]
  did?: string
  label: string
  publicApiBaseUrl: string
  displayPictureUrl?: string
  autoDiscloseUserProfile?: boolean
  masterListCscaLocation?: string
  autoUpdateStorageOnStartup?: boolean
  dependencies: AgentDependencies
  logLevel?: LogLevel
}

/**
 * Creates a VsAgent from a set of composable plugins.
 *
 * @example
 * // Signer-only agent (no DIDComm)
 * const agent = createVsAgent({
 *   plugins: [setupDidComm({ walletConfig, publicApiBaseUrl. endpoints })],
 *   label: 'My Agent',
 *   publicApiBaseUrl,
 *   dependencies: agentDependencies,
 * })
 *
 * @example
 * // Full DIDComm agent
 * const agent = createVsAgent({
 *   plugins: [
 *     setupDidComm({ walletConfig, publicApiBaseUrl. endpoints }),
 *   ],
 *   label: 'My Agent',
 *   publicApiBaseUrl,
 *   dependencies: agentDependencies,
 * })
 */
export function createVsAgent<T extends Plugin[]>(
  options: CreateVsAgentOptions<T>,
): VsAgent<PluginModules<T>> {
  const mergedModules = options.plugins.reduce(
    (acc, plugin) => ({ ...acc, ...plugin.modules }),
    {} as Record<string, unknown>,
  ) as PluginModules<T>

  return new VsAgent<PluginModules<T>>({
    config: {
      ...options.config,
      autoUpdateStorageOnStartup: options.autoUpdateStorageOnStartup,
    },
    modules: mergedModules,
    dependencies: options.dependencies,
    did: options.did,
    autoDiscloseUserProfile: options.autoDiscloseUserProfile,
    publicApiBaseUrl: options.publicApiBaseUrl,
    displayPictureUrl: options.displayPictureUrl,
    label: options.label,
  })
}
