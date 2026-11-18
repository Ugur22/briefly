import type { Page } from '@playwright/test';
import { PINNED } from './fixtures/workspaces';

export const OKTA_HOST = 'okta.invalid';

// okta-auth-js trusts its own storage on load: a stored access and id token that haven't expired mean
// "signed in". No signature check happens outside the redirect exchange, which these tests never run.
// expiresAt is in seconds. The API is mocked, so these strings never reach anything that verifies them.
export async function seedSession(page: Page, origin: string) {
  const expiresAt = Math.floor(PINNED.getTime() / 1000) + 3600;
  const tokens = JSON.stringify({
    accessToken: { accessToken: 'fake-access', claims: { iss: 'https://okta.invalid/oauth2/default', uid: 'visual-user' }, expiresAt },
    idToken: { idToken: 'fake-id', expiresAt },
  });
  await page.addInitScript(
    ({ origin, tokens }) => {
      // Init scripts run in every frame; only the app's own origin gets the tokens.
      if (location.origin !== origin) return;
      try {
        localStorage.setItem('okta-token-storage', tokens);
      } catch {
        // about:blank and sandboxed frames refuse storage access.
      }
    },
    { origin, tokens },
  );
}

// Fixed before the first navigation, so okta's expiry check on start() sees live tokens. Only Date is pinned;
// timers keep running, so okta's own timers and the review poll behave normally.
export async function pinClock(page: Page) {
  await page.clock.setFixedTime(PINNED);
}
