import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginCallback } from './LoginCallback';
import { RequireSession } from './RequireSession';

const okta = vi.hoisted(() => ({
  authState: null as { isAuthenticated: boolean } | null,
  signInWithRedirect: vi.fn(async () => {}),
  signOut: vi.fn(async () => true),
  completeSignIn: vi.fn(async () => '/'),
}));

vi.mock('../../lib/auth', () => ({
  useAuthState: () => okta.authState,
  completeSignIn: okta.completeSignIn,
  oktaAuth: { signInWithRedirect: okta.signInWithRedirect, signOut: okta.signOut },
}));

function renderAt(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login/callback" element={<LoginCallback />} />
          <Route element={<RequireSession />}>
            <Route path="/" element={<p>home</p>} />
            <Route path="/w/:wsId" element={<p>workspace page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  okta.authState = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RequireSession', () => {
  it('offers sign-in and remembers where the user was going', () => {
    okta.authState = { isAuthenticated: false };

    renderAt('/w/abc');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Okta' }));

    expect(okta.signInWithRedirect).toHaveBeenCalledWith({ originalUri: '/w/abc' });
  });

  it('provisions the user via /api/me before rendering any page', async () => {
    okta.authState = { isAuthenticated: true };
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'alice@test.dev' }));
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');

    expect(screen.queryByText('home')).toBeNull();
    expect(await screen.findByText('home')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me');
  });

  it('clears the cache before signing out', async () => {
    okta.authState = { isAuthenticated: true };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'alice@test.dev' })));
    const client = renderAt('/');
    await screen.findByText('home');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(okta.signOut).toHaveBeenCalledOnce());
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('LoginCallback', () => {
  it('returns to the page the user started from', async () => {
    okta.authState = { isAuthenticated: true };
    okta.completeSignIn.mockResolvedValueOnce('/w/abc');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'alice@test.dev' })));

    renderAt('/login/callback');

    expect(await screen.findByText('workspace page')).toBeTruthy();
  });

  it('says so when the code exchange fails', async () => {
    okta.completeSignIn.mockRejectedValueOnce(new Error('invalid_grant'));

    renderAt('/login/callback');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Sign-in failed: invalid_grant/);
  });
});
