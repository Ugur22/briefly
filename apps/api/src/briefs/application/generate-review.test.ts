import { REVIEW_AREAS, type Brief } from '@briefly/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelReview, StoredReview } from '../domain/review';
import { generateReview, type ReviewGenerator, type ReviewsRepo } from './generate-review';

const ws = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const brief: Brief = {
  id: 'b1ef0000-0000-4000-8000-000000000001',
  workspaceId: ws,
  title: 'Spring launch',
  status: 'draft',
  version: 3,
  body: 'Five thousand test rides.',
  updatedAt: '2026-11-18T09:00:00.000Z',
  createdAt: '2026-11-18T09:00:00.000Z',
  source: null,
};
const modelReview: ModelReview = {
  summary: 'Clear goal, no budget.',
  areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: 'present', note: 'ok' }])) as ModelReview['areas'],
  questions: ['Budget?'],
  risks: [],
};

// An in-memory review with the same claim/complete semantics as the repo (the previous review survives a failure).
function memoryReviews(): ReviewsRepo & { row: StoredReview | null } {
  const store: ReviewsRepo & { row: StoredReview | null } = {
    row: null,
    get: async () => store.row,
    claim: async (_ws, _briefId, briefVersion, startedAt, staleBefore) => {
      if (store.row && store.row.state === 'pending' && new Date(store.row.startedAt) >= staleBefore) return false;
      store.row = store.row
        ? { ...store.row, state: 'pending', startedAt: startedAt.toISOString(), errorCode: null }
        : { briefVersion, state: 'pending', result: null, errorCode: null, model: null, startedAt: startedAt.toISOString(), completedAt: null, editedAt: null };
      return true;
    },
    complete: async (_ws, _b, startedAt, outcome) => {
      if (!store.row || store.row.startedAt !== startedAt.toISOString()) return false;
      store.row =
        outcome.state === 'succeeded'
          ? { ...store.row, state: 'succeeded', result: outcome.review, briefVersion: outcome.briefVersion, model: outcome.model, errorCode: null, editedAt: null, completedAt: new Date().toISOString() }
          : { ...store.row, state: 'failed', errorCode: outcome.error, completedAt: new Date().toISOString() };
      return true;
    },
    saveEdit: async () => true,
  };
  return store;
}

const deps = (generate: ReviewGenerator | null, reviews = memoryReviews()) => ({ findBrief: async () => brief, reviews, generate });
const run = (d: ReturnType<typeof deps>, role: 'editor' | 'approver' | 'admin' = 'editor') => generateReview(d, { wsId: ws, briefId: brief.id, role });

describe('generateReview', () => {
  it('stores a succeeded review for the current brief version', async () => {
    const result = await run(deps(async () => ({ ok: true, review: modelReview, model: 'claude-opus-5-5' })));

    expect(result).toMatchObject({ kind: 'ok', review: { state: 'succeeded', briefVersion: 3, outdated: false, model: 'claude-opus-5-5' } });
  });

  it('stores a failure as failed, never a partial review', async () => {
    const result = await run(deps(async () => ({ ok: false, error: 'refused', model: 'claude-opus-5-5' })));

    expect(result).toMatchObject({ kind: 'ok', review: { state: 'failed', error: 'refused', review: null } });
  });

  it('refuses a read-only role before calling the model', async () => {
    const generate = vi.fn<ReviewGenerator>();

    expect(await run(deps(generate), 'approver')).toEqual({ kind: 'forbidden' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('says the AI is unavailable when no generator is configured', async () => {
    expect(await run(deps(null))).toEqual({ kind: 'ai_unavailable' });
  });

  it('answers busy while another generation of the same brief is running, without a second model call', async () => {
    const reviews = memoryReviews();
    let release: () => void = () => {};
    const slow = vi.fn<ReviewGenerator>(() => new Promise((resolve) => (release = () => resolve({ ok: true, review: modelReview, model: 'm' }))));

    const first = run(deps(slow, reviews));
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
    expect(await run(deps(slow, reviews))).toEqual({ kind: 'busy' });
    release();
    await first;

    expect(slow).toHaveBeenCalledOnce();
  });

  it('keeps the previous review when a regenerate fails, so nothing is lost', async () => {
    const reviews = memoryReviews();
    await run(deps(async () => ({ ok: true, review: modelReview, model: 'm' }), reviews));

    const result = await run(deps(async () => ({ ok: false, error: 'timeout', model: 'm' }), reviews));

    expect(result).toMatchObject({ kind: 'ok', review: { state: 'failed', error: 'timeout', review: { summary: 'Clear goal, no budget.' } } });
  });

  it('answers not_found for a brief the caller cannot see', async () => {
    expect(await generateReview({ findBrief: async () => null, reviews: memoryReviews(), generate: async () => ({ ok: false, error: 'model_failed', model: null }) }, { wsId: ws, briefId: brief.id, role: 'admin' })).toEqual({
      kind: 'not_found',
    });
  });
});
