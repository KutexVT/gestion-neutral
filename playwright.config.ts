import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 8000 },
  reporter: "list",
  outputDir: "test-artifacts/browser",
  use: {
    baseURL: "http://localhost:3183",
    headless: true,
    actionTimeout: 10000,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "node --import tsx tests/ui-server.ts",
    url: "http://localhost:3183/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
