import { AskarSqliteStorageConfig } from '@credo-ts/askar'
import { LogLevel, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'

import { keyDerivationMethodMap } from '../../src/config'
import { createVsAgent, TsLogger } from '../../src/utils'

export const startAgent = async ({ label, domain }: { label: string; domain: string }) => {
  const agent = createVsAgent({
    config: {
      logger: new TsLogger(LogLevel.Off, label),
    },
    walletConfig: getAskarStoreConfig(label, { inMemory: true }),
    endpoints: [`rxjs:${domain}`],
    did: `did:webvh:${domain}`,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label,
  })
  return agent
}

export function getAskarStoreConfig(
  name: string,
  {
    inMemory = true,
    random = utils.uuid().slice(0, 4),
    maxConnections,
  }: { inMemory?: boolean; random?: string; maxConnections?: number } = {},
) {
  return {
    id: `Wallet: ${name} - ${random}`,
    key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
    keyDerivationMethod: keyDerivationMethodMap[KdfMethod.Raw],
    database: {
      type: 'sqlite',
      config: {
        inMemory,
        maxConnections,
      },
    } as AskarSqliteStorageConfig,
  }
}
