import '@openwallet-foundation/askar-nodejs'

import type { AskarModuleConfigStoreOptions } from '@credo-ts/askar'

import { JwkDidResolver } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { setupBaseDidComm } from '../src/plugins/setupBaseDidComm'

const walletConfig: AskarModuleConfigStoreOptions = {
  id: 'base-didcomm-resolvers-test',
  key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
  keyDerivationMethod: 'raw',
  database: { type: 'sqlite', config: { inMemory: true } },
}

describe('setupBaseDidComm resolvers', () => {
  it('resolves did:jwk, which an OpenID4VCI holder binds its proof with', () => {
    const { modules } = setupBaseDidComm({
      walletConfig,
      publicApiBaseUrl: 'https://agent.example',
      endpoints: ['rxjs:agent.example'],
    })

    expect(modules.dids.config.resolvers.some(resolver => resolver instanceof JwkDidResolver)).toBe(true)
  })
})
