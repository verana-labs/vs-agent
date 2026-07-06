/* eslint-disable no-console -- progress logging for the long-running e2e harness */
import type {
  IndexerBlockMessage,
  IndexerEventRecord,
  IndexerReadyMessage,
  IndexerSubscribeMessage,
} from '../../src/blockchain/types'

import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers'
import WebSocket from 'ws'

// applicant-ops needs dev.21+ (VSOA accepted for SetParticipantOPToValidated).
const VERANA_IMAGE = process.env.FLOW_VERANA_IMAGE || 'veranalabs/verana-node:v0.10.1-dev.21'
const VERANA_PLATFORM = process.env.FLOW_VERANA_PLATFORM || 'linux/amd64'
const POSTGRES_IMAGE = process.env.FLOW_POSTGRES_IMAGE || 'postgres:16-alpine'
const REDIS_IMAGE = process.env.FLOW_REDIS_IMAGE || 'redis:7-alpine'
const INDEXER_IMAGE = process.env.FLOW_INDEXER_IMAGE || 'veranalabs/verana-indexer:dev'

const NODE_ALIAS = 'verana-node'
const POSTGRES_ALIAS = 'postgres'
const REDIS_ALIAS = 'redis'
const POSTGRES_USER = 'verana'
const POSTGRES_PASSWORD = 'verana'
const POSTGRES_DB = 'verana_indexer_e2e'

const POLL_TIMEOUT_MS = Number(process.env.FLOW_POLL_TIMEOUT_MS || 300_000)
const POLL_INTERVAL_MS = Number(process.env.FLOW_POLL_INTERVAL_MS || 3_000)
const WS_PATHNAME = 'v4/indexer/subscribe'

export const CHAIN_ID = 'vna-testnet-1'
export const COOLUSER_MNEMONIC = 'pink glory help gown abstract eight nice crazy forward ketchup skill cheese'
export const SETUP_TIMEOUT_MS = Number(process.env.FLOW_SETUP_TIMEOUT_MS || 1_200_000)
export const EVENT_TIMEOUT_MS = Number(process.env.FLOW_EVENT_TIMEOUT_MS || 120_000)

const NODE_INIT_SCRIPT = String.raw`#!/usr/bin/env bash
set -e
HOME_DIR=/root/.verana
GENESIS=$HOME_DIR/config/genesis.json
SENTINEL=$HOME_DIR/.init-complete
CHAIN_ID=vna-testnet-1
MONIKER=validator1
KEY=cooluser
MNEMONIC="pink glory help gown abstract eight nice crazy forward ketchup skill cheese"
YIELD_ADDR=verana1wjnrmvjlgxvs098cnu3jaczzjjm4csmqep067h

if [ ! -f "$SENTINEL" ]; then
  echo ">> First boot: initializing $CHAIN_ID and funding $KEY ..."
  rm -rf "$HOME_DIR/config" "$HOME_DIR/data" "$HOME_DIR/keyring-test"
  veranad init "$MONIKER" --chain-id "$CHAIN_ID" --default-denom uvna

  echo "$MNEMONIC" | veranad keys add "$KEY" --recover --keyring-backend test
  veranad add-genesis-account "$KEY" 1000000000000000000000uvna --keyring-backend test
  veranad add-genesis-account "$YIELD_ADDR" 1uvna --keyring-backend test

  sed -i 's/"stake"/"uvna"/g' "$GENESIS"
  tmp=$(mktemp)
  jq '.app_state.gov.params.max_deposit_period="100s"
      | .app_state.gov.params.voting_period="100s"
      | .app_state.gov.params.expedited_voting_period="90s"' "$GENESIS" > "$tmp" && mv "$tmp" "$GENESIS"

  veranad gentx "$KEY" 1000000000uvna \
    --chain-id "$CHAIN_ID" --moniker "$MONIKER" \
    --commission-rate 0.10 --commission-max-rate 0.20 \
    --commission-max-change-rate 0.01 --min-self-delegation 1 \
    --keyring-backend test
  veranad collect-gentxs
  veranad validate-genesis

  sed -i 's/minimum-gas-prices = ""/minimum-gas-prices = "0.25uvna"/' "$HOME_DIR/config/app.toml"
  sed -i 's/enable = false/enable = true/'                            "$HOME_DIR/config/app.toml"
  sed -i 's/swagger = false/swagger = true/'                          "$HOME_DIR/config/app.toml"
  sed -i 's/enabled-unsafe-cors = false/enabled-unsafe-cors = true/'  "$HOME_DIR/config/app.toml"
  sed -i 's#address = "tcp://localhost:#address = "tcp://0.0.0.0:#'    "$HOME_DIR/config/app.toml"
  sed -i 's#address = "localhost:#address = "0.0.0.0:#'               "$HOME_DIR/config/app.toml"
  sed -i 's/cors_allowed_origins = \[\]/cors_allowed_origins = ["*"]/' "$HOME_DIR/config/config.toml"
  sed -i 's#laddr = "tcp://127.0.0.1:#laddr = "tcp://0.0.0.0:#'        "$HOME_DIR/config/config.toml"
  sed -i 's/^timeout_commit = .*/timeout_commit = "1s"/'              "$HOME_DIR/config/config.toml"

  touch "$SENTINEL"
fi

echo ">> Starting node ..."
exec veranad start
`

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForBlocks(rpcUrl: string): Promise<void> {
  console.log('[flow] waiting for verana-node to produce blocks...')
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ok = await fetch(`${rpcUrl}/status`)
      .then(r => (r.ok ? r.json() : null))
      .then((b: any) => Number(b?.result?.sync_info?.latest_block_height ?? 0) >= 1)
      .catch(() => false)
    if (ok) return
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`verana-node did not produce blocks within ${POLL_TIMEOUT_MS}ms`)
}

export interface StartedStack {
  rpcUrl: string
  indexerWsUrl: string
  stop(): Promise<void>
}

export async function startStack(): Promise<StartedStack> {
  const network = await new Network().start()
  const containers: StartedTestContainer[] = []
  const stop = async (): Promise<void> => {
    await Promise.all(containers.map(c => c.stop().catch(() => undefined)))
    await network.stop().catch(() => undefined)
  }

  try {
    console.log('[flow] starting postgres + redis...')
    const [postgres, redis] = await Promise.all([
      new GenericContainer(POSTGRES_IMAGE)
        .withNetwork(network)
        .withNetworkAliases(POSTGRES_ALIAS)
        .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
      new GenericContainer(REDIS_IMAGE)
        .withNetwork(network)
        .withNetworkAliases(REDIS_ALIAS)
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
    ])
    containers.push(postgres, redis)

    console.log(`[flow] starting verana-node (${VERANA_IMAGE})...`)
    const node = await new GenericContainer(VERANA_IMAGE)
      .withPlatform(VERANA_PLATFORM)
      .withNetwork(network)
      .withNetworkAliases(NODE_ALIAS)
      .withEntrypoint(['/bin/bash', '-c'])
      .withCommand([NODE_INIT_SCRIPT])
      .withExposedPorts(26657, 1317)
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(SETUP_TIMEOUT_MS)
      .start()
    containers.push(node)

    const rpcUrl = `http://${node.getHost()}:${node.getMappedPort(26657)}`
    await waitForBlocks(rpcUrl)

    console.log(`[flow] starting indexer (${INDEXER_IMAGE})...`)
    const indexer = await new GenericContainer(INDEXER_IMAGE)
      .withNetwork(network)
      .withEnvironment({
        NODE_ENV: 'production',
        SERVICEDIR: 'dist/src/services',
        SERVICES: '**/*.service.js',
        CHAIN_ID,
        RPC_ENDPOINT: `http://${NODE_ALIAS}:26657/`,
        LCD_ENDPOINT: `http://${NODE_ALIAS}:1317`,
        POSTGRES_HOST: POSTGRES_ALIAS,
        POSTGRES_PORT: '5432',
        POSTGRES_USER,
        POSTGRES_PASSWORD,
        POSTGRES_DB,
        TRANSPORTER: `redis://${REDIS_ALIAS}:6379`,
        CACHER: `redis://${REDIS_ALIAS}:6379`,
        QUEUE_JOB_REDIS: `redis://${REDIS_ALIAS}:6379`,
      })
      .withExposedPorts(3001)
      .withWaitStrategy(Wait.forLogMessage(/ServiceBroker with \d+ service\(s\) started successfully/))
      .withStartupTimeout(SETUP_TIMEOUT_MS)
      .start()
    containers.push(indexer)

    const indexerWsUrl = `ws://${indexer.getHost()}:${indexer.getMappedPort(3001)}`
    return { rpcUrl, indexerWsUrl, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

type Waiter = {
  predicate: (event: IndexerEventRecord) => boolean
  resolve: (event: IndexerEventRecord) => void
  timer: NodeJS.Timeout
}

export class IndexerSubscriber {
  private readonly events: IndexerEventRecord[] = []
  private readonly waiters: Waiter[] = []

  private constructor(private readonly ws: WebSocket) {}

  static connect(
    baseWsUrl: string,
    filter: Omit<IndexerSubscribeMessage, 'action'> = {},
  ): Promise<IndexerSubscriber> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${baseWsUrl}/${WS_PATHNAME}`)
      const subscriber = new IndexerSubscriber(ws)

      ws.on('message', (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as IndexerReadyMessage | IndexerBlockMessage
        if (message.type === 'ready') {
          ws.send(JSON.stringify({ action: 'subscribe', ...filter } as IndexerSubscribeMessage))
          resolve(subscriber)
        } else if (message.type === 'block') {
          for (const event of message.events) subscriber.handleEvent(event)
        }
      })
      ws.on('error', reject)
    })
  }

  private handleEvent(event: IndexerEventRecord): void {
    this.events.push(event)
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timer)
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve(event)
      }
    }
  }

  waitForEvent(
    predicate: (event: IndexerEventRecord) => boolean,
    timeoutMs: number,
  ): Promise<IndexerEventRecord> {
    const existing = this.events.find(predicate)
    if (existing) return Promise.resolve(existing)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.splice(
          this.waiters.findIndex(w => w.timer === timer),
          1,
        )
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for an indexer event`))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, timer })
    })
  }

  close(): void {
    for (const waiter of this.waiters) clearTimeout(waiter.timer)
    this.ws.close()
  }
}

export const sameTx = (txHash: string) => (event: IndexerEventRecord) =>
  event.tx_hash.toLowerCase() === txHash.toLowerCase()
