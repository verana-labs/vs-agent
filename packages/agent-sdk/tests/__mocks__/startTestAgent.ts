import { AskarSqliteStorageConfig } from '@credo-ts/askar'
import { BaseLogger, DidResolver, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'
import { type VtFlowModuleConfigOptions } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { createVsAgent, VsAgent } from '../../src/agent'
import { VeranaChainService } from '../../src/blockchain'
import { setupBaseDidComm } from '../../src/plugins/setupBaseDidComm'
import { keyDerivationMethodMap, VsAgentNestPlugin } from '../../src/types'

type StartTestAgentParams = {
  label: string
  domain: string
  vtFlowOptions?: VtFlowModuleConfigOptions
  veranaChain?: VeranaChainService
  extraResolvers?: DidResolver[]

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
  veranaChain,
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
    veranaChain,
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
