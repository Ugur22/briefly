import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { fetchMe } from '../../lib/api';
import { oktaAuth, useAuthState } from '../../lib/auth';
import { queryKeys } from '../../lib/queryKeys';

// Everything inside needs a session and a provisioned user, so /api/me always runs before any workspace call.
export function RequireSession() {
  const authState = useAuthState();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = authState?.isAuthenticated === true;
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, enabled: signedIn && !signingOut });

  if (signingOut) return <p>Signing out…</p>;
  if (!authState) return <p>Loading…</p>;

  if (!signedIn) {
    return (
      <main>
        <h1>Briefly</h1>
        <button type="button" onClick={() => oktaAuth.signInWithRedirect({ originalUri: location.pathname })}>
          Sign in with Okta
        </button>
      </main>
    );
  }

  if (me.isPending) return <p>Setting up your account…</p>;
  if (me.isError) return <p role="alert">Could not load your account.</p>;

  // Unmount the data views first so nothing refetches into the cache we're about to clear.
  const signOut = async () => {
    setSigningOut(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    await oktaAuth.signOut();
  };

  return (
    <>
      <header>
        <strong>Briefly</strong> · {me.data.email}{' '}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
