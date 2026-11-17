import { OktaAuth } from '@okta/okta-auth-js/core';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { safeReturnPath } from './returnTo';

const env = z
  .object({ VITE_OKTA_ISSUER: z.url(), VITE_OKTA_CLIENT_ID: z.string().min(1) })
  .parse(import.meta.env);

let returnTo = '/';

// PKCE, no client secret. sessionStorage survives reloads but not the tab; refresh tokens rotate on every use,
// so a stolen one is spent the moment the real session renews.
export const oktaAuth = new OktaAuth({
  issuer: env.VITE_OKTA_ISSUER,
  clientId: env.VITE_OKTA_CLIENT_ID,
  redirectUri: `${window.location.origin}/login/callback`,
  postLogoutRedirectUri: window.location.origin,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  pkce: true,
  tokenManager: { storage: 'sessionStorage', autoRenew: true },
  // Okta deletes the stored URI before calling this, so this is the only place to read it.
  // The callback route then navigates inside the router instead of reloading the page.
  restoreOriginalUri: async (_auth, originalUri) => {
    returnTo = safeReturnPath(originalUri);
  },
});

// The authorization code is single-use and StrictMode runs effects twice, so exchange it once per page load.
let exchange: Promise<string> | null = null;
export function completeSignIn(): Promise<string> {
  exchange ??= oktaAuth.handleLoginRedirect().then(() => returnTo);
  return exchange;
}

function subscribe(onChange: () => void) {
  oktaAuth.authStateManager.subscribe(onChange);
  return () => oktaAuth.authStateManager.unsubscribe(onChange);
}

export function useAuthState() {
  return useSyncExternalStore(subscribe, () => oktaAuth.authStateManager.getAuthState());
}
