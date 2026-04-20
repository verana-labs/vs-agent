import type { AnonCredsRevocationRegistryDefinition } from '@credo-ts/anoncreds'
import type { AgentContext, Logger } from '@credo-ts/core'

import { BasicTailsFileService } from '@credo-ts/anoncreds'
import { utils } from '@credo-ts/core'
import { createHash } from 'crypto'
import fs from 'fs'

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
    try {
      await saveTailsFile(localTailsFilePath, tailsFileId, agentContext.config.logger)
      agentContext.config.logger.info('Tails file processed successfully!')
    } catch (error) {
      agentContext.config.logger.error(`Failed to process tails file: ${error.message}`)
    }
    return { tailsFileUrl: `${this.tailsServerBaseUrl}/${encodeURIComponent(tailsFileId)}` }
  }
}

export const baseFilePath = './tails'
const indexFilePath = `./${baseFilePath}/index.json`

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
      // making digest
      s.on('end', function () {
        const hash = shasum.digest('hex')
        return resolve(hash)
      })
    } catch (error) {
      return reject('error in calculation')
    }
  })
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
