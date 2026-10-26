import { defineConfig } from "vitest/config";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000, fileParallelism: false },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
