import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { createRequire } from 'node:module'
import path from 'node:path'

export type PluginFactory = (env: NodeJS.ProcessEnv) => VsAgentNestPlugin | Promise<VsAgentNestPlugin>

export interface LoadPluginPackagesOptions {
  /** Imports a package by name; defaults to `importPluginPackage` */
  importer?: (name: string) => Promise<unknown>
  env?: NodeJS.ProcessEnv
}

/** Where external plugin packages are installed: `VS_AGENT_PLUGIN_DIR`, else `<cwd>/plugins`. */
export function pluginDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.VS_AGENT_PLUGIN_DIR ?? path.join(process.cwd(), 'plugins')
}

/**
 * Imports an external plugin package: from the plugin directory first (`<dir>/node_modules/<name>`, where the operator
 * installed it with `npm install --legacy-peer-deps`, so that its Credo and Nest peers resolve up the tree to the agent's own
 * copies), then from the agent's own dependencies.
 */
export async function importPluginPackage(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const dir = pluginDirectory(env)
  let resolved: string | undefined
  try {
    resolved = createRequire(path.join(dir, 'package.json')).resolve(name)
  } catch {
    resolved = undefined
  }
  return import(resolved ?? name)
}

/**
 * Loads the external plugin packages named in `VS_AGENT_PLUGIN_PACKAGES`. A package takes part in the agent like the
 * built-in plugins: it exports `createVsAgentPlugin(env)` (or that function as its default export) and returns a
 * `VsAgentNestPlugin` with its Credo modules, Nest controllers, message routing and event listeners. A package that
 * cannot be imported or does not export the factory is a configuration error: the agent must not start half-configured.
 */
export async function loadPluginPackages(
  packageNames: readonly string[],
  options: LoadPluginPackagesOptions = {},
): Promise<VsAgentNestPlugin[]> {
  const env = options.env ?? process.env
  const importer = options.importer ?? ((name: string) => importPluginPackage(name, env))
  const plugins: VsAgentNestPlugin[] = []

  for (const name of packageNames) {
    let module: unknown
    try {
      module = await importer(name)
    } catch (error) {
      throw new Error(
        `VS_AGENT_PLUGIN_PACKAGES names ${name}, which cannot be imported: ${(error as Error).message}. Install it in the plugin directory ${pluginDirectory(env)} (\`npm install --omit=dev --legacy-peer-deps ${name}\` there).`,
      )
    }
    const factory = pluginFactoryOf(module)
    if (!factory) {
      throw new Error(
        `VS_AGENT_PLUGIN_PACKAGES names ${name}, which does not export createVsAgentPlugin(env)`,
      )
    }
    const plugin = await factory(env)
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name) {
      throw new Error(`${name}: createVsAgentPlugin(env) did not return a plugin with a name`)
    }
    plugins.push(plugin)
  }

  return plugins
}

function pluginFactoryOf(module: unknown): PluginFactory | undefined {
  if (!module || typeof module !== 'object') return undefined
  const record = module as Record<string, unknown>
  if (typeof record.createVsAgentPlugin === 'function') return record.createVsAgentPlugin as PluginFactory
  const fallback = record.default as Record<string, unknown> | PluginFactory | undefined
  if (typeof fallback === 'function') return fallback
  if (fallback && typeof fallback.createVsAgentPlugin === 'function')
    return fallback.createVsAgentPlugin as PluginFactory
  return undefined
}
