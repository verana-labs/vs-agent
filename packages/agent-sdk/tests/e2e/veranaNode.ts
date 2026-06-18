/* eslint-disable no-console -- progress logging for the long-running e2e harness */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

const VERANA_IMAGE = process.env.FLOW_VERANA_IMAGE || 'veranalabs/verana-node:main'
const VERANA_PLATFORM = process.env.FLOW_VERANA_PLATFORM || 'linux/amd64'
const SETUP_TIMEOUT_MS = Number(process.env.FLOW_SETUP_TIMEOUT_MS || 1_200_000)
const POLL_TIMEOUT_MS = Number(process.env.FLOW_POLL_TIMEOUT_MS || 300_000)
const POLL_INTERVAL_MS = Number(process.env.FLOW_POLL_INTERVAL_MS || 3_000)

export const CHAIN_ID = 'vna-testnet-1'
// cooluser is funded at genesis by the bootstrap below; the test wallet derives from it.
export const COOLUSER_MNEMONIC = 'pink glory help gown abstract eight nice crazy forward ketchup skill cheese'

// Single-validator bootstrap injected as the verana-node container command.
// String.raw keeps the sed backslashes (e.g. `\[\]`) intact.
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

export interface StartedVeranaNode {
  container: StartedTestContainer
  /** Tendermint RPC endpoint (used by CosmJS). */
  rpcUrl: string
  stop(): Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function nodeHasBlocks(rpcUrl: string): Promise<boolean> {
  const response = await fetch(`${rpcUrl}/status`)
  if (!response.ok) return false
  const body: any = await response.json()
  return Number(body?.result?.sync_info?.latest_block_height ?? 0) >= 1
}

/** Boots a single-validator verana-node and waits until it produces blocks. */
export async function startVeranaNode(): Promise<StartedVeranaNode> {
  console.log(`[flow] starting verana-node (${VERANA_IMAGE})...`)
  const container = await new GenericContainer(VERANA_IMAGE)
    .withPlatform(VERANA_PLATFORM)
    .withEntrypoint(['/bin/bash', '-c'])
    .withCommand([NODE_INIT_SCRIPT])
    .withExposedPorts(26657)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(SETUP_TIMEOUT_MS)
    .start()

  const rpcUrl = `http://${container.getHost()}:${container.getMappedPort(26657)}`

  console.log('[flow] waiting for verana-node to produce blocks...')
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await nodeHasBlocks(rpcUrl).catch(() => false)) {
      return { container, rpcUrl, stop: () => container.stop().then(() => undefined) }
    }
    await delay(POLL_INTERVAL_MS)
  }
  await container.stop().catch(() => undefined)
  throw new Error(`verana-node did not produce blocks within ${POLL_TIMEOUT_MS}ms`)
}
