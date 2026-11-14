import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:".",testMatch:/live-cloud\.spec\.mjs$/,timeout:300000,
  expect:{timeout:45000},workers:1,fullyParallel:false,retries:0,
  reporter:[["list"],["json",{outputFile:"pr22-cloud-evidence.json"}]],
  use:{...devices["Desktop Chrome"],trace:"retain-on-failure"},
});
