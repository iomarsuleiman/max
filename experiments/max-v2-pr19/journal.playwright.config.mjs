import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:".",
  testMatch:/journal\.spec\.mjs$/,
  timeout:90000,fullyParallel:false,workers:1,
  reporter:process.env.CI?[["github"],["list"]]:"list",
  use:{baseURL:"http://127.0.0.1:3238",trace:"on-first-retry"},
  projects:[
    {name:"chromium-journal",use:{...devices["Desktop Chrome"]}},
    {name:"webkit-journal",use:{...devices["Desktop Safari"]}},
  ],
  webServer:{
    command:"npm run dev --prefix experiments/max-v2-pr18",
    url:"http://127.0.0.1:3238/journal-test.html",
    timeout:180000,reuseExistingServer:!process.env.CI,
  },
});