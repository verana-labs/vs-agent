import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    clearMocks: true,
    globalSetup: [path.resolve(dirname, "vitest.globalSetup.ts")],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      exclude: ["build", "node_modules", "__tests__", "tests"],
    },
    include: ["**/?(*.)+(spec|test).[tj]s?(x)"],
    root: "./",
  },
});