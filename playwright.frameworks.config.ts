import { defineConfig, devices } from '@playwright/test'

/**
 * Separate from playwright.config.ts on purpose. That suite is the deep one and
 * owns the screenshot baselines; this one runs the same short spec against each
 * framework's *production* build, so what it exercises is the bundle a consumer
 * installs rather than a dev server's transform.
 */
const FRAMEWORKS = [
  {
    name: 'next-app',
    port: 5191,
    command: 'npm run build --prefix examples/next-app && npm start --prefix examples/next-app -- --port 5191',
  },
  {
    name: 'next-pages',
    port: 5192,
    command: 'npm run build --prefix examples/next-pages && npm start --prefix examples/next-pages -- --port 5192',
  },
  {
    name: 'remix',
    port: 5193,
    // remix-serve takes the port from the environment; it ignores --port.
    command: 'npm run build --prefix examples/remix && PORT=5193 npm start --prefix examples/remix',
  },
  {
    name: 'astro',
    port: 5194,
    command: 'npm run build --prefix examples/astro && npm start --prefix examples/astro -- --port 5194',
  },
]

export default defineConfig({
  testDir: './e2e-frameworks',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    launchOptions: process.env.VEDIT_CHROMIUM ? { executablePath: process.env.VEDIT_CHROMIUM } : {},
  },
  projects: FRAMEWORKS.map((framework) => ({
    name: framework.name,
    use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${framework.port}` },
  })),
  webServer: FRAMEWORKS.map((framework) => ({
    command: framework.command,
    url: `http://localhost:${framework.port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  })),
})
