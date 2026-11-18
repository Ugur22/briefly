import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, configureApi, downloadBriefSource, fetchWorkspaces } from './api';

const ws = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', role: 'admin' };

afterEach(() => {
  vi.unstubAllGlobals();
  configureApi({ getSessionSnapshot: () => ({ accessToken: undefined }), onUnauthorized: () => {} });
});

describe('api client', () => {
  it('sends the access token as a bearer header', async () => {
    const fetchMock = vi.fn(async () => Response.json({ workspaces: [ws] }));
    vi.stubGlobal('fetch', fetchMock);
    const getSessionSnapshot = vi.fn(() => ({ accessToken: 'tok', sessionKey: 'account' }));
    configureApi({ getSessionSnapshot, onUnauthorized: () => {} });

    const pending = fetchWorkspaces();
    expect(getSessionSnapshot).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual([ws]);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', {
      headers: { Accept: 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('reports a 401 so the session can be dropped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const onUnauthorized = vi.fn();
    configureApi({ getSessionSnapshot: () => ({ accessToken: 'expired' }), onUnauthorized });

    await expect(fetchWorkspaces()).rejects.toEqual(new ApiError(401));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('ignores a 401 for a token renewed within the same session', async () => {
    let token = 'old';
    const onUnauthorized = vi.fn();
    configureApi({ getSessionSnapshot: () => ({ accessToken: token, sessionKey: 'session' }), onUnauthorized });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));

    const pending = fetchWorkspaces();
    token = 'renewed';
    await expect(pending).rejects.toEqual(new ApiError(401));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('discards a response when the token changes without a session key', async () => {
    let token = 'old';
    configureApi({ getSessionSnapshot: () => ({ accessToken: token }), onUnauthorized: vi.fn() });
    vi.stubGlobal('fetch', async () => Response.json({ workspaces: [ws] }));

    const pending = fetchWorkspaces();
    token = 'new';
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['json', 'blob', '401'] as const)('checks the session after reading the %s body', async kind => {
    let session = 'original';
    const onUnauthorized = vi.fn();
    configureApi({ getSessionSnapshot: () => ({ accessToken: 'token', sessionKey: session }), onUnauthorized });
    const response = Response.json({ workspaces: [ws] }, { status: kind === '401' ? 401 : 200 });
    const method = kind === 'blob' ? 'blob' : 'json';
    const read = response[method].bind(response);
    vi.spyOn(response, method).mockImplementation(async () => {
      const result = await read();
      session = 'replacement';
      return result;
    });
    vi.stubGlobal('fetch', async () => response);

    const pending = kind === 'blob' ? downloadBriefSource('ws', 'brief') : fetchWorkspaces();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not treat other errors as a lost session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const onUnauthorized = vi.fn();
    configureApi({ getSessionSnapshot: () => ({ accessToken: 'tok' }), onUnauthorized });

    await expect(fetchWorkspaces()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('rejects a workspace with a role the contract does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ workspaces: [{ ...ws, role: 'owner' }] })));

    await expect(fetchWorkspaces()).rejects.toThrow();
  });
});
