import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, configureApi, fetchWorkspaces } from './api';

const ws = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', role: 'admin' };

afterEach(() => {
  vi.unstubAllGlobals();
  configureApi({ getAccessToken: () => undefined, onUnauthorized: () => {} });
});

describe('api client', () => {
  it('sends the access token as a bearer header', async () => {
    const fetchMock = vi.fn(async () => Response.json({ workspaces: [ws] }));
    vi.stubGlobal('fetch', fetchMock);
    configureApi({ getAccessToken: () => 'tok', onUnauthorized: () => {} });

    await expect(fetchWorkspaces()).resolves.toEqual([ws]);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', {
      headers: { Accept: 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('reports a 401 so the session can be dropped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const onUnauthorized = vi.fn();
    configureApi({ getAccessToken: () => 'expired', onUnauthorized });

    await expect(fetchWorkspaces()).rejects.toEqual(new ApiError(401));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not treat other errors as a lost session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const onUnauthorized = vi.fn();
    configureApi({ getAccessToken: () => 'tok', onUnauthorized });

    await expect(fetchWorkspaces()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('rejects a workspace with a role the contract does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ workspaces: [{ ...ws, role: 'owner' }] })));

    await expect(fetchWorkspaces()).rejects.toThrow();
  });
});
