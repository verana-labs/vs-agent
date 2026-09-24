import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { describe, expect, it, vi } from 'vitest'

import {
  credoPluginsFromNestPlugins,
  initializeNestPlugins,
  mountPublicPluginMiddleware,
  nestPluginContributions,
  registerNestPluginEvents,
} from '../src/utils/pluginLifecycle'

describe('plugin lifecycle', () => {
  it('uses each Credo plugin exactly once', () => {
    const credoPlugin = { modules: { example: {} } }
    expect(credoPluginsFromNestPlugins([{ name: 'example', credoPlugin }])).toEqual([credoPlugin])
  })

  it('mounts only declared public middleware', () => {
    const use = vi.fn()
    const middleware = vi.fn()
    mountPublicPluginMiddleware({ use }, [
      { name: 'public', publicMiddleware: middleware },
      { name: 'admin-only' },
    ])
    expect(use).toHaveBeenCalledOnce()
    expect(use).toHaveBeenCalledWith(middleware)
  })

  it('awaits initialization and propagates failure', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('invalid certificate'))
    const plugins: VsAgentNestPlugin[] = [{ name: 'broken', initialize }]
    await expect(initializeNestPlugins(plugins, {} as never, {} as never)).rejects.toThrow(
      'invalid certificate',
    )
  })

  it('registers the events of every plugin that declares them', () => {
    const agent = {} as never
    const logger = {} as never
    const registerEvents = vi.fn()
    registerNestPluginEvents([{ name: 'events', registerEvents }, { name: 'silent' }], agent, logger)
    expect(registerEvents).toHaveBeenCalledOnce()
    expect(registerEvents).toHaveBeenCalledWith(agent, logger)
  })

  it('collects the Nest contributions of every plugin and defaults the absent ones', () => {
    class ExampleController {}
    class ExampleHandler {}
    const provider = { provide: 'EXAMPLE', useValue: 1 }
    const didcommModule = { module: 'example', prefixes: ['https://example.org/'] }
    const imported = class ExampleModule {}

    expect(
      nestPluginContributions([
        {
          name: 'full',
          imports: [imported],
          controllers: [ExampleController],
          providers: [provider],
          messageHandlers: [ExampleHandler as never],
          didcommModules: [didcommModule],
        },
        { name: 'empty' },
      ]),
    ).toEqual({
      imports: [imported],
      controllers: [ExampleController],
      providers: [provider],
      messageHandlers: [ExampleHandler],
      didcommModules: [didcommModule],
    })
  })
})
