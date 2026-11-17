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

  return (
    <aside className="flex flex-col gap-6 border-line bg-sunken px-3 pt-5 pb-4 md:sticky md:top-0 md:h-screen md:border-r">
      <NavLink to="/" className="px-2 hover:no-underline">
        <Wordmark />
      </NavLink>

      <nav aria-label="Workspaces" className="grid gap-0.5">
        <p className="px-2 pb-2 text-xs text-muted">Workspaces</p>
        {workspaces.data?.map((ws) => (
          <NavLink
            key={ws.id}
            to={`/w/${ws.id}`}
            className={({ isActive }) =>
              `flex h-9 items-center gap-2.5 rounded-control px-2 transition-colors duration-150 ease-out ${
                isActive ? 'bg-surface text-ink shadow-small' : 'text-ink-2 hover:bg-line'
              }`
            }
          >
            <span className="truncate">{ws.name}</span>
            <span className="meta ml-auto">{ws.role}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto grid gap-2 border-t border-line px-2 pt-3">
        <p className="truncate text-ink-2" title={email}>
          {email}
        </p>
        <HealthStatus />
        <button type="button" className="btn btn-ghost -ml-2 w-fit px-2" onClick={onSignOut}>
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
    <div className="grid min-h-screen md:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar email={me.data.email} onSignOut={signOut} />
      <main className="w-full max-w-[1240px] px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
