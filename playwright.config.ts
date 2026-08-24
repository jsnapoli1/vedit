import { defineConfig, devices } from '@playwright/test'

/**
 * The browser is pinned by the `@playwright/test` version, so a screenshot taken
 * on one machine is comparable on another running the same version. Font
 * rasterisation still differs between operating systems — CI runs this suite in
 * the matching Playwright container for that reason, and the baselines are
 * regenerated there if they ever disagree.
 */
/** Wide enough for both panels and a readable canvas between them. */
export const VIEWPORT = { width: 1440, height: 900 }

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Absorbs anti-aliasing noise without hiding a real layout change.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:5178',
    trace: 'retain-on-failure',
    // Point at a browser that is already on disk, when there is one.
    launchOptions: process.env.VEDIT_CHROMIUM ? { executablePath: process.env.VEDIT_CHROMIUM } : {},
  },
  projects: [
    {
      name: 'chromium',
      // Set after the device preset so this is the one viewport that decides
      // what the baselines look like.
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
  webServer: {
    command: 'npm run dev --prefix example -- --port 5178 --strictPort',
    url: 'http://localhost:5178',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
