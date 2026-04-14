import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate'
import { connectComet } from '@cosmjs/tendermint-rpc'

interface TrQueryClient {
  ListTrustRegistries(req: object): Promise<{ trustRegistry?: unknown[] }>
}
interface TrQueryClientImpl {
  new (rpc: { request(service: string, method: string, data: Uint8Array): Promise<Uint8Array> }): TrQueryClient
}

// Use require to bypass tsconfig paths mapping (which intercepts all @verana-labs/* to local packages)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { QueryClientImpl } = require('@verana-labs/verana-types/codec/verana/tr/v1/query.js') as { QueryClientImpl: TrQueryClientImpl }

import { VsAgent } from './VsAgent'
import { TsLogger } from './logger'

const VERANA_BECH32_PREFIX = 'verana'
const MNEMONIC_RECORD_TAG = 'verana-operator-mnemonic'

/**
 * Resolves the Verana operator mnemonic.
 * - If AGENT_VERANA_MNEMONIC env var is set, it is used directly.
 * - Otherwise, looks for a previously generated mnemonic stored in the agent wallet.
 * - If none exists, generates a new one, persists it, and logs the derived address so it can be funded.
 */
const logOperatorAddress = async (mnemonic: string, logger: TsLogger): Promise<void> => {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: VERANA_BECH32_PREFIX })
  const [account] = await wallet.getAccounts()
  logger.info(`[VeranaChain] vs_operator address: ${account.address} (fund this address with VNA to enable on-chain operations)`)
}

export const resolveVeranaMnemonic = async (
  agent: VsAgent,
  mnemonic: string | undefined,
  logger: TsLogger,
): Promise<string> => {
  if (mnemonic) {
    logger.info('[VeranaChain] Using mnemonic from AGENT_VERANA_MNEMONIC')
    await logOperatorAddress(mnemonic, logger)
    return mnemonic
  }

  const existing = await agent.genericRecords.findAllByQuery({ type: MNEMONIC_RECORD_TAG })
  if (existing.length > 0) {
    logger.info('[VeranaChain] Using stored operator mnemonic from wallet')
    const stored = existing[0].content.mnemonic as string
    await logOperatorAddress(stored, logger)
    return stored
  }

  logger.info('[VeranaChain] No mnemonic found — generating new operator wallet')
  const newWallet = await DirectSecp256k1HdWallet.generate(12, { prefix: VERANA_BECH32_PREFIX })
  await agent.genericRecords.save({
    content: { mnemonic: newWallet.mnemonic },
    tags: { type: MNEMONIC_RECORD_TAG },
  })
  logger.info('[VeranaChain] New operator mnemonic generated and saved to wallet')
  await logOperatorAddress(newWallet.mnemonic, logger)
  return newWallet.mnemonic
}

export class VeranaChainService {
  constructor(
    private readonly rpcUrl: string,
    private readonly mnemonic: string,
    private readonly logger: TsLogger,
  ) {}

  async start(): Promise<void> {
    // 1. Derive wallet and log operator address
    await logOperatorAddress(this.mnemonic, this.logger)

    // 2. Connect to RPC (read-only)
    const tmClient = await connectComet(this.rpcUrl)
    const queryClient = new QueryClient(tmClient)
    const rpc = createProtobufRpcClient(queryClient)

    // 3. Connect to RPC and run simple query: list trust registries
    const trQuery = new QueryClientImpl(rpc)
    const result = await trQuery.ListTrustRegistries({
      controller: '',
      modifiedAfter: undefined,
      activeGfOnly: false,
      preferredLanguage: 'en',
      responseMaxSize: 1,
    })
    this.logger.info(`[VeranaChain] Trust registries on chain: ${JSON.stringify(result,null,2)}`)
  }
}
