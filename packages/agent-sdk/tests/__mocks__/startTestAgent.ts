import { AskarSqliteStorageConfig } from '@credo-ts/askar'
import { BaseLogger, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { VsAgentNestPlugin } from '@verana-labs/agent-sdk'
import { type VtFlowModuleConfigOptions } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { createVsAgent, setupBaseDidComm, VsAgent } from '@verana-labs/vs-agent-sdk'

import { keyDerivationMethodMap } from '../../src/types'

type StartTestAgentParams = {
  label: string
  domain: string
  vtFlowOptions?: VtFlowModuleConfigOptions

  inMemory?: boolean
  maxConnections?: number
  autoInitialize?: boolean
  nestPlugin?: VsAgentNestPlugin
  logger?: BaseLogger
}

export const startAgent = async ({
  label,
  domain,
  vtFlowOptions,
  inMemory = true,
  maxConnections,
  autoInitialize = true,
  logger,
}: StartTestAgentParams): Promise<VsAgent> => {
  const walletConfig = getAskarStoreConfig(label, {
    inMemory,
    maxConnections,
  })

  const agent = createVsAgent({
    plugins: [
      setupBaseDidComm({
        walletConfig,
        publicApiBaseUrl: `https://${domain}`,
        endpoints: [`rxjs:${domain}`],
        vtFlow: vtFlowOptions,
      }),
    ],
    config: { logger },
    walletConfig,
    did: `did:webvh:${domain}`,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label,
  }) as unknown as VsAgent<any>

  if (autoInitialize) {
    await agent.initialize()
  }

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
