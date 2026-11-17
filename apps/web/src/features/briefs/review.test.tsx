import { REVIEW_AREAS } from '@briefly/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';

const wsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const briefId = 'b1ef0000-0000-4000-8000-000000000001';
const url = `/api/workspaces/${wsId}/briefs/${briefId}/review`;
const review = {
  summary: 'Clear goal, budget missing.',
  areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: a === 'budget' ? 'missing' : 'present', note: `${a} note` }])),
  questions: ['What is the budget?'],
  risks: ['Launch date unrealistic'],
};
const stored = (over: Record<string, unknown> = {}) => ({
  state: 'succeeded',
  review,
  briefVersion: 2,
  outdated: false,
  error: null,
  model: 'claude-opus-5-5',
  generatedAt: '2026-11-18T10:00:00.000Z',
  editedAt: null,
  ...over,
});
const allowed = { generate: true, edit: true };

function serve(handler: (method: string, body: unknown) => Response) {
  const calls: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      return u === url ? handler(method, body) : new Response(null, { status: 404 });
    }),
  );
  return calls;
}

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReviewPanel wsId={wsId} briefId={briefId} briefVersion={2} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReviewPanel', () => {
  it('generates a review and shows every area, the questions and the risks', async () => {
    serve((method) => Response.json(method === 'POST' ? { review: stored(), permissions: allowed } : { review: null, permissions: allowed }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate AI review' }));

    expect(await screen.findByText('Clear goal, budget missing.')).toBeTruthy();
    expect(screen.getByRole('row', { name: /Budget Missing budget note/ })).toBeTruthy();
    expect(screen.getByText('What is the budget?')).toBeTruthy();
    expect(screen.getByText('Launch date unrealistic')).toBeTruthy();
  });

  it('labels the offline fallback honestly', async () => {
    serve(() => Response.json({ review: stored({ model: 'fake' }), permissions: allowed }));
    renderPanel();

    expect(await screen.findByText(/Offline fallback review/)).toBeTruthy();
  });

  it('warns when the brief changed after the review, and offers no edit', async () => {
    serve(() => Response.json({ review: stored({ outdated: true }), permissions: allowed }));
    renderPanel();

    expect(await screen.findByRole('note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit review' })).toBeNull();
  });

  it('explains a failed generation', async () => {
    serve(() => Response.json({ review: stored({ state: 'failed', review: null, error: 'refused' }), permissions: allowed }));
    renderPanel();

    expect((await screen.findByRole('alert')).textContent).toMatch(/declined/);
  });

  it('explains that AI is unavailable', async () => {
    serve((method) => (method === 'POST' ? Response.json({ error: 'ai_unavailable' }, { status: 503 }) : Response.json({ review: null, permissions: allowed })));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate AI review' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/not available/);
  });

  it('saves an edit against the brief version it was made on', async () => {
    const calls = serve((method, body) =>
      Response.json({ review: method === 'PUT' ? stored({ review: (body as { review: unknown }).review, editedAt: '2026-11-18T10:05:00.000Z' }) : stored(), permissions: allowed }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit review' }));
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Edited summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    expect(await screen.findByText('Edited summary')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ briefVersion: 2, review: { summary: 'Edited summary' } });
  });

  it('shows the previous review after a failed regenerate, instead of losing it', async () => {
    serve(() => Response.json({ review: stored({ state: 'failed', error: 'timeout' }), permissions: allowed }));
    renderPanel();

    expect((await screen.findByRole('alert')).textContent).toMatch(/took too long.*previous review is shown/);
    expect(screen.getByText('Clear goal, budget missing.')).toBeTruthy();
  });

  it('says a generation is running elsewhere, and offers no second one', async () => {
    serve(() => Response.json({ review: stored({ state: 'pending' }), permissions: allowed }));
    renderPanel();

    expect((await screen.findByRole('status')).textContent).toMatch(/being generated/);
    expect(screen.queryByRole('button', { name: 'Regenerate review' })).toBeNull();
  });

  it('asks before regenerating over a review the team edited', async () => {
    const calls = serve(() => Response.json({ review: stored({ editedAt: '2026-11-18T10:05:00.000Z' }), permissions: allowed }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate review' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate anyway' }));

    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  });

  it('shows read-only roles the review without buttons', async () => {
    serve(() => Response.json({ review: stored(), permissions: { generate: false, edit: false } }));
    renderPanel();

    await screen.findByText('Clear goal, budget missing.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
