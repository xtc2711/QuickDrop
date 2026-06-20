import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // 模拟 bcrypt 以加速测试
    pool: "forks",
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
});
