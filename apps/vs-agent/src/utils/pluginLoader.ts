import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { createRequire } from 'module'
import * as path from 'path'

/** What an external plugin package exports as `createVsAgentPlugin`. */
export type VsAgentPluginFactory = (env: NodeJS.ProcessEnv) => VsAgentNestPlugin | Promise<VsAgentNestPlugin>

export interface LoadPluginPackagesOptions {
  /** The directory the packages are installed in: the one that holds their `node_modules`. */
  pluginDirectory: string
  /** Handed to each factory. Default: the environment of the process. */
  env?: NodeJS.ProcessEnv
}

export interface LoadedPluginPackages {
  /** The plugins of the packages that loaded, in the order of their names. */
  plugins: VsAgentNestPlugin[]
  /** One message per package that did not load. */
  errors: string[]
}

/** `VS_AGENT_PLUGIN_DIR` when it is set, else the `plugins` directory of the app. */
export function pluginDirectoryOf(appDirectory: string, configured?: string): string {
  return configured ? path.resolve(configured) : path.join(appDirectory, 'plugins')
}

/**
 * Loads the external plugin packages named in `VS_AGENT_PLUGIN_PACKAGES`. A package exports
 * `createVsAgentPlugin(env)`, which returns a `VsAgentNestPlugin`: from there on it takes part in
 * the agent like a built-in plugin.
 *
 * A package that does not load is an error of configuration, reported and never skipped, so that
 * the agent does not start without a protocol its deployment asked for.
 */
export async function loadPluginPackages(
  packageNames: readonly string[],
  options: LoadPluginPackagesOptions,
): Promise<LoadedPluginPackages> {
  const { pluginDirectory, env = process.env } = options
  const plugins: VsAgentNestPlugin[] = []
  const errors: string[] = []

  for (const name of packageNames) {
    try {
      plugins.push(await loadPluginPackage(name, pluginDirectory, env))
    } catch (error) {
      // Node appends its require stack to the message, and the first line says it all
      const [reason] = (error instanceof Error ? error.message : String(error)).split('\n')
      errors.push(`VS_AGENT_PLUGIN_PACKAGES names ${name}, which cannot be loaded: ${reason}`)
    }
  }

  return { plugins, errors }
}

async function loadPluginPackage(
  name: string,
  pluginDirectory: string,
  env: NodeJS.ProcessEnv,
): Promise<VsAgentNestPlugin> {
  let entryPoint: string
  try {
    // Resolved as a module of the plugin directory would resolve it: its own node_modules first
    entryPoint = createRequire(path.join(pluginDirectory, 'package.json')).resolve(name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    throw new Error(
      `it is not installed in ${pluginDirectory}. Run \`npm install --omit=dev --legacy-peer-deps ${name}\` there`,
    )
  }

  const factory = pluginFactoryOf(await import(entryPoint))
  if (!factory) throw new Error('it does not export createVsAgentPlugin(env)')

  const plugin = await factory(env)
  if (typeof plugin?.name !== 'string' || !plugin.name)
    throw new Error('createVsAgentPlugin(env) did not return a plugin with a name')
  return plugin
}

// A CommonJS package imported from an ES module carries its exports under `default`
function pluginFactoryOf(exported: unknown): VsAgentPluginFactory | undefined {
  const module = exported as
    | { createVsAgentPlugin?: unknown; default?: { createVsAgentPlugin?: unknown } }
    | undefined
  const factory = module?.createVsAgentPlugin ?? module?.default?.createVsAgentPlugin
  return typeof factory === 'function' ? (factory as VsAgentPluginFactory) : undefined
}
