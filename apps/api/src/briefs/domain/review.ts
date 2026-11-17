import { AreaStatus, REVIEW_AREAS, REVIEW_LIMITS, Review, ReviewFailure, type BriefReview, type BriefStatus } from '@briefly/contracts';
import { z } from 'zod';

// What a generator is asked to produce. Structured output enforces required keys and enums but not lengths,
// so this has no caps: a long note must not fail the whole review. clampReview() fits it to the contract.
const modelArea = z.object({ status: AreaStatus, note: z.string() });
export const ModelReview = z.object({
  summary: z.string(),
  areas: z.object(Object.fromEntries(REVIEW_AREAS.map((a) => [a, modelArea])) as Record<(typeof REVIEW_AREAS)[number], typeof modelArea>),
  questions: z.array(z.string()),
  risks: z.array(z.string()),
});
export type ModelReview = z.infer<typeof ModelReview>;

const cut = (s: string, max: number) => {
  const chars = [...s.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
};
const list = (items: string[]) =>
  items
    .map((i) => cut(i, REVIEW_LIMITS.item))
    .filter((i) => i !== '')
    .slice(0, REVIEW_LIMITS.items);

export function clampReview(raw: ModelReview): Review {
  return Review.parse({
    summary: cut(raw.summary, REVIEW_LIMITS.summary),
    areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, { status: raw.areas[a].status, note: cut(raw.areas[a].note, REVIEW_LIMITS.note) }])),
    questions: list(raw.questions),
    risks: list(raw.risks),
  });
}

// Reviews (and their edits) are allowed while the brief can still change; the database enforces the same.
export const isEditableStatus = (status: BriefStatus) => status === 'draft' || status === ('changes_requested' as BriefStatus);

// A generation that has run this long without finishing is treated as dead (the API gives up after 50 s).
export const PENDING_STALE_MS = 2 * 60 * 1000;
export const isStalePending = (startedAt: Date, now: Date) => now.getTime() - startedAt.getTime() > PENDING_STALE_MS;

// A review as stored, independent of the database's column names.
export type StoredReview = {
  briefVersion: number;
  state: 'pending' | 'succeeded' | 'failed';
  result: unknown;
  errorCode: string | null;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  editedAt: string | null;
};

// What a generation produced. On failure the previous review is kept, so a failed regenerate loses nothing.
export type ReviewOutcome = { state: 'succeeded'; review: Review; model: string; briefVersion: number } | { state: 'failed'; error: ReviewFailure; model: string | null };

const iso = (ts: string | null) => (ts === null ? null : new Date(ts).toISOString());

// What the API shows. The stored result is re-validated on every read: rows can be written straight through
// PostgREST, so one that no longer fits the contract is reported as invalid, never passed on. While a new
// generation runs, or after one failed, the previous review (if any) is still shown.
export function toBriefReview(stored: StoredReview, currentBriefVersion: number, now = new Date()): BriefReview {
  const parsed = stored.result === null ? null : Review.safeParse(stored.result);
  const previous = parsed?.success ? parsed.data : null;
  const base = {
    briefVersion: stored.briefVersion,
    outdated: stored.briefVersion !== currentBriefVersion,
    model: stored.model,
    generatedAt: iso(stored.completedAt),
    editedAt: iso(stored.editedAt),
    review: previous,
  };
  if (stored.state === 'pending') {
    return isStalePending(new Date(stored.startedAt), now) ? { ...base, state: 'failed', error: 'timeout' } : { ...base, state: 'pending', error: null };
  }
  if (stored.state === 'failed') return { ...base, state: 'failed', error: ReviewFailure.catch('model_failed').parse(stored.errorCode) };
  return previous ? { ...base, state: 'succeeded', error: null } : { ...base, state: 'failed', error: 'invalid' };
}
