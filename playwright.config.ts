import { defineConfig, devices } from "@playwright/test";

const desktopSystemViewport = {
  defaultBrowserType: devices["Desktop Chrome"].defaultBrowserType,
  userAgent: devices["Desktop Chrome"].userAgent,
  isMobile: false,
  hasTouch: false,
};

// Next loads .env for the app, but the Playwright process does not, so the
// staff sign-in credentials would be missing and every authenticated spec
// would silently skip.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env (CI passes real environment variables instead).
}

// PLAYWRIGHT_BASE_URL wins so the suite can be pointed at an already-running
// dev server on another port (next dev moves off 3000 when it is taken).
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  // Specs share database fixtures and stock, so run workflows sequentially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Headed runs are watched by a person. PW_SLOW_MO puts a pause between
    // actions so a flow can actually be followed instead of flashing past;
    // unset (CI, and any headless run) it costs nothing.
    launchOptions: {
      slowMo: Number(process.env.PW_SLOW_MO) || 0,
      ...(process.env.PW_MAXIMIZED === "1"
        ? { args: ["--window-position=0,0", "--window-size=1920,1080"] }
        : {}),
    },
  },
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...(process.env.PW_MAXIMIZED === "1"
          ? { ...desktopSystemViewport, viewport: null }
          : devices["Desktop Chrome"]),
      },
    },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
