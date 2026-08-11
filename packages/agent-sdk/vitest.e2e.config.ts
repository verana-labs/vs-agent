import path from 'node:path'
/* eslint-disable import/no-unresolved */
import { configDefaults, defineConfig } from 'vitest/config'

// Standalone rather than merged with the base config: mergeConfig concatenates `include`,
// which would drag the unit specs into the e2e run.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    clearMocks: true,
    globalSetup: [path.resolve(__dirname, '../../vitest.globalSetup.ts')],
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
    root: './',
  },
})
