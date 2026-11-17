import { REVIEW_AREAS, type AreaStatus, type BriefReview, type Review, type ReviewArea } from '@briefly/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Pencil, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { ApiError, fetchReview, generateReview, saveReview } from '../../lib/api';
import { notify } from '../../lib/notify';
import { queryKeys } from '../../lib/queryKeys';
import { ReviewEditor } from './ReviewEditor';

export const AREA_LABELS: Record<ReviewArea, string> = {
  objective: 'Objective',
  audience: 'Audience',
  budget: 'Budget',
  timing: 'Timing',
  channels: 'Channels',
  kpis: 'KPIs',
  deliverables: 'Deliverables',
};
export const STATUS_LABELS: Record<AreaStatus, string> = { present: 'Present', unclear: 'Unclear', missing: 'Missing' };

// The one place on the screen with several hues, and each means something.
const FILL: Record<AreaStatus, string> = { present: 'bg-present', unclear: 'bg-unclear', missing: 'bg-missing' };

const FAILURES: Record<string, string> = {
  refused: 'The model declined to review this brief.',
  timeout: 'The review took too long. Try again.',
  invalid: 'The stored review is damaged. Generate a new one.',
  model_failed: 'The model could not produce a review. Try again.',
};
const generateError = (err: unknown) => {
  if (err instanceof ApiError && err.code === 'busy') return 'A review of this brief is already being generated.';
  if (err instanceof ApiError && err.code === 'ai_unavailable') return 'AI review is not available right now.';
  if (err instanceof ApiError && err.code === 'locked') return 'This brief can no longer be reviewed.';
  return 'Could not generate a review. Try again.';
};

// How complete the brief is, at a glance: one segment per area, in the order the table below uses.
function Coverage({ review }: { review: Review }) {
  const counts = REVIEW_AREAS.reduce((c, a) => ({ ...c, [review.areas[a].status]: c[review.areas[a].status] + 1 }), { present: 0, unclear: 0, missing: 0 });
  return (
    <figure className="grid gap-2">
      <div className="grid grid-cols-7 gap-1" role="img" aria-label={`Coverage: ${counts.present} present, ${counts.unclear} unclear, ${counts.missing} missing`}>
        {REVIEW_AREAS.map((a) => (
          <span key={a} className={`h-2 rounded-full ${FILL[review.areas[a].status]}`} title={`${AREA_LABELS[a]}: ${STATUS_LABELS[review.areas[a].status]}`} />
        ))}
      </div>
      <figcaption className="meta flex flex-wrap gap-x-4 gap-y-1">
        {(['present', 'unclear', 'missing'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className={`size-2 rounded-full ${FILL[s]}`} aria-hidden />
            {counts[s]} {STATUS_LABELS[s].toLowerCase()}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// Model output is shown as plain text only: React text nodes, never HTML or markdown.
function ReviewView({ review }: { review: Review }) {
  return (
    <div className="grid gap-5">
      <Coverage review={review} />
      <p className="text-ink">{review.summary}</p>
      <table className="w-full border-collapse text-left">
        <tbody className="divide-y divide-line border-y border-line">
          {REVIEW_AREAS.map((area) => (
            <tr key={area} className="align-top">
              {/* Status sits under the area so the note keeps its width on a phone. The hue is in the dot only:
                  as text, present and unclear fall below 4.5:1 on white. */}
              <th scope="row" className="w-32 py-3 pr-4 font-medium">
                <div>{AREA_LABELS[area]}</div>
                <div className="mt-1 flex items-center gap-2 font-normal whitespace-nowrap text-ink-2">
                  <span className={`size-2 rounded-full ${FILL[review.areas[area].status]}`} aria-hidden />
                  {STATUS_LABELS[review.areas[area].status]}
                </div>
              </th>
              <td className="py-3 text-ink-2">{review.areas[area].note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {review.questions.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-medium">Questions for the client</h3>
          <ol className="grid list-decimal gap-2 pl-5 text-ink-2 marker:text-muted">{review.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </div>
      )}
      {review.risks.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-medium">Risks</h3>
          <ul className="grid list-disc gap-2 pl-5 text-ink-2 marker:text-muted">{review.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Provenance({ review }: { review: BriefReview }) {
  if (review.model === 'fake') return <p className="meta">Offline fallback review: canned text, not produced by a model</p>;
  return (
    <p className="meta">
      Generated by {review.model ?? 'the model'}
      {review.editedAt ? ', edited by the team' : ''}
    </p>
  );
}

export function ReviewPanel({ wsId, briefId, briefVersion }: { wsId: string; briefId: string; briefVersion: number }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.review(wsId, briefId),
    queryFn: () => fetchReview(wsId, briefId),
    // A generation started elsewhere (another tab, a teammate): check back until it lands.
    refetchInterval: (q) => (q.state.data?.review?.state === 'pending' ? 3000 : false),
  });

  const generate = useMutation({
    mutationFn: () => generateReview(wsId, briefId),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.review(wsId, briefId), res);
      if (res.review?.state === 'succeeded') notify.done('Review ready');
    },
    onSettled: () => setConfirmingRegenerate(false),
  });
  const save = useMutation({
    mutationFn: (review: Review) => saveReview(wsId, briefId, { review, briefVersion }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.review(wsId, briefId), res);
      setEditing(false);
      notify.done('Review saved');
    },
  });

  if (query.isPending) return <p className="text-muted">Loading review…</p>;
  if (query.isError) return <p role="alert" className="alert">Could not load the review.</p>;

  const { review, permissions } = query.data;
  // While regenerating, or after a failed attempt, the previous review is still shown; only a succeeded one is editable.
  const shown = review?.review ?? null;
  const editable = review?.state === 'succeeded' && !review.outdated && permissions.edit;
  const runningElsewhere = review?.state === 'pending' && !generate.isPending;
  // Replacing a review the team has edited throws those edits away, so ask first.
  const startGenerate = () => (review?.editedAt && !confirmingRegenerate ? setConfirmingRegenerate(true) : generate.mutate());

  return (
    <section aria-labelledby="review-heading" className="card grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-heading" className="text-base font-medium">
          AI review
        </h2>
        <div className="flex flex-wrap gap-2">
          {shown && review && !editing && editable && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Edit review
            </button>
          )}
          {!generate.isPending && !runningElsewhere && permissions.generate && !editing && !confirmingRegenerate && (
            <button type="button" className={review ? 'btn' : 'btn btn-primary'} onClick={startGenerate}>
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
              {review ? 'Regenerate review' : 'Generate AI review'}
            </button>
          )}
        </div>
      </div>

      {(generate.isPending || runningElsewhere) && (
        <p role="status" className="note items-center">
          <LoaderCircle size={16} strokeWidth={1.5} className="animate-spin" aria-hidden />
          {generate.isPending ? 'Reviewing the brief… this takes about 20 seconds.' : 'A review is being generated. This page updates when it is ready.'}
        </p>
      )}
      {confirmingRegenerate && !generate.isPending && (
        <div role="group" aria-label="Confirm regenerate" className="note flex-wrap items-center justify-between">
          <span>The team edited this review. Regenerating replaces those edits.</span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={() => generate.mutate()}>
              Regenerate anyway
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmingRegenerate(false)}>
              Keep the edited review
            </button>
          </span>
        </div>
      )}
      {generate.error && (
        <p role="alert" className="alert">
          {generateError(generate.error)}
        </p>
      )}
      {!review && !permissions.generate && <p className="text-ink-2">No review yet.</p>}
      {!review && permissions.generate && !generate.isPending && (
        <p className="text-ink-2">Check this brief for gaps before it goes to the team: objective, audience, budget, timing, channels, KPIs and deliverables.</p>
      )}

      {review?.state === 'failed' && (
        <p role="alert" className="alert">
          {FAILURES[review.error ?? 'model_failed']}
          {shown ? ' The previous review is shown below.' : ''}
        </p>
      )}
      {review?.outdated && shown && (
        <p role="note" className="rounded-control bg-unclear-soft px-3 py-2 text-ink">
          The brief changed after this review. Regenerate it to review the current text.
        </p>
      )}

      {shown && review && !editing && (
        <>
          <Provenance review={review} />
          <ReviewView review={shown} />
        </>
      )}
      {shown && editing && (
        <>
          {save.error && (
            <p role="alert" className="alert">
              {save.error instanceof ApiError && (save.error.code === 'outdated' || save.error.code === 'no_review')
                ? 'The brief or its review changed while you were editing. Regenerate the review first.'
                : 'Could not save the review. Your changes are still here.'}
            </p>
          )}
          <ReviewEditor
            initial={shown}
            pending={save.isPending}
            onSave={(r) => save.mutate(r)}
            onCancel={() => {
              save.reset();
              setEditing(false);
            }}
          />
        </>
      )}
    </section>
  );
}
