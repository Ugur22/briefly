import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, LogOut } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { fetchMe, fetchWorkspaces } from '../../lib/api';
import { oktaAuth, useAuthState } from '../../lib/auth';
import { queryKeys } from '../../lib/queryKeys';
import { HealthStatus } from '../health/HealthStatus';

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold text-ink">
      <FileText size={18} strokeWidth={1.5} className="text-accent" aria-hidden />
      Briefly
    </span>
  );
}

function Sidebar({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: fetchWorkspaces });

  // Below md the sidebar folds into a top bar: wordmark and sign out on one row, workspaces as a scrolling row
  // under it. Grid placement moves the same elements, so there is one sign-out button at every width.
  return (
    <aside className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-line bg-sunken px-4 py-3 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:items-stretch md:gap-6 md:border-r md:border-b-0 md:px-3 md:pt-5 md:pb-4">
      <NavLink to="/" className="hover:no-underline md:px-2">
        <Wordmark />
      </NavLink>

      <nav aria-label="Workspaces" className="col-span-2 row-start-2 -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:grid md:gap-0.5 md:overflow-visible md:px-0">
        <p className="hidden px-2 pb-2 text-xs text-muted md:block">Workspaces</p>
        {workspaces.data?.map((ws) => (
          <NavLink
            key={ws.id}
            to={`/w/${ws.id}`}
            className={({ isActive }) =>
              `flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-control px-3 transition-colors duration-150 ease-out md:h-9 md:max-w-none md:px-2 ${
                isActive ? 'bg-accent-soft text-accent font-medium inset-ring inset-ring-line shadow-[inset_3px_0_var(--color-focus)]' : 'text-ink-2 hover:bg-accent-soft'
              }`
            }
          >
            <span className="truncate">{ws.name}</span>
            <span className="meta ml-auto hidden md:inline">{ws.role}</span>
          </NavLink>
        ))}
      </nav>

      <div className="col-start-2 row-start-1 md:mt-auto md:grid md:gap-2 md:border-t md:border-line md:px-2 md:pt-3">
        <p className="hidden truncate text-ink-2 md:block" title={email}>
          {email}
        </p>
        <div className="hidden md:block">
          <HealthStatus />
        </div>
        <button type="button" className="btn btn-ghost w-fit px-2 md:-ml-2" onClick={onSignOut}>
          <LogOut size={16} strokeWidth={1.5} aria-hidden />
          Sign out
        </button>
      </div>
    </aside>
  );
}

// Everything inside needs a session and a provisioned user, so /api/me always runs before any workspace call.
export function RequireSession() {
  const authState = useAuthState();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = authState?.isAuthenticated === true;
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, enabled: signedIn && !signingOut });

  if (signingOut) return <p className="p-8 text-muted">Signing out…</p>;
  if (!authState) return <p className="p-8 text-muted">Loading…</p>;

  if (!signedIn) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="card grid w-full max-w-sm gap-4 p-8">
          <Wordmark />
          <h1 className="text-xl font-medium">Review client briefs before work starts</h1>
          <p className="text-ink-2">Sign in with your agency account to see your workspaces.</p>
          <button type="button" className="btn btn-primary justify-center" onClick={() => oktaAuth.signInWithRedirect({ originalUri: location.pathname })}>
            Sign in with Okta
          </button>
        </div>
      </main>
    );
  }

  if (me.isPending) return <p className="p-8 text-muted">Setting up your account…</p>;
  if (me.isError) return <p role="alert" className="alert m-8">Could not load your account.</p>;

  // Unmount the data views first so nothing refetches into the cache we're about to clear.
  const signOut = async () => {
    setSigningOut(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    await oktaAuth.signOut();
  };

  return (
    // content-start: on mobile a short page would otherwise stretch the top bar to fill min-h-screen.
    <div className="grid min-h-screen content-start md:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar email={me.data.email} onSignOut={signOut} />
      <main className="w-full max-w-[1240px] px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
