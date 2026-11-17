import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from '../workspaces/WorkspacePage';
import { BriefPage } from './BriefPage';
import { NewBriefPage } from './NewBriefPage';

const wsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const brief = {
  id: briefId,
  workspaceId: wsId,
  title: 'Spring launch',
  status: 'draft',
  version: 3,
  updatedAt: '2026-11-18T09:00:00.000Z',
  body: 'Five thousand test rides in April.',
  createdAt: '2026-11-18T08:00:00.000Z',
};
const workspace = { id: wsId, name: 'Acme Rotterdam', role: 'editor' };

type Route = { status?: number; json?: unknown };
type Call = { method: string; url: string; body: unknown };

// Answers by "METHOD url"; records what the page sent.
function serve(routes: Record<string, Route>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes[`${method} ${url}`];
      if (!route) return new Response(null, { status: 404 });
      return route.json === undefined ? new Response(null, { status: route.status ?? 204 }) : Response.json(route.json, { status: route.status ?? 200 });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/w/:wsId" element={<WorkspacePage />} />
          <Route path="/w/:wsId/briefs/new" element={<NewBriefPage />} />
          <Route path="/w/:wsId/briefs/:briefId" element={<BriefPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const api = `/api/workspaces/${wsId}`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('brief list', () => {
  it('links each brief and offers "New brief" when the role allows it', async () => {
    serve({ [`GET ${api}`]: { json: workspace }, [`GET ${api}/briefs`]: { json: { briefs: [brief], permissions: { create: true } } } });

    renderAt(`/w/${wsId}`);

    expect((await screen.findByRole('link', { name: 'Spring launch' })).getAttribute('href')).toBe(`/w/${wsId}/briefs/${briefId}`);
    expect(screen.getByRole('link', { name: 'New brief' })).toBeTruthy();
  });

  it('hides "New brief" from a read-only role', async () => {
    serve({ [`GET ${api}`]: { json: { ...workspace, role: 'approver' } }, [`GET ${api}/briefs`]: { json: { briefs: [brief], permissions: { create: false } } } });

    renderAt(`/w/${wsId}`);

    await screen.findByRole('link', { name: 'Spring launch' });
    expect(screen.queryByRole('link', { name: 'New brief' })).toBeNull();
  });
});

describe('creating a brief', () => {
  it('posts the form and opens the new brief', async () => {
    const calls = serve({
      [`POST ${api}/briefs`]: { status: 201, json: { brief, permissions: { edit: true, delete: false } } },
      [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: true, delete: false } } },
    });
    renderAt(`/w/${wsId}/briefs/new`);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Spring launch' } });
    fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'Five thousand test rides in April.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));

    expect(await screen.findByRole('heading', { name: 'Spring launch' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Spring launch', body: 'Five thousand test rides in April.' });
  });
});

describe('editing a brief', () => {
  it('saves with the version it started from', async () => {
    const calls = serve({
      [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: true, delete: false } } },
      [`PUT ${api}/briefs/${briefId}`]: { json: { brief: { ...brief, title: 'Spring launch v2', version: 4 }, permissions: { edit: true, delete: false } } },
    });
    renderAt(`/w/${wsId}/briefs/${briefId}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Spring launch v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Spring launch v2' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ title: 'Spring launch v2', body: brief.body, version: 3 });
  });

  it('keeps the version it started from even if a background refetch brings a newer one', async () => {
    const calls = serve({
      [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: true, delete: false } } },
      [`PUT ${api}/briefs/${briefId}`]: { status: 409, json: { error: 'conflict' } },
    });
    const client = renderAt(`/w/${wsId}/briefs/${briefId}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // Someone else saved v4 and a refetch (window focus, staleTime) put it in the cache mid-edit.
    client.setQueryData(['ws', wsId, 'briefs', briefId], { brief: { ...brief, version: 4 }, permissions: { edit: true, delete: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Someone else changed this brief/);
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ version: 3 });
  });

  it('explains a conflict and keeps what the user typed', async () => {
    serve({
      [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: true, delete: false } } },
      [`PUT ${api}/briefs/${briefId}`]: { status: 409, json: { error: 'conflict' } },
    });
    renderAt(`/w/${wsId}/briefs/${briefId}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'My unsaved rewrite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Someone else changed this brief/);
    expect((screen.getByLabelText('Brief') as HTMLTextAreaElement).value).toBe('My unsaved rewrite');
  });

  it('shows no edit or delete controls to a read-only role', async () => {
    serve({ [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: false, delete: false } } } });

    renderAt(`/w/${wsId}/briefs/${briefId}`);

    expect(await screen.findByText(brief.body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('deleting a brief', () => {
  it('asks first, then deletes and returns to the list', async () => {
    const calls = serve({
      [`GET ${api}/briefs/${briefId}`]: { json: { brief, permissions: { edit: true, delete: true } } },
      [`DELETE ${api}/briefs/${briefId}`]: { status: 204 },
      [`GET ${api}`]: { json: { ...workspace, role: 'admin' } },
      [`GET ${api}/briefs`]: { json: { briefs: [], permissions: { create: true } } },
    });
    renderAt(`/w/${wsId}/briefs/${briefId}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(await screen.findByText('No briefs yet.')).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
  });
});

describe('a brief that is not visible', () => {
  it('shows not found', async () => {
    serve({});

    renderAt(`/w/${wsId}/briefs/${briefId}`);

    expect((await screen.findByRole('alert')).textContent).toBe('Brief not found.');
  });
});
