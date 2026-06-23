import type { AnonCredsRevocationRegistryDefinition } from '@credo-ts/anoncreds'
import type { AgentContext, Logger } from '@credo-ts/core'

import { BasicTailsFileService } from '@credo-ts/anoncreds'
import { utils } from '@credo-ts/core'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

export class FullTailsFileService extends BasicTailsFileService {
  private tailsServerBaseUrl: string
  public constructor(options: { tailsDirectoryPath?: string; tailsServerBaseUrl: string }) {
    super(options)
    this.tailsServerBaseUrl = options.tailsServerBaseUrl
  }

  public async uploadTailsFile(
    agentContext: AgentContext,
    options: {
      revocationRegistryDefinition: AnonCredsRevocationRegistryDefinition
    },
  ) {
    const revocationRegistryDefinition = options.revocationRegistryDefinition
    const localTailsFilePath = revocationRegistryDefinition.value.tailsLocation

    const tailsFileId = utils.uuid()
    await saveTailsFile(localTailsFilePath, tailsFileId, agentContext.config.logger)
    return { tailsFileUrl: `${this.tailsServerBaseUrl}/${encodeURIComponent(tailsFileId)}` }
  }
}

export const baseFilePath = process.env.TAILS_DIRECTORY_PATH || path.join(os.homedir(), '.afj', 'tails')
const indexFilePath = path.join(baseFilePath, 'index.json')

if (!fs.existsSync(baseFilePath)) {
  fs.mkdirSync(baseFilePath, { recursive: true })
}
export const tailsIndex = (
  fs.existsSync(indexFilePath) ? JSON.parse(fs.readFileSync(indexFilePath, { encoding: 'utf-8' })) : {}
) as Record<string, string>

function fileHash(filePath: string, algorithm = 'sha256') {
  return new Promise<string>((resolve, reject) => {
    const shasum = createHash(algorithm)
    try {
      const s = fs.createReadStream(filePath)
      s.on('data', function (data) {
        shasum.update(data)
      })
      s.on('error', reject)
      s.on('end', function () {
        const hash = shasum.digest('hex')
        return resolve(hash)
      })
    } catch (error) {
      return reject('error in calculation')
    }
  })
}

export function deleteTailsEntry(tailsFileUrl: string): void {
  const tailsFileId = decodeURIComponent(tailsFileUrl.split('/').pop() ?? '')
  if (!tailsFileId || !tailsIndex[tailsFileId]) return

  const hash = tailsIndex[tailsFileId]
  delete tailsIndex[tailsFileId]
  fs.writeFileSync(indexFilePath, JSON.stringify(tailsIndex))

  const stillReferenced = Object.values(tailsIndex).includes(hash)
  if (!stillReferenced) {
    const filePath = `${baseFilePath}/${hash}`
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
}

async function saveTailsFile(localFilePath: string, tailsFileId: string, logger: Logger) {
  logger.info(`Processing tails file: ${tailsFileId}`)

  if (!localFilePath) throw new Error('No file path was provided.')
  if (!tailsFileId) throw new Error('Missing tailsFileId')
  if (tailsIndex[tailsFileId]) throw new Error(`There is already an entry for: ${tailsFileId}`)

  const hash = await fileHash(localFilePath)
  const destinationPath = `${baseFilePath}/${hash}`
  if (fs.existsSync(destinationPath)) {
    logger.warn('Tails file already exists')
  } else {
    fs.copyFileSync(localFilePath, destinationPath)
  }

  tailsIndex[tailsFileId] = hash
  fs.writeFileSync(indexFilePath, JSON.stringify(tailsIndex))

  logger.info(`Successfully processed tails file ${tailsFileId}`)
}
