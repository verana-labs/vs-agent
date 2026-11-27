import type { BaseLogger } from '@credo-ts/core'
import type { DidCommFeatureQueryOptions } from '@credo-ts/didcomm'

import * as fs from 'fs'
import * as path from 'path'

/**
 * Reads the discover-features queries of `discovery.json`, from the first of the directories that
 * holds the file. Without a readable file the agent asks its peers nothing.
 */
export function readDiscoveryOptions(
  directories: readonly string[],
  logger: BaseLogger,
): DidCommFeatureQueryOptions[] | undefined {
  const candidates = [...new Set(directories.map(directory => path.resolve(directory, 'discovery.json')))]
  const file = candidates.find(candidate => fs.existsSync(candidate))
  if (!file) {
    logger.warn(
      `No discovery.json in ${candidates.map(candidate => path.dirname(candidate)).join(' or ')}: the agent does not query the features of its peers`,
    )
    return undefined
  }
  try {
    const options = JSON.parse(fs.readFileSync(file, 'utf-8'))
    logger.info(`Feature discovery queries read from ${file}`)
    return options
  } catch (error) {
    logger.warn(
      `Cannot read ${file}: ${(error as Error).message}. The agent does not query the features of its peers`,
    )
    return undefined
  }
}
