import type { AnonCredsRevocationRegistryDefinition } from '@credo-ts/anoncreds'
import type { AgentContext, FileSystem } from '@credo-ts/core'

import { BasicTailsFileService } from '@credo-ts/anoncreds'
import { InjectionSymbols } from '@credo-ts/core'
import { randomBytes } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tailsFileNamePattern = /^[A-Za-z0-9-]+$/

export function isValidTailsFileName(name: string): boolean {
  return tailsFileNamePattern.test(name)
}

export function getTailsDirectoryPath(agentContext: AgentContext): string {
  if (process.env.TAILS_DIRECTORY_PATH) return process.env.TAILS_DIRECTORY_PATH
  const fileSystem = agentContext.dependencyManager.resolve<FileSystem>(InjectionSymbols.FileSystem)
  return path.join(fileSystem.dataPath, 'tails')
}

// Copy uuid tails files from earlier locations (TAILS_DIRECTORY_PATH, ~/.afj/tails, the old cwd ./tails) into the current dir so URLs published before the hash-based change still resolve.
export function migrateLegacyTailsFiles(agentContext: AgentContext): void {
  const directory = getTailsDirectoryPath(agentContext)
  const legacyDirectories = [
    process.env.TAILS_DIRECTORY_PATH,
    path.join(os.homedir(), '.afj', 'tails'),
    path.resolve('tails'),
  ]
  for (const legacyDirectory of new Set(legacyDirectories.filter((d): d is string => Boolean(d)))) {
    try {
      const legacyIndexPath = path.join(legacyDirectory, 'index.json')
      if (!fs.existsSync(legacyIndexPath)) continue

      const legacyIndex = JSON.parse(fs.readFileSync(legacyIndexPath, 'utf-8')) as Record<string, string>
      fs.mkdirSync(directory, { recursive: true })

      let migrated = 0
      for (const [tailsFileId, hash] of Object.entries(legacyIndex)) {
        if (!isValidTailsFileName(tailsFileId) || !isValidTailsFileName(hash)) continue
        const source = path.join(legacyDirectory, hash)
        const destination = path.join(directory, tailsFileId)
        if (!fs.existsSync(source) || fs.existsSync(destination)) continue

        const tempPath = path.join(
          directory,
          `.${tailsFileId}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
        )
        try {
          fs.copyFileSync(source, tempPath)
          fs.renameSync(tempPath, destination)
          migrated++
        } catch (fileError) {
          try {
            fs.unlinkSync(tempPath)
          } catch {}
          agentContext.config.logger.warn(`Legacy tails file ${tailsFileId} skipped: ${fileError.message}`)
        }
      }
      if (migrated > 0)
        agentContext.config.logger.info(`Migrated ${migrated} legacy tails file(s) from ${legacyDirectory}`)
    } catch (error) {
      agentContext.config.logger.warn(
        `Legacy tails migration skipped for ${legacyDirectory}: ${error.message}`,
      )
    }
  }
}

export class FullTailsFileService extends BasicTailsFileService {
  private tailsServerBaseUrl: string

  public constructor(options: { tailsServerBaseUrl: string }) {
    super()
    this.tailsServerBaseUrl = options.tailsServerBaseUrl
  }

  public async uploadTailsFile(
    agentContext: AgentContext,
    options: { revocationRegistryDefinition: AnonCredsRevocationRegistryDefinition },
  ): Promise<{ tailsFileUrl: string }> {
    const { tailsLocation, tailsHash } = options.revocationRegistryDefinition.value

    const directory = getTailsDirectoryPath(agentContext)
    await fs.promises.mkdir(directory, { recursive: true })

    const destination = path.join(directory, tailsHash)
    if (!fs.existsSync(destination)) await fs.promises.copyFile(tailsLocation, destination)

    agentContext.config.logger.info(`Stored tails file ${tailsHash}`)
    return { tailsFileUrl: `${this.tailsServerBaseUrl}/${encodeURIComponent(tailsHash)}` }
  }
}

export function deleteTailsFile(agentContext: AgentContext, tailsFileUrl: string): void {
  const tailsHash = decodeURIComponent(tailsFileUrl.split('/').pop() ?? '')
  if (!isValidTailsFileName(tailsHash)) return

  const filePath = path.join(getTailsDirectoryPath(agentContext), tailsHash)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}
