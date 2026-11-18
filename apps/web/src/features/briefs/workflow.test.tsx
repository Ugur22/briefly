import type { Brief, BriefPermissions } from '@briefly/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowPanel } from './WorkflowPanel';

const wsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const meId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const base: Brief = {
  id: 'b1ef0000-0000-4000-8000-000000000001',
  workspaceId: wsId,
  title: 'Spring launch',
  status: 'draft',
  version: 2,
  updatedAt: '2026-11-18T09:00:00.000Z',
  body: 'text',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: null,
  submittedBy: null,
  submittedAt: null,
  decidedAt: null,
  decisionComment: null,
};
const none: BriefPermissions = { edit: false, delete: false, submit: false, decide: false };
const api = `/api/workspaces/${wsId}/briefs/${base.id}`;

function serve(handler: (url: string, body: unknown) => Response) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url === '/api/me') return Response.json({ id: meId, email: 'me@test.dev' });
      return handler(url, body);
    }),
  );
  return calls;
}

type ReviewState = { status: 'pending' | 'error' | 'success'; editing: boolean; retry?: () => void };

function renderPanel(brief: Brief, permissions: BriefPermissions, review: ReviewState = { status: 'success', editing: false }) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkflowPanel
        reviewReady
        reviewStatus={review.status}
        onRetryReview={review.retry ?? (() => {})}
        reviewEditing={review.editing}
        wsId={wsId}
        brief={brief}
        permissions={permissions}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkflowPanel', () => {
  it('submits the version on screen for review', async () => {
    const calls = serve(() => Response.json({ brief: { ...base, status: 'in_review', submittedBy: meId }, permissions: none }));
    renderPanel(base, { ...none, edit: true, submit: true });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for human review' }));

    await vi.waitFor(() => expect(calls.find((c) => c.url === `${api}/submit`)?.body).toEqual({ version: 2 }));
  });

  it('explains that a review of the current text is needed first', async () => {
    serve(() => Response.json({ error: 'no_current_review' }, { status: 409 }));
    renderPanel(base, { ...none, edit: true, submit: true });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for human review' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Generate an AI review/);
  });

  it('offers an approver Approve, and Request changes only with a comment', async () => {
    const calls = serve(() => Response.json({ brief: { ...base, status: 'changes_requested', decisionComment: 'Add dates' }, permissions: none }));
    renderPanel({ ...base, status: 'in_review', submittedBy: otherId }, { ...none, decide: true });

    const sendBack = await screen.findByRole('button', { name: 'Request changes' });
    expect((sendBack as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What needs to change'), { target: { value: 'Add dates' } });
    fireEvent.click(sendBack);

    await vi.waitFor(() => expect(calls.find((c) => c.url === `${api}/decision`)?.body).toEqual({ decision: 'request_changes', comment: 'Add dates' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('approves without sending a half-typed send-back comment', async () => {
    const calls = serve(() => Response.json({ brief: { ...base, status: 'approved' }, permissions: none }));
    renderPanel({ ...base, status: 'in_review', submittedBy: otherId }, { ...none, decide: true });

    fireEvent.change(await screen.findByLabelText('What needs to change'), { target: { value: 'maybe the dates?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await vi.waitFor(() => expect(calls.find((c) => c.url === `${api}/decision`)?.body).toEqual({ decision: 'approve' }));
  });

  it('holds back Submit while review edits are unsaved', () => {
    serve(() => new Response(null, { status: 404 }));
    renderPanel(base, { ...none, edit: true, submit: true }, { status: 'success', editing: true });

    expect(screen.queryByRole('button', { name: 'Submit for human review' })).toBeNull();
    expect(screen.getByText(/Save or cancel your review edits/)).toBeTruthy();
  });

  it('keeps Approve disabled until the approver can see the review', async () => {
    serve(() => new Response(null, { status: 404 }));
    renderPanel({ ...base, status: 'in_review', submittedBy: otherId }, { ...none, decide: true }, { status: 'pending', editing: false });

    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/once the review has loaded/)).toBeTruthy();
  });

  it('offers a retry instead of a dead Approve when the review fails to load', async () => {
    serve(() => new Response(null, { status: 404 }));
    const retry = vi.fn();
    renderPanel({ ...base, status: 'in_review', submittedBy: otherId }, { ...none, decide: true }, { status: 'error', editing: false, retry });

    expect(((await screen.findByRole('button', { name: 'Approve' })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('never offers a decision to whoever submitted the brief', async () => {
    serve(() => new Response(null, { status: 404 }));
    renderPanel({ ...base, status: 'in_review', submittedBy: meId }, { ...none, decide: true });

    expect(await screen.findByText(/You submitted this brief/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows what the approver asked to change', () => {
    serve(() => new Response(null, { status: 404 }));
    renderPanel({ ...base, status: 'changes_requested', decisionComment: 'Add the launch date.' }, { ...none, edit: true, submit: true });

    expect(screen.getByText('Add the launch date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resubmit for human review' })).toBeTruthy();
  });

  it('marks an approved brief as final, with nothing to do', () => {
    serve(() => new Response(null, { status: 404 }));
    renderPanel({ ...base, status: 'approved' }, none);

    expect(screen.getByText(/This brief is final/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
