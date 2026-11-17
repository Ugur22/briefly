import { z } from 'zod';

// The seven things an agency needs from a campaign brief. Keyed by name (not a list) so a review always has
// exactly these: required object keys are enforced by structured output, list lengths are not.
export const REVIEW_AREAS = ['objective', 'audience', 'budget', 'timing', 'channels', 'kpis', 'deliverables'] as const;
export const ReviewArea = z.enum(REVIEW_AREAS);
export type ReviewArea = z.infer<typeof ReviewArea>;

export const AreaStatus = z.enum(['present', 'unclear', 'missing']);
export type AreaStatus = z.infer<typeof AreaStatus>;

export const REVIEW_LIMITS = { summary: 1000, note: 300, item: 300, items: 10 } as const;

const areaAssessment = z.object({
  status: AreaStatus,
  note: z.string().max(REVIEW_LIMITS.note),
});

export const Review = z.object({
  summary: z.string().max(REVIEW_LIMITS.summary),
  areas: z.object({
    objective: areaAssessment,
    audience: areaAssessment,
    budget: areaAssessment,
    timing: areaAssessment,
    channels: areaAssessment,
    kpis: areaAssessment,
    deliverables: areaAssessment,
  }),
  questions: z.array(z.string().max(REVIEW_LIMITS.item)).max(REVIEW_LIMITS.items),
  risks: z.array(z.string().max(REVIEW_LIMITS.item)).max(REVIEW_LIMITS.items),
});
export type Review = z.infer<typeof Review>;

export const ReviewFailure = z.enum(['model_failed', 'refused', 'timeout', 'invalid']);
export type ReviewFailure = z.infer<typeof ReviewFailure>;

// A brief's current review. `outdated` means the brief text changed after the review was generated or edited.
export const BriefReview = z.object({
  state: z.enum(['pending', 'succeeded', 'failed']),
  review: Review.nullable(),
  briefVersion: z.number().int().positive(),
  outdated: z.boolean(),
  error: ReviewFailure.nullable(),
  model: z.string().nullable(),
  generatedAt: z.iso.datetime({ offset: true }).nullable(),
  editedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type BriefReview = z.infer<typeof BriefReview>;

// `null` review: none generated yet.
export const BriefReviewResponse = z.object({
  review: BriefReview.nullable(),
  permissions: z.object({ generate: z.boolean(), edit: z.boolean() }),
});
export type BriefReviewResponse = z.infer<typeof BriefReviewResponse>;

// An edit names the brief version it was made against, so an edit can't attach itself to newer brief text.
export const ReviewEdit = z.object({
  review: Review,
  briefVersion: z.number().int().positive(),
});
export type ReviewEdit = z.infer<typeof ReviewEdit>;
