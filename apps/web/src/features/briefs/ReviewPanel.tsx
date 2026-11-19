import { RATE_LIMITED, REVIEW_AREAS, type AreaStatus, type BriefReview, type Review, type ReviewArea } from '@briefly/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LoaderCircle, Pencil, RefreshCw } from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { ApiError, fetchMe, fetchReview, generateReview, saveReview } from '../../lib/api';
import { notify } from '../../lib/notify';
import { queryKeys } from '../../lib/queryKeys';
import { readDraft, storeDraft, type ReviewDraft } from './reviewDraft';
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
export const FILL: Record<AreaStatus, string> = { present: 'bg-present', unclear: 'bg-unclear', missing: 'bg-missing' };

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
  if (err instanceof ApiError && err.code === RATE_LIMITED) return "You've reached the limit for AI reviews for now. Try again in a few minutes.";
  return 'Could not generate a review. Try again.';
};

function AreaRows({ review, areas }: { review: Review; areas: ReviewArea[] }) {
  return (
      <table className="w-full border-collapse text-left">
        <tbody className="divide-y divide-line border-y border-line">
          {areas.map((area) => (
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
  );
}

// The one rich moment: all seven areas at a glance, one row when the container is wide, 4 + 3 when it is not, so
// the labels always fit. The same statuses are in text below, so the strip never carries meaning alone.
function CoverageStrip({ review }: { review: Review }) {
  return (
    <ol aria-label="Coverage of the seven brief areas" className="grid grid-cols-4 gap-x-2 gap-y-3 @lg:grid-cols-7 @lg:gap-x-1">
      {REVIEW_AREAS.map((area) => (
        <li key={area} className="grid min-w-0 gap-1.5">
          <span className={`h-1.5 rounded-full ${FILL[review.areas[area].status]}`} aria-hidden />
          <span className="truncate text-xs text-muted">{AREA_LABELS[area]}</span>
          <span className="sr-only">: {STATUS_LABELS[review.areas[area].status]}</span>
        </li>
      ))}
    </ol>
  );
}

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} strokeWidth={1.5} className="text-muted transition-transform duration-150 ease-out group-open:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

// Verdict first: the count, the strip, the AI's summary, then what is open and what to ask.
export function ReviewFindings({ review }: { review: Review }) {
  const missing = REVIEW_AREAS.filter(area => review.areas[area].status === 'missing');
  const unclear = REVIEW_AREAS.filter(area => review.areas[area].status === 'unclear');
  const open = [...missing, ...unclear];
  return (
    <div className="@container grid gap-4">
      <h3 className="text-lg font-semibold">{open.length ? `${missing.length} missing · ${unclear.length} unclear` : 'All areas covered'}</h3>
      <CoverageStrip review={review} />
      <p className="max-w-[68ch]">{review.summary}</p>
      {open.length > 0 && <AreaRows review={review} areas={open} />}
      {review.questions.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-medium">Questions for the client</h3>
          <ol className="grid list-decimal gap-2 pl-5 text-ink-2 marker:text-muted">{review.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </div>
      )}
    </div>
  );
}

function ReviewView({ review }: { review: Review }) {
  const covered = REVIEW_AREAS.filter(area => review.areas[area].status === 'present');
  return (
    <div className="grid gap-5">
      <ReviewFindings review={review} />
      {covered.length > 0 && <Disclosure title={`Already covered (${covered.length})`}><AreaRows review={review} areas={covered} /></Disclosure>}
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

export function useBriefReview(wsId: string, briefId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.review(wsId, briefId),
    queryFn: () => fetchReview(wsId, briefId),
    // A generation started elsewhere (another tab, a teammate): check back until it lands.
    refetchInterval: (q) => (q.state.data?.review?.state === 'pending' ? 3000 : false),
  });

}

type PanelProps = { wsId: string; briefId: string; briefVersion: number; onEditingChange?: (editing: boolean) => void };

export function ReviewPanel(props: PanelProps) {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, enabled: false });
  const scope = JSON.stringify([me.data?.id, props.wsId, props.briefId]);
  return <ScopedReviewPanel key={scope} {...props} storageKey={me.data?.id ? `briefly:review-draft:${scope}` : undefined} />;
}

function ScopedReviewPanel({ wsId, briefId, briefVersion, storageKey, onEditingChange }: PanelProps & { storageKey?: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => readDraft(storageKey));
  const editing = draft !== null;
  // A draft restored from storage counts too: it is unsaved work the approver would not see.
  // Layout effect, so Submit is never painted for a frame before a restored draft hides it.
  useLayoutEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  function updateDraft(next: ReviewDraft | null) {
    storeDraft(storageKey, next);
    setDraft(next);
  }
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const query = useBriefReview(wsId, briefId);
  const generate = useMutation({
    mutationKey: queryKeys.review(wsId, briefId),
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
      updateDraft(null);
      notify.done('Review saved');
    },
  });

  if (query.isPending) return <p className="text-muted">Loading review…</p>;
  if (query.isError) return <p role="alert" className="alert">Could not load the review.</p>;

  const { review, permissions } = query.data;
  // While regenerating, or after a failed attempt, the previous review is still shown; only a succeeded one is editable.
  const shown = review?.review ?? null;
  const editable = review?.state === 'succeeded' && !review.outdated && permissions.edit;
  const conflict = !!draft && (!editable || !shown || review.briefVersion !== draft.version ||
    briefVersion !== draft.version || review.generatedAt !== draft.generatedAt || review.editedAt !== draft.editedAt ||
    (save.error instanceof ApiError && ['outdated', 'no_review', 'locked'].includes(save.error.code ?? '')));
  const runningElsewhere = review?.state === 'pending' && !generate.isPending;
  // Replacing a review the team has edited throws those edits away, so ask first.
  const startGenerate = () => (review?.editedAt && !confirmingRegenerate ? setConfirmingRegenerate(true) : generate.mutate());

  return (
    <section aria-labelledby="review-heading" className="grid gap-4 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-heading" className="text-base font-medium">
          AI review
        </h2>
        <div className="flex flex-wrap gap-2">
          {shown && review && !editing && editable && (
            <button type="button" className="btn btn-tonal" onClick={() => setDraft({
              version: briefVersion, generatedAt: review.generatedAt, editedAt: review.editedAt,
              fields: { ...shown, questions: shown.questions.join('\n'), risks: shown.risks.join('\n') },
            })}>
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Edit review
            </button>
          )}
          {!generate.isPending && !runningElsewhere && permissions.generate && !editing && !confirmingRegenerate && (
            <button type="button" className={review?.state === 'succeeded' && !review.outdated ? 'btn btn-ghost' : 'btn btn-primary'} onClick={startGenerate}>
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
              {review?.outdated ? 'Update AI review' : review ? 'Regenerate review' : 'Generate AI review'}
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
        <p role="note" className="note text-ink">
          The brief changed after this review. Regenerate it to review the current text.
        </p>
      )}

      {shown && review && !editing && (
        <>
          <ReviewView review={shown} />
          <Provenance review={review} />
        </>
      )}
      {draft && (
        <>
          {conflict && <p role="status" className="note">This draft is read-only because the brief or review changed or editing is unavailable. You can copy your edits.</p>}
          {save.error && !conflict && (
            <p role="alert" className="alert">
              {save.error instanceof ApiError && (save.error.code === 'outdated' || save.error.code === 'no_review')
                ? 'The brief or its review changed while you were editing. Regenerate the review first.'
                : 'Could not save the review. Your changes are still here.'}
            </p>
          )}
          <ReviewEditor
            review={draft.fields}
            readOnly={conflict}
            onChange={fields => updateDraft({ ...draft, fields })}
            pending={save.isPending}
            onSave={(r) => save.mutate(r)}
            onCancel={() => {
              save.reset();
              updateDraft(null);
            }}
          />
        </>
      )}
    </section>
  );
}
