import { REVIEW_AREAS } from '@briefly/contracts';
import { describe, expect, it } from 'vitest';
import { clampReview, isEditableStatus, isStalePending, ModelReview, toBriefReview, type StoredReview } from './review';

const raw = (over: Partial<ModelReview> = {}): ModelReview => ({
  summary: 'A clear brief.',
  areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: 'present', note: 'Fine.' }])) as ModelReview['areas'],
  questions: ['Launch date?'],
  risks: [],
  ...over,
});

describe('clampReview', () => {
  it('keeps a review that already fits', () => {
    expect(clampReview(raw()).summary).toBe('A clear brief.');
  });

  it('shortens long text and long lists instead of failing the whole review', () => {
    const review = clampReview(raw({ summary: 's'.repeat(5000), questions: Array.from({ length: 15 }, (_, i) => `Question ${i} ${'x'.repeat(400)}`) }));

    expect([...review.summary]).toHaveLength(1000);
    expect(review.summary.endsWith('…')).toBe(true);
    expect(review.questions).toHaveLength(10);
    expect([...(review.questions[0] ?? '')].length).toBeLessThanOrEqual(300);
  });

  it('drops empty items', () => {
    expect(clampReview(raw({ risks: ['  ', 'Budget not split per channel'] })).risks).toEqual(['Budget not split per channel']);
  });
});

describe('ModelReview', () => {
  it('requires every area, so a review can never silently skip one', () => {
    const { areas } = raw();
    const withoutBudget = Object.fromEntries(Object.entries(areas).filter(([a]) => a !== 'budget'));

    expect(ModelReview.safeParse({ ...raw(), areas: withoutBudget }).success).toBe(false);
  });
});

describe('workflow helpers', () => {
  it('lets reviews change only while the brief can change', () => {
    expect(isEditableStatus('draft')).toBe(true);
  });

  it('treats a generation older than two minutes as dead', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(isStalePending(new Date('2026-11-18T09:57:59Z'), now)).toBe(true);
    expect(isStalePending(new Date('2026-11-18T09:59:00Z'), now)).toBe(false);
  });
});

describe('toBriefReview', () => {
  const stored = (over: Partial<StoredReview> = {}): StoredReview => ({
    briefVersion: 3,
    state: 'succeeded',
    result: clampReview(raw()),
    errorCode: null,
    model: 'm',
    startedAt: '2026-11-18T10:00:00.000Z',
    completedAt: '2026-11-18T10:00:20.000Z',
    editedAt: null,
    ...over,
  });
  const now = new Date('2026-11-18T10:01:00Z');

  it('shows a succeeded review for the current version', () => {
    expect(toBriefReview(stored(), 3, now)).toMatchObject({ state: 'succeeded', outdated: false, review: { summary: 'A clear brief.' } });
  });

  it('marks a review of older brief text as outdated', () => {
    expect(toBriefReview(stored(), 4, now).outdated).toBe(true);
  });

  it('reports a stored result that breaks the contract as invalid, never passes it on', () => {
    expect(toBriefReview(stored({ result: { summary: 'x', areas: {} } }), 3, now)).toMatchObject({ state: 'failed', error: 'invalid', review: null });
  });

  it('keeps showing the previous review while regenerating and after a failed regenerate', () => {
    expect(toBriefReview(stored({ state: 'pending', startedAt: '2026-11-18T10:00:50.000Z' }), 3, now)).toMatchObject({ state: 'pending', review: { summary: 'A clear brief.' } });
    expect(toBriefReview(stored({ state: 'failed', errorCode: 'timeout' }), 3, now)).toMatchObject({ state: 'failed', error: 'timeout', review: { summary: 'A clear brief.' } });
  });

  it('reports a generation that never finished as a timeout', () => {
    expect(toBriefReview(stored({ state: 'pending', result: null, startedAt: '2026-11-18T09:50:00.000Z' }), 3, now)).toMatchObject({ state: 'failed', error: 'timeout' });
  });
});
