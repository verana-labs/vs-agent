import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {} }
const agentContext = { config: { logger } } as never

const TAILS_SERVER = 'https://example.test/anoncreds/v1/tails'

async function loadModule(tailsDir?: string) {
  vi.resetModules()
  if (tailsDir === undefined) delete process.env.TAILS_DIRECTORY_PATH
  else process.env.TAILS_DIRECTORY_PATH = tailsDir
  return import('../src/credentials/FullTailsFileService')
}

async function upload(mod: Awaited<ReturnType<typeof loadModule>>, source: string): Promise<string> {
  const service = new mod.FullTailsFileService({ tailsServerBaseUrl: TAILS_SERVER })
  const { tailsFileUrl } = await service.uploadTailsFile(agentContext, {
    revocationRegistryDefinition: { value: { tailsLocation: source } },
  } as never)
  return tailsFileUrl
}

describe('FullTailsFileService tails storage (issue #451)', () => {
  let tmp: string
  const originalEnv = process.env.TAILS_DIRECTORY_PATH

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tails-451-'))
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TAILS_DIRECTORY_PATH
    else process.env.TAILS_DIRECTORY_PATH = originalEnv
    vi.restoreAllMocks()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('honors TAILS_DIRECTORY_PATH with an absolute served directory', async () => {
    const dir = path.join(tmp, 'tails')
    const mod = await loadModule(dir)
    expect(path.isAbsolute(mod.baseFilePath)).toBe(true)
    expect(mod.baseFilePath).toBe(dir)
  })

  it('defaults to a durable ~/.afj/tails directory when unset (never cwd-relative)', async () => {
    const fakeHome = path.join(tmp, 'home')
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome)
    const mod = await loadModule(undefined)
    expect(mod.baseFilePath).toBe(path.join(fakeHome, '.afj', 'tails'))
  })

  it('stores an uploaded tails file and serves it back through the index', async () => {
    const dir = path.join(tmp, 'tails')
    const mod = await loadModule(dir)
    const source = path.join(tmp, 'source.bin')
    fs.writeFileSync(source, Buffer.from('tails-content-451'))

    const url = await upload(mod, source)
    const id = url.split('/').pop() as string

    expect(url).toBe(`${TAILS_SERVER}/${id}`)
    const fileName = mod.tailsIndex[id]
    expect(fileName).toBeDefined()
    const served = path.join(mod.baseFilePath, fileName)
    expect(fs.existsSync(served)).toBe(true)
    expect(fs.readFileSync(served).toString()).toBe('tails-content-451')
  })

  it('persists the index so a restart still resolves the published URL', async () => {
    const dir = path.join(tmp, 'tails')
    const source = path.join(tmp, 'source.bin')
    fs.writeFileSync(source, Buffer.from('tails-content-451'))

    const url = await upload(await loadModule(dir), source)
    const id = url.split('/').pop() as string

    const reloaded = await loadModule(dir)
    expect(reloaded.tailsIndex[id]).toBeDefined()
    expect(fs.existsSync(path.join(reloaded.baseFilePath, reloaded.tailsIndex[id]))).toBe(true)
  })

  it('rejects instead of publishing a dangling URL when the source is missing', async () => {
    const mod = await loadModule(path.join(tmp, 'tails'))
    await expect(upload(mod, path.join(tmp, 'does-not-exist.bin'))).rejects.toThrow()
  })
})
