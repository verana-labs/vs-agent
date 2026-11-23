import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadPluginPackages, pluginDirectoryOf } from '../src/utils/pluginLoader'

let pluginDirectory: string

// Installs a package as npm does: <plugin directory>/node_modules/<name>
function installPackage(name: string, source: string, manifest: Record<string, unknown> = {}): void {
  const directory = path.join(pluginDirectory, 'node_modules', name)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...manifest }),
  )
  fs.writeFileSync(path.join(directory, 'index.js'), source)
}

beforeAll(() => {
  pluginDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-agent-plugins-'))

  installPackage(
    '@acme/vs-agent-plugin-greeting',
    `exports.createVsAgentPlugin = env => ({ name: 'greeting', controllers: [], greeting: env.GREETING })`,
  )
  installPackage('vs-agent-plugin-esm', `export const createVsAgentPlugin = async () => ({ name: 'esm' })`, {
    type: 'module',
  })
  installPackage('plugin-that-throws', `throw new Error('native binding missing')`)
  installPackage('plugin-without-factory', `exports.somethingElse = () => ({ name: 'other' })`)
  installPackage('plugin-without-name', `exports.createVsAgentPlugin = () => ({ controllers: [] })`)
  installPackage(
    'plugin-that-refuses-its-configuration',
    `exports.createVsAgentPlugin = env => { throw new Error('GREETING is required') }`,
  )
})

afterAll(() => fs.rmSync(pluginDirectory, { recursive: true, force: true }))

describe('external plugin packages', () => {
  it('loads each package of the plugin directory through createVsAgentPlugin(env), in order', async () => {
    const { plugins, errors } = await loadPluginPackages(
      ['vs-agent-plugin-esm', '@acme/vs-agent-plugin-greeting'],
      { pluginDirectory, env: { GREETING: 'hello' } },
    )

    expect(errors).toEqual([])
    expect(plugins).toEqual([{ name: 'esm' }, { name: 'greeting', controllers: [], greeting: 'hello' }])
  })

  it('loads nothing when no package is configured', async () => {
    expect(await loadPluginPackages([], { pluginDirectory })).toEqual({ plugins: [], errors: [] })
  })

  it('reports a package that is not installed, with the directory and the command that installs it', async () => {
    const { plugins, errors } = await loadPluginPackages(['@acme/missing'], { pluginDirectory })

    expect(plugins).toEqual([])
    expect(errors).toEqual([
      `VS_AGENT_PLUGIN_PACKAGES names @acme/missing, which cannot be loaded: it is not installed in ${pluginDirectory}. ` +
        'Run `npm install --omit=dev --legacy-peer-deps @acme/missing` there',
    ])
  })

  it('reports a package that fails while it loads, with its reason', async () => {
    const { errors } = await loadPluginPackages(['plugin-that-throws'], { pluginDirectory })

    expect(errors).toEqual([
      'VS_AGENT_PLUGIN_PACKAGES names plugin-that-throws, which cannot be loaded: native binding missing',
    ])
  })

  it('reports a package without the factory, and a factory that returns no plugin', async () => {
    const { errors } = await loadPluginPackages(['plugin-without-factory', 'plugin-without-name'], {
      pluginDirectory,
    })

    expect(errors).toEqual([
      'VS_AGENT_PLUGIN_PACKAGES names plugin-without-factory, which cannot be loaded: it does not export createVsAgentPlugin(env)',
      'VS_AGENT_PLUGIN_PACKAGES names plugin-without-name, which cannot be loaded: createVsAgentPlugin(env) did not return a plugin with a name',
    ])
  })

  it('reports a factory that refuses its configuration', async () => {
    const { errors } = await loadPluginPackages(['plugin-that-refuses-its-configuration'], {
      pluginDirectory,
      env: {},
    })

    expect(errors).toEqual([
      'VS_AGENT_PLUGIN_PACKAGES names plugin-that-refuses-its-configuration, which cannot be loaded: GREETING is required',
    ])
  })

  it('reports every package that does not load and keeps the ones that do', async () => {
    const { plugins, errors } = await loadPluginPackages(
      ['@acme/missing', '@acme/vs-agent-plugin-greeting', 'plugin-that-throws'],
      { pluginDirectory, env: {} },
    )

    expect(plugins.map(plugin => plugin.name)).toEqual(['greeting'])
    expect(errors).toHaveLength(2)
  })
})

describe('plugin directory', () => {
  it('is the plugins directory of the app by default', () => {
    expect(pluginDirectoryOf('/www/apps/vs-agent')).toBe(path.join('/www/apps/vs-agent', 'plugins'))
    expect(pluginDirectoryOf('/www/apps/vs-agent', '')).toBe(path.join('/www/apps/vs-agent', 'plugins'))
  })

  it('is VS_AGENT_PLUGIN_DIR when it is set, resolved from the working directory', () => {
    expect(pluginDirectoryOf('/www/apps/vs-agent', '/www/plugins')).toBe(path.resolve('/www/plugins'))
    expect(pluginDirectoryOf('/www/apps/vs-agent', 'plugins')).toBe(path.resolve('plugins'))
  })
})
