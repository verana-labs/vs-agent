import { AskarSqliteStorageConfig } from '@credo-ts/askar'
import { LogLevel, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { createVsAgent, setupBaseDidComm, VsAgent } from '@verana-labs/vs-agent-sdk'

import { keyDerivationMethodMap } from '../../src/config'
import { TsLogger } from '../../src/utils'

export const startAgent = async ({
  label,
  domain,
}: {
  label: string
  domain: string
}): Promise<VsAgent<any>> => {
  const walletConfig = getAskarStoreConfig(label, { inMemory: true })

  const [chatSetup, mrtdSetup] = await Promise.all([
    import('@verana-labs/vs-agent-plugin-chat').catch(() => null),
    import('@verana-labs/vs-agent-plugin-mrtd').catch(() => null),
  ])

  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({
        walletConfig,
        publicApiBaseUrl: `https://${domain}`,
        endpoints: [`rxjs:${domain}`],
      }),
      ...(chatSetup ? [chatSetup.setupChatProtocols()] : []),
      ...(mrtdSetup ? [mrtdSetup.setupMrtdProtocol()] : []),
    ],
    config: {
      logger: new TsLogger(LogLevel.Off, label),
    },
    walletConfig,
    did: `did:webvh:${domain}`,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label,
  })
  return agent as unknown as VsAgent<any>
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
