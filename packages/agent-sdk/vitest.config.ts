/* eslint-disable import/no-unresolved */
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, '**/*.e2e.test.ts'],
    },
  }),
)
