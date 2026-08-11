import { AskarModuleConfigStoreOptions, AskarSqliteStorageConfig } from '@credo-ts/askar'
import { LogLevel, utils } from '@credo-ts/core'
import { type DidCommVersion } from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { type VtFlowModuleConfigOptions } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { createVsAgent, setupBaseDidComm, VeranaIndexerService, VsAgent } from '@verana-labs/vs-agent-sdk'

import { TsLogger } from '../../src/utils'

export const startAgent = async ({
  label,
  domain,
  vtFlowOptions,
  didcommVersions,
  indexerBaseUrl = 'http://indexer.invalid',
}: {
  label: string
  domain: string
  vtFlowOptions?: VtFlowModuleConfigOptions
  didcommVersions?: DidCommVersion[]
  indexerBaseUrl?: string
}): Promise<VsAgent<any>> => {
  const walletConfig = getAskarStoreConfig(label, { inMemory: true })
  const logger = new TsLogger(LogLevel.Off, label)

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
        vtFlow: vtFlowOptions,
        didcommVersions,
      }),
      ...(chatSetup ? [chatSetup.setupChatProtocols()] : []),
      ...(mrtdSetup ? [mrtdSetup.setupMrtdProtocol()] : []),
    ],
    config: { logger },
    walletConfig,
    did: `did:webvh:${domain}`,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label,
    indexer: new VeranaIndexerService({ baseUrl: indexerBaseUrl, logger }),
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
): AskarModuleConfigStoreOptions {
  return {
    id: `Wallet: ${name} - ${random}`,
    key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
    keyDerivationMethod: 'raw',
    database: {
      type: 'sqlite',
      config: {
        inMemory,
        maxConnections,
      },
    } as AskarSqliteStorageConfig,
  }
}
