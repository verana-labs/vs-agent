import type { AnonCredsRevocationRegistryDefinition } from '@credo-ts/anoncreds'
import type { AgentContext, FileSystem } from '@credo-ts/core'

import { BasicTailsFileService } from '@credo-ts/anoncreds'
import { InjectionSymbols } from '@credo-ts/core'
import fs from 'fs'
import path from 'path'

const tailsFileNamePattern = /^[A-Za-z0-9]+$/

export function isValidTailsFileName(name: string): boolean {
  return tailsFileNamePattern.test(name)
}

export function getTailsDirectoryPath(agentContext: AgentContext): string {
  if (process.env.TAILS_DIRECTORY_PATH) return process.env.TAILS_DIRECTORY_PATH
  const fileSystem = agentContext.dependencyManager.resolve<FileSystem>(InjectionSymbols.FileSystem)
  return path.join(fileSystem.dataPath, 'tails')
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
