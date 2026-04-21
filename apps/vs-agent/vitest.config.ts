import { existsSync } from 'fs'
/* eslint-disable import/no-unresolved */
import { defineConfig, mergeConfig } from 'vitest/config'

import rootConfig from '../../vitest.config'

const setup = 'tests/__mocks__/global-setup.ts'
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      setupFiles: existsSync(setup) ? [setup] : [],
      include: ['tests/**/*.test.ts'],
      reporters: ['verbose'],
      outputFile: './test-results.json',
      // askar-nodejs native bindings race when multiple test files
      // instantiate Credo agents concurrently; serialise test files.
      fileParallelism: false,
    },
  }),
)
