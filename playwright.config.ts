import { defineConfig, devices } from "@playwright/test";

const remoteOrigin = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  // Trusted wheel cadence tests must not compete with axe scans for CPU time.
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: remoteOrigin ?? "http://127.0.0.1:8787", trace: "retain-on-failure" },
  webServer: remoteOrigin
    ? undefined
    : {
        command: process.env.CI
          ? "pnpm exec wrangler dev --ip 127.0.0.1 --port 8787"
          : "pnpm preview",
        url: "http://127.0.0.1:8787",
        reuseExistingServer: !process.env.CI
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
