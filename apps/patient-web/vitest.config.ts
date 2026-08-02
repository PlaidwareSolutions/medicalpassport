import { defineConfig } from "vitest/config";

// e2e/*.spec.ts are Playwright suites with their own runner; vitest owns
// only the unit tests beside the code they cover.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
  },
});
