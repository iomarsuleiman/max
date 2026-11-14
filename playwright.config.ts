import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(?:mobile|editor-baseline)\.spec\.ts/ },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" }, testMatch: /(?:mobile|editor-baseline)\.spec\.ts/ },
  ],
  webServer: {
    command: `rm -rf .e2e-data && pnpm build && pnpm start --port ${PORT}`,
    port: PORT,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { MAX_LOCAL_MODE: "true", MAX_DATA_DIR: ".e2e-data", NEXT_PUBLIC_CONVEX_URL: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" },
  },
});
