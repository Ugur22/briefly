import { Me, REVIEW_AREAS } from '@briefly/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
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

const author = Me.parse({ id: '00000000-0000-4000-8000-000000000001', email: 'author@example.test' });
const teammate = Me.parse({ id: '00000000-0000-4000-8000-000000000002', email: 'teammate@example.test' });

function renderPanel(account = author, onEditingChange?: (editing: boolean) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.me, account);
  return render(
    <QueryClientProvider client={client}>
      <ReviewPanel wsId={wsId} briefId={briefId} briefVersion={2} onEditingChange={onEditingChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
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

  it('tells the page while review edits are open, so it can hold back Submit', async () => {
    serve(() => Response.json({ review: stored(), permissions: allowed }));
    const onEditingChange = vi.fn();
    renderPanel(author, onEditingChange);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit review' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a draft restored after a reload as open edits, and clears it on unmount', async () => {
    serve(() => Response.json({ review: stored(), permissions: allowed }));
    const first = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit review' }));
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Unsaved summary' } });
    first.unmount();

    const onEditingChange = vi.fn();
    const second = renderPanel(author, onEditingChange);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    second.unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
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

describe('review draft recovery', () => {
  async function edit() {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit review' }));
  }

  function changeSummary(value: string) {
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value } });
  }

  it('recovers unsaved fields after remount only for the account that edited them', async () => {
    serve(() => Response.json({ review: stored(), permissions: allowed }));
    const first = renderPanel();
    await edit();
    changeSummary('Author’s private draft');
    const questionLines = 'First question?\n\nUnfinished question ';
    fireEvent.change(screen.getByLabelText(/Questions for the client/), { target: { value: questionLines } });
    first.unmount();

    const other = renderPanel(teammate);
    await edit();
    expect(screen.getByDisplayValue(review.summary)).toBeTruthy();
    expect(screen.queryByDisplayValue('Author’s private draft')).toBeNull();
    other.unmount();

    renderPanel();
    expect(await screen.findByDisplayValue('Author’s private draft')).toBeTruthy();
    expect((screen.getByLabelText(/Questions for the client/) as HTMLTextAreaElement).value).toBe(questionLines);
  });

  it.each(['Save review', 'Cancel'])('%s clears the draft across remounts', async (action) => {
    const calls = serve(() => Response.json({ review: stored(), permissions: allowed }));
    const first = renderPanel();
    await edit();
    changeSummary('Temporary edit');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByRole('button', { name: 'Edit review' });
    expect(calls.filter(({ method }) => method === 'PUT')).toHaveLength(action === 'Cancel' ? 0 : 1);
    first.unmount();
    renderPanel();
    await edit();
    expect(screen.getByDisplayValue(review.summary)).toBeTruthy();
  });

  it('keeps a rejected save recoverable after remount', async () => {
    serve(method => method === 'PUT'
      ? Response.json({ error: 'outdated' }, { status: 409 })
      : Response.json({ review: stored(), permissions: allowed }));
    const first = renderPanel();
    await edit();
    changeSummary('Keep after conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await screen.findByText(/draft is read-only/);
    first.unmount();
    renderPanel();
    expect(await screen.findByDisplayValue('Keep after conflict')).toBeTruthy();
  });
});
