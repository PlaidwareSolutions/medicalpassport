import { configDefaults, defineConfig } from "vitest/config";

// Tests live beside the code they cover (src/**/*.test.ts) and are compiled
// by tsc like the rest of src — so dist/ holds emitted copies that must
// never run a second time.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
