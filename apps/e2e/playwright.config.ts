import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: {
    command: "npm run -w apps/renderer dev",
    cwd: "../..",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
