import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["temp-clawhub-skills/**", ".clawhub/**", "node_modules/**", "dist/**"],
  },
});
