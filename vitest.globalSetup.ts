import { rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * `didwebvh-ts` writes a debug copy of every generated DID log to
 * `./test/logs/<did>.jsonl` whenever `NODE_ENV === "test"` (see its
 * `maybeWriteTestLog` helper). We remove here all existing file
 * automatically after the test run.
 */
const TEST_LOG_DIRS = ['./test/logs', './apps/vs-agent/test/logs', './packages/agent-sdk/test/logs']

export default async function setup() {
  return async function teardown() {
    await Promise.allSettled(
      TEST_LOG_DIRS.map(dir => rm(path.resolve(dir), { recursive: true, force: true })),
    )
  }
}
