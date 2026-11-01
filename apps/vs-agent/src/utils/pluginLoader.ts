import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

export type PluginFactory = (env: NodeJS.ProcessEnv) => VsAgentNestPlugin | Promise<VsAgentNestPlugin>

export interface LoadPluginPackagesOptions {
  /** Imports a package by name; defaults to the dynamic `import()` of the running process */
  importer?: (name: string) => Promise<unknown>
  env?: NodeJS.ProcessEnv
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
  const importer = options.importer ?? ((name: string) => import(name))
  const env = options.env ?? process.env
  const plugins: VsAgentNestPlugin[] = []

  for (const name of packageNames) {
    let module: unknown
    try {
      module = await importer(name)
    } catch (error) {
      throw new Error(
        `VS_AGENT_PLUGIN_PACKAGES names ${name}, which cannot be imported: ${(error as Error).message}. Install it next to the agent (for example \`npm install --no-save ${name}\` in apps/vs-agent).`,
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
