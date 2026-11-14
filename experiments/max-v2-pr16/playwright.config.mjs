import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const labDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: /browser-lab\.spec\.mjs$/,
  timeout: 100_000,
  expect: { timeout: 35_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://127.0.0.1:3236", trace: "on-first-retry" },
  projects: [
    { name: "chromium-lab", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-lab", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    cwd: labDirectory,
    url: "http://127.0.0.1:3236/index.html",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
