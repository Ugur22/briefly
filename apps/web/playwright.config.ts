import { defineConfig } from '@playwright/test';

// Its own port, so a real dev session on :5173 (its localStorage and Okta tokens) can't leak in.
const PORT = 5174;
const baseURL = `http://127.0.0.1:${PORT}`;

// Screenshots of every screen for design review. Offline: Okta points at a host that doesn't exist and
// every /api call is answered in the browser (e2e/mockApi.ts).
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL, locale: 'en-GB', timezoneId: 'Europe/Amsterdam', colorScheme: 'light' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 400, height: 860 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `bunx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    // Process env beats .env in Vite, so the real tenant never ends up in this bundle.
    env: { VITE_OKTA_ISSUER: 'https://okta.invalid/oauth2/default', VITE_OKTA_CLIENT_ID: 'visual-check' },
  },
});
