import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import knexFactory, { Knex } from 'knex';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1';
const describeE2E = E2E_ENABLED ? describe : describe.skip;

const ROOT = process.cwd();

const POSTGRES_IMAGE = process.env.FLOW_POSTGRES_IMAGE || 'postgres:16-alpine';
const REDIS_IMAGE = process.env.FLOW_REDIS_IMAGE || 'redis:7-alpine';
const VERANA_IMAGE = process.env.FLOW_VERANA_IMAGE || 'veranalabs/verana-node:main';
const INDEXER_IMAGE = process.env.FLOW_INDEXER_IMAGE || 'veranalabs/verana-indexer:dev';
const VERANA_PLATFORM = process.env.FLOW_VERANA_PLATFORM || 'linux/amd64';

const NODE_ALIAS = 'verana-node';
const POSTGRES_ALIAS = 'postgres';
const REDIS_ALIAS = 'redis';

const POSTGRES_USER = 'verana';
const POSTGRES_PASSWORD = 'verana';
const POSTGRES_DB = 'verana_indexer_e2e';
const CHAIN_ID = 'vna-testnet-1';

const SETUP_TIMEOUT_MS = Number(process.env.FLOW_SETUP_TIMEOUT_MS || 1_200_000);
const POLL_TIMEOUT_MS = Number(process.env.FLOW_POLL_TIMEOUT_MS || 300_000);
const POLL_INTERVAL_MS = Number(process.env.FLOW_POLL_INTERVAL_MS || 3_000);
const TEST_TIMEOUT_MS = POLL_TIMEOUT_MS + 60_000;

const RUN_ID = String(Date.now());
const CORP_DID = `did:example:corporation-${RUN_ID}`;
const ECO_DID = `did:example:ecosystem-${RUN_ID}`;

// Single-validator bootstrap injected as the verana-node container command.
// String.raw keeps the sed backslashes (e.g. `\[\]`) intact. CHAIN_ID is
// hard-coded to match the `CHAIN_ID` constant above.
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
`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(description: string, predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  const suffix = lastError ? ` (last error: ${(lastError as Error).message})` : '';
  throw new Error(`Timed out after ${POLL_TIMEOUT_MS}ms waiting for: ${description}${suffix}`);
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logLabel: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${logLabel} exited with code ${code}`));
    });
  });
}

async function nodeIsReady(rpcUrl: string): Promise<boolean> {
  const response = await fetch(`${rpcUrl}/status`);
  if (!response.ok) return false;
  const body: any = await response.json();
  const height = Number(body?.result?.sync_info?.latest_block_height ?? 0);
  const catchingUp = body?.result?.sync_info?.catching_up;
  return catchingUp === false && height >= 1;
}

function buildKnex(host: string, port: number): Knex {
  return knexFactory({
    client: 'pg',
    connection: { host, port, user: POSTGRES_USER, password: POSTGRES_PASSWORD, database: POSTGRES_DB },
    pool: { min: 0, max: 4 },
  });
}

async function countRows(db: Knex, table: string): Promise<number> {
  const result = await db(table).count<{ count: string }[]>('* as count').first();
  return Number(result?.count ?? 0);
}

async function partitionChildCount(db: Knex, parent: string): Promise<number> {
  const result = await db.raw(
    `SELECT count(*)::int AS count
       FROM pg_inherits i
       JOIN pg_class child  ON child.oid  = i.inhrelid
       JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = ?`,
    [parent]
  );
  return Number(result.rows?.[0]?.count ?? 0);
}

describeE2E('Verana end-to-end flow consistency (testcontainers)', () => {
  let network: StartedNetwork;
  let postgres: StartedTestContainer;
  let redis: StartedTestContainer;
  let veranaNode: StartedTestContainer;
  let indexer: StartedTestContainer;
  let db: Knex;

  beforeAll(async () => {
    network = await new Network().start();

    [postgres, redis] = await Promise.all([
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
    ]);

    veranaNode = await new GenericContainer(VERANA_IMAGE)
      .withPlatform(VERANA_PLATFORM)
      .withNetwork(network)
      .withNetworkAliases(NODE_ALIAS)
      .withEntrypoint(['/bin/bash', '-c'])
      .withCommand([NODE_INIT_SCRIPT])
      .withExposedPorts(26657, 1317)
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(SETUP_TIMEOUT_MS)
      .start();

    const pgHost = postgres.getHost();
    const pgPort = postgres.getMappedPort(5432);
    const rpcUrl = `http://${veranaNode.getHost()}:${veranaNode.getMappedPort(26657)}`;

    console.log('[flow] waiting for verana-node to produce blocks...');
    await pollUntil('verana-node caught up', () => nodeIsReady(rpcUrl));

    console.log(`[flow] starting the indexer container (${INDEXER_IMAGE})...`);
    const logDir = path.join(ROOT, 'tests', '.logs');
    mkdirSync(logDir, { recursive: true });
    const indexerLog = createWriteStream(path.join(logDir, 'verana-indexer.log'), { flags: 'w' });
    indexer = await new GenericContainer(INDEXER_IMAGE)
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
      .withLogConsumer((stream) => {
        stream.on('data', (line) => indexerLog.write(line));
        stream.on('err', (line) => indexerLog.write(line));
      })
      .withWaitStrategy(Wait.forLogMessage(/ServiceBroker with \d+ service\(s\) started successfully/))
      .withStartupTimeout(SETUP_TIMEOUT_MS)
      .start();

    db = buildKnex(pgHost, pgPort);

    console.log('[flow] waiting for the indexer to ingest blocks...');
    await pollUntil('indexer ingests blocks', async () => (await countRows(db, 'block')) > 0);

    console.log(`[flow] driving the chain via verana-test-flow.sh (corp=${CORP_DID})...`);
    await runProcess(
      'bash',
      ['tests/scripts/verana-test-flow.sh'],
      {
        ...process.env,
        CONTAINER: veranaNode.getName().replace(/^\//, ''),
        CHAIN_ID,
        RUN_ID,
        CORP_DID,
        ECO_DID,
      },
      'verana-test-flow'
    );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (db) await db.destroy().catch(() => undefined);
    await indexer?.stop().catch(() => undefined);
    await veranaNode?.stop().catch(() => undefined);
    await Promise.all([postgres?.stop().catch(() => undefined), redis?.stop().catch(() => undefined)]);
    await network?.stop().catch(() => undefined);
  });

  it(
    'the corporation created by the flow is indexed',
    async () => {
      await pollUntil('corporation row', async () =>
        Boolean(await db('corporation').where('did', CORP_DID).first())
      );
      const row = await db('corporation').where('did', CORP_DID).first();
      expect(row).toBeDefined();
      expect(row.did).toBe(CORP_DID);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'the ecosystem created by the flow is indexed',
    async () => {
      await pollUntil('ecosystem row', async () => (await countRows(db, 'ecosystem')) > 0);
      expect(await countRows(db, 'ecosystem')).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'the credential schema created by the flow is indexed',
    async () => {
      await pollUntil('credential_schemas row', async () => (await countRows(db, 'credential_schemas')) > 0);
      expect(await countRows(db, 'credential_schemas')).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'the participants created by the flow are indexed',
    async () => {
      await pollUntil('participants row', async () => (await countRows(db, 'participants')) > 0);
      expect(await countRows(db, 'participants')).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'the core tables are partitioned',
    async () => {
      const parents = ['transaction', 'transaction_message', 'block'];
      await pollUntil('partition child tables', async () => {
        const counts = await Promise.all(parents.map((p) => partitionChildCount(db, p)));
        return counts.every((c) => c > 0);
      });
      for (const parent of parents) {
        expect(await partitionChildCount(db, parent)).toBeGreaterThan(0);
      }
    },
    TEST_TIMEOUT_MS
  );
});
