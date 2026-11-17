import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BriefPage } from './BriefPage';
import { NewBriefPage } from './NewBriefPage';

const wsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const api = `/api/workspaces/${wsId}`;
const brief = {
  id: briefId,
  workspaceId: wsId,
  title: 'Spring launch',
  status: 'draft',
  version: 1,
  updatedAt: '2026-11-18T09:00:00.000Z',
  body: 'Five thousand test rides.',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: { name: 'Spring launch.pdf', mime: 'application/pdf', size: 250_000 },
  submittedBy: null,
  submittedAt: null,
  decidedAt: null,
  decisionComment: null,
};
const permissions = { edit: true, delete: false, submit: true, decide: false };

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/w/:wsId/briefs/new" element={<NewBriefPage />} />
          <Route path="/w/:wsId/briefs/:briefId" element={<BriefPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pdf = (bytes = 10) => new File([new Uint8Array(bytes)], 'Spring launch.pdf', { type: 'application/pdf' });

function chooseUpload(file: File, title?: string) {
  fireEvent.click(screen.getByLabelText('Upload a file'));
  fireEvent.change(screen.getByLabelText(/^File/), { target: { files: [file] } });
  if (title) fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: title } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('uploading a brief', () => {
  it('posts the file and title as multipart, then opens the new brief', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${api}/briefs/upload` && init?.method === 'POST') return Response.json({ brief, permissions }, { status: 201 });
      return Response.json({ brief, permissions });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt(`/w/${wsId}/briefs/new`);

    chooseUpload(pdf(), 'Q3 launch');
    fireEvent.click(screen.getByRole('button', { name: 'Upload brief' }));

    expect(await screen.findByRole('heading', { name: 'Spring launch' })).toBeTruthy();
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('title')).toBe('Q3 launch');
    expect((body.get('file') as File).name).toBe('Spring launch.pdf');
    // The browser must set the multipart boundary itself.
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it.each([
    [422, 'no_text', /No text found/],
    [415, 'unsupported_type', /Only PDF and Word/],
    [503, 'busy', /Try again in a moment/],
  ])('explains a %i %s refusal', async (status, error, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error }, { status })));
    renderAt(`/w/${wsId}/briefs/new`);

    chooseUpload(pdf());
    fireEvent.click(screen.getByRole('button', { name: 'Upload brief' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(message);
  });

  it('stops a file over 10 MB before sending it', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderAt(`/w/${wsId}/briefs/new`);

    chooseUpload(pdf(10 * 1024 * 1024 + 1));

    expect(screen.getByRole('alert').textContent).toMatch(/over 10 MB/);
    expect((screen.getByRole('button', { name: 'Upload brief' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloading the original', () => {
  it('fetches it with the token in a header and hands it to the browser as a file', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/source') ? new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } }) : Response.json({ brief, permissions }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:local');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt(`/w/${wsId}/briefs/${briefId}`);

    expect(await screen.findByText('Spring launch.pdf')).toBeTruthy();
    expect(screen.getByText('244 KB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`${api}/briefs/${briefId}/source`, expect.anything());
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('shows no download for a pasted brief', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ brief: { ...brief, source: null }, permissions })));
    renderAt(`/w/${wsId}/briefs/${briefId}`);

    await screen.findByRole('heading', { name: 'Spring launch' });
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});
