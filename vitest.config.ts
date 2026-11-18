import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const r = (p: string) => resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      "@arcade/core": r("packages/core/src/index.ts"),
      "@arcade/ui": r("packages/ui/src/index.ts"),
      "@arcade/registry": r("packages/registry/src/index.ts"),
      "@styles": r("packages/styles/src"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "games/**/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
