import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:3020",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      OTP_PEPPER: "test-pepper-test-pepper-test-pepper-0123456789",
      DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
