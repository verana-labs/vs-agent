import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { describe, expect, it, vi } from 'vitest'

import {
  credoPluginsFromNestPlugins,
  initializeNestPlugins,
  mountPublicPluginMiddleware,
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
})
