import { OktaAuth, type AccessToken } from '@okta/okta-auth-js/core';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { safeReturnPath } from './returnTo';

const env = z
  .object({ VITE_OKTA_ISSUER: z.url(), VITE_OKTA_CLIENT_ID: z.string().min(1) })
  .parse(import.meta.env);

let returnTo = '/';

export const oktaAuth = new OktaAuth({
  issuer: env.VITE_OKTA_ISSUER,
  clientId: env.VITE_OKTA_CLIENT_ID,
  redirectUri: `${window.location.origin}/login/callback`,
  postLogoutRedirectUri: window.location.origin,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  pkce: true,
  // The UI cache uses the same issuer and uid as the API when an access token rotates.
  decodeAccessTokens: true,
  // Passive auth-state checks run in every tab. Leave expiration handling to the elected SDK service.
  tokenManager: { storage: 'localStorage', autoRenew: false, autoRemove: false },
  storageManager: { transaction: { storageTypes: ['sessionStorage'] } },
  transactionManager: { enableSharedStorage: false },
  // Only the elected tab should renew a rotating refresh token, including after a tab regains focus.
  services: { syncStorage: true, autoRenew: true, autoRemove: true, renewOnTabActivation: false },
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

export function sessionKey(token: AccessToken | undefined) {
  const claims = token?.claims;
  return typeof claims?.iss === 'string' && typeof claims.uid === 'string'
    ? JSON.stringify([claims.iss, claims.uid])
    : undefined;
}
