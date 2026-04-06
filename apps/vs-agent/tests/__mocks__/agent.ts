import { AskarSqliteStorageConfig } from '@credo-ts/askar'
import { LogLevel, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { createVsAgent, setupDidComm, VsAgent, DidCommAgentModules } from '@verana-labs/vs-agent-sdk'

import { keyDerivationMethodMap } from '../../src/config'
import { TsLogger } from '../../src/utils'

export const startAgent = async ({
  label,
  domain,
}: {
  label: string
  domain: string
}): Promise<VsAgent<DidCommAgentModules>> => {
  const walletConfig = getAskarStoreConfig(label, { inMemory: true })
  const agent = createVsAgent({
    plugins: [
      setupDidComm({ walletConfig, publicApiBaseUrl: `https://${domain}`, endpoints: [`rxjs:${domain}`] }),
    ],
    config: {
      logger: new TsLogger(LogLevel.off, label),
    },
    walletConfig,
    did: `did:webvh:${domain}`,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label,
  })
  return agent as unknown as VsAgent<DidCommAgentModules>
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
