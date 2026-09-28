import { describe, expect, it, vi } from 'vitest'

import {
  credoPluginsFromNestPlugins,
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
          didcommModules: [didcommModule],
        },
        { name: 'empty' },
      ]),
    ).toEqual({
      imports: [imported],
      controllers: [ExampleController],
      providers: [provider],
      didcommModules: [didcommModule],
    })
  })
})
