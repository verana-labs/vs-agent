import '@openwallet-foundation/askar-nodejs'

import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'
import { agentDependencies } from '@credo-ts/node'
import { ed25519 } from '@noble/curves/ed25519.js'
import { DIDLog, resolveDIDFromLog, Verifier } from 'didwebvh-ts'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'

import { createVsAgent, VsAgent } from '../src/agent'
import { setupBaseDidComm } from '../src/plugins/setupBaseDidComm'

const TEST_TIMEOUT_MS = 60_000

class InMemoryVerifier implements Verifier {
  public async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return ed25519.verify(signature, message, publicKey)
    } catch {
      return false
    }
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-agent-public-did-startup-'))

function walletConfig(name: string): AskarModuleConfigStoreOptions {
  return {
    id: `public-did-startup-${name}`,
    key: 'DZ9hPqFWTPxemcGea72C1X1nusqk5wFNLq6QPjwXGqAa',
    keyDerivationMethod: 'raw',
    database: { type: 'sqlite', config: { path: path.join(tmpDir, `${name}.db`) } },
  }
}

function makeAgent(did: string, wallet: AskarModuleConfigStoreOptions): VsAgent {
  const domain = did.split(':')[2]
  return createVsAgent({
    plugins: [
      setupBaseDidComm({
        walletConfig: wallet,
        publicApiBaseUrl: `https://${domain}`,
        endpoints: [`rxjs:${domain}`],
      }),
    ],
    walletConfig: wallet,
    did,
    dependencies: agentDependencies,
    publicApiBaseUrl: `https://${domain}`,
    label: 'Public DID Startup Test',
  }) as unknown as VsAgent
}

describe('public DID startup lifecycle', () => {
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it(
    'cold start creates and persists a did:web fully determined by the location',
    async () => {
      const agent = makeAgent('did:web:web-cold.example', walletConfig('web-cold'))
      await agent.initialize()

      expect(agent.did).toBe('did:web:web-cold.example')
      const records = await agent.dids.getCreatedDids({ method: 'web' })
      expect(records).toHaveLength(1)
      expect(records[0].did).toBe('did:web:web-cold.example')
      expect(records[0].keys?.length).toBeGreaterThan(0)
      expect(records[0].didDocument?.didCommServices.length).toBeGreaterThan(0)

      await agent.shutdown()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'cold start creates a did:webvh whose 2-entry log resolves under didwebvh-ts',
    async () => {
      const agent = makeAgent('did:webvh:webvh-cold.example', walletConfig('webvh-cold'))
      await agent.initialize()

      expect(agent.did).toMatch(/^did:webvh:[^:]+:webvh-cold\.example$/)
      const records = await agent.dids.getCreatedDids({ method: 'webvh' })
      expect(records).toHaveLength(1)
      const log = records[0].metadata.get('log') as DIDLog
      expect(log).toHaveLength(2)

      // Regression guard for the didwebvh-ts 2.8.0 same-second rejection: the freshly
      // written log must resolve, not only be written
      const resolved = await resolveDIDFromLog(log, { verifier: new InMemoryVerifier() })
      expect(resolved.did).toBe(agent.did)
      expect(resolved.doc.service?.length).toBeGreaterThan(0)

      await agent.shutdown()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'cold start supports a path-based webvh location',
    async () => {
      const agent = makeAgent('did:webvh:path.example:dids:issuer', walletConfig('webvh-path'))
      await agent.initialize()

      expect(agent.did).toMatch(/^did:webvh:[^:]+:path\.example:dids:issuer$/)
      const records = await agent.dids.getCreatedDids({ method: 'webvh' })
      expect(records[0].getTag('domain')).toBe('path.example:dids:issuer')

      await agent.shutdown()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'warm start loads the persisted DID and does not mint a second one',
    async () => {
      const wallet = walletConfig('restart')
      const first = makeAgent('did:webvh:restart.example', wallet)
      await first.initialize()
      const did = first.did
      expect(did).toMatch(/^did:webvh:/)
      await first.shutdown()

      const second = makeAgent('did:webvh:restart.example', wallet)
      await second.initialize()

      expect(second.did).toBe(did)
      expect(await second.dids.getCreatedDids({ method: 'webvh' })).toHaveLength(1)

      await second.shutdown()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'refuses to start on a location mismatch and writes no new DID record',
    async () => {
      const wallet = walletConfig('mismatch')
      const first = makeAgent('did:webvh:original.example', wallet)
      await first.initialize()
      const originalDid = first.did
      await first.shutdown()

      const second = makeAgent('did:webvh:changed.example', wallet)
      await expect(second.initialize()).rejects.toThrow(/'original\.example'.*'changed\.example'/)

      const records = await second.dids.getCreatedDids({ method: 'webvh' })
      expect(records).toHaveLength(1)
      expect(records[0].did).toBe(originalDid)

      await second.shutdown()
    },
    TEST_TIMEOUT_MS,
  )
})
