import { describe, expect, it } from 'vitest'

import { loadPluginPackages } from '../src/utils/pluginLoader'

const plugin = (name: string) => ({ name, controllers: [] })

describe('VS_AGENT_PLUGIN_PACKAGES loader', () => {
  it('loads a package through its createVsAgentPlugin(env) factory, in order', async () => {
    const env = { AYNI_FLOW_SIDE: 'service' }
    const seen: string[] = []
    const importer = async (name: string) => ({
      createVsAgentPlugin: (received: NodeJS.ProcessEnv) => {
        seen.push(received.AYNI_FLOW_SIDE ?? '')
        return plugin(name)
      },
    })

    const plugins = await loadPluginPackages(['@ayni.org/vs-agent-plugin-ayni-flow', '@acme/other'], {
      importer,
      env,
    })

    expect(plugins.map(p => p.name)).toEqual(['@ayni.org/vs-agent-plugin-ayni-flow', '@acme/other'])
    expect(seen).toEqual(['service', 'service'])
  })

  it('accepts the factory as the default export too', async () => {
    const importer = async (name: string) => ({ default: () => plugin(name) })
    expect((await loadPluginPackages(['pkg'], { importer })).map(p => p.name)).toEqual(['pkg'])
  })

  it('loads nothing when no package is configured', async () => {
    expect(await loadPluginPackages([])).toEqual([])
  })

  it('fails on a package that cannot be imported, naming it', async () => {
    const importer = async () => {
      throw new Error('Cannot find module')
    }
    await expect(loadPluginPackages(['@acme/missing'], { importer })).rejects.toThrow(
      /@acme\/missing.*cannot be imported/,
    )
  })

  it('fails on a package without the factory, and on a factory that returns no plugin', async () => {
    await expect(loadPluginPackages(['@acme/bare'], { importer: async () => ({}) })).rejects.toThrow(
      /createVsAgentPlugin/,
    )
    await expect(
      loadPluginPackages(['@acme/empty'], { importer: async () => ({ createVsAgentPlugin: () => ({}) }) }),
    ).rejects.toThrow(/with a name/)
  })
})
