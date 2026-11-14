import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:".",testMatch:/live\.spec\.mjs$/,timeout:180000,
  expect:{timeout:40000},workers:1,fullyParallel:false,retries:0,
  reporter:[["list"],["json",{outputFile:"pr19-live-evidence.json"}]],
  use:{...devices["Desktop Chrome"],trace:"retain-on-failure"},
});