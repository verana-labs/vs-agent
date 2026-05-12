import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    clearMocks: true,
    globalSetup: [path.resolve(__dirname, "vitest.globalSetup.ts")],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      exclude: ["build", "node_modules", "__tests__", "tests"],
    },
    include: ["**/?(*.)+(spec|test).[tj]s?(x)"],
    root: "./",
  },
});