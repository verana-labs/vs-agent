import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readDiscoveryOptions } from '../src/utils/discoveryOptions'

const queries = [{ featureType: 'protocol', match: 'https://didcomm.org/*' }]
const logger = { info: vi.fn(), warn: vi.fn() }

let workingDirectory: string
let appDirectory: string

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-agent-discovery-'))
  workingDirectory = path.join(root, 'www')
  appDirectory = path.join(root, 'www', 'apps', 'vs-agent')
  fs.mkdirSync(appDirectory, { recursive: true })
  vi.clearAllMocks()
})

afterEach(() => fs.rmSync(path.dirname(workingDirectory), { recursive: true, force: true }))

const read = () => readDiscoveryOptions([workingDirectory, appDirectory], logger as never)

describe('discovery.json', () => {
  it('is read from the app directory when the working directory has none, as in the image', () => {
    fs.writeFileSync(path.join(appDirectory, 'discovery.json'), JSON.stringify(queries))

    expect(read()).toEqual(queries)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(path.join(appDirectory, 'discovery.json')),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('is read from the working directory first', () => {
    fs.writeFileSync(path.join(workingDirectory, 'discovery.json'), JSON.stringify(queries))
    fs.writeFileSync(path.join(appDirectory, 'discovery.json'), JSON.stringify([]))

    expect(read()).toEqual(queries)
  })

  it('gives no query and a warning that names both directories when there is no file', () => {
    expect(read()).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      `No discovery.json in ${workingDirectory} or ${appDirectory}: the agent does not query the features of its peers`,
    )
  })

  it('gives no query and a warning when the file is not JSON', () => {
    fs.writeFileSync(path.join(appDirectory, 'discovery.json'), '[{ featureType')

    expect(read()).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Cannot read ${path.join(appDirectory, 'discovery.json')}`),
    )
  })

  it('looks once in a directory given twice, as when the agent starts from its app directory', () => {
    expect(readDiscoveryOptions([appDirectory, appDirectory], logger as never)).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      `No discovery.json in ${appDirectory}: the agent does not query the features of its peers`,
    )
  })
})
