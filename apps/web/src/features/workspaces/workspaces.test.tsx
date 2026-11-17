import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceList } from './WorkspaceList';
import { WorkspacePage } from './WorkspacePage';

const acme = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme Rotterdam', role: 'admin' };

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<WorkspaceList />} />
          <Route path="/w/:wsId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspaces', () => {
  it('lists the workspaces the API returns, linked by id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ workspaces: [acme] })));

    renderAt('/');

    const link = await screen.findByRole('link', { name: 'Acme Rotterdam' });
    expect(link.getAttribute('href')).toBe(`/w/${acme.id}`);
  });

  it('explains an empty list instead of showing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ workspaces: [] })));

    renderAt('/');

    expect(await screen.findByText(/not in any workspace/)).toBeTruthy();
  });

  it('shows a workspace the user belongs to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(acme)));

    renderAt(`/w/${acme.id}`);

    expect(await screen.findByRole('heading', { name: 'Acme Rotterdam' })).toBeTruthy();
  });

  it('shows not found for a workspace the API hides', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not found' }, { status: 404 })));

    renderAt('/w/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Workspace not found/);
  });
});
