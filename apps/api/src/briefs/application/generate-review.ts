import type { Brief, BriefReview, Review, ReviewFailure, WorkspaceRole } from '@briefly/contracts';
import { briefPermissions } from '../domain/permissions';
import { clampReview, isEditableStatus, PENDING_STALE_MS, toBriefReview, type ModelReview, type ReviewOutcome, type StoredReview } from '../domain/review';

// The port to the model. Implementations never throw: every failure is an answer, so no exception (which
// could carry model output or brief text) reaches the error log.
export type ReviewGenerator = (brief: { title: string; body: string }) => Promise<
  { ok: true; review: ModelReview; model: string } | { ok: false; error: ReviewFailure; model: string | null }
>;

// The storage port; infra/reviews-repo.ts implements it with the caller's own token (RLS applies).
export type ReviewsRepo = {
  get(wsId: string, briefId: string): Promise<StoredReview | null>;
  // True if this caller now owns the generation; false if another one is still running.
  claim(wsId: string, briefId: string, briefVersion: number, startedAt: Date, staleBefore: Date): Promise<boolean>;
  // Saves only if the generation started at `startedAt` still owns the row, so a late finisher can't overwrite.
  complete(wsId: string, briefId: string, startedAt: Date, outcome: ReviewOutcome): Promise<boolean>;
  // Saves only over a succeeded review of exactly this brief version.
  saveEdit(wsId: string, briefId: string, briefVersion: number, review: Review): Promise<boolean>;
};

export type GenerateReviewDeps = {
  findBrief: (wsId: string, briefId: string) => Promise<Brief | null>;
  reviews: ReviewsRepo;
  generate: ReviewGenerator | null;
  now?: () => Date;
};

export type GenerateReviewResult =
  | { kind: 'ok'; review: BriefReview; brief: Brief }
  | { kind: 'not_found' | 'forbidden' | 'locked' | 'busy' | 'ai_unavailable' };

// One generation per brief at a time: the claim is atomic in the database, and the result is saved only if this
// generation still owns the row (a run declared dead that finishes late can't overwrite a newer one).
export async function generateReview(deps: GenerateReviewDeps, input: { wsId: string; briefId: string; role: WorkspaceRole }): Promise<GenerateReviewResult> {
  if (!briefPermissions(input.role).edit) return { kind: 'forbidden' };
  if (!deps.generate) return { kind: 'ai_unavailable' };

  const brief = await deps.findBrief(input.wsId, input.briefId);
  if (!brief) return { kind: 'not_found' };
  if (!isEditableStatus(brief.status)) return { kind: 'locked' };

  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const claimed = await deps.reviews.claim(input.wsId, brief.id, brief.version, startedAt, new Date(startedAt.getTime() - PENDING_STALE_MS));
  if (!claimed) return { kind: 'busy' };

  const result = await deps.generate({ title: brief.title, body: brief.body });
  await deps.reviews.complete(
    input.wsId,
    brief.id,
    startedAt,
    result.ok
      ? { state: 'succeeded', review: clampReview(result.review), model: result.model, briefVersion: brief.version }
      : { state: 'failed', error: result.error, model: result.model },
  );

  const row = await deps.reviews.get(input.wsId, brief.id);
  if (!row) return { kind: 'not_found' };
  return { kind: 'ok', review: toBriefReview(row, brief.version, now()), brief };
}
