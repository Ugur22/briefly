import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, deleteBrief, fetchBrief, isNotFound, updateBrief } from '../../lib/api';
import { notify } from '../../lib/notify';
import { queryKeys } from '../../lib/queryKeys';
import { BriefForm } from './BriefForm';
import { ReviewFindings, ReviewPanel, useBriefReview } from './ReviewPanel';
import { SourceDownload } from './SourceDownload';
import { WorkflowPanel } from './WorkflowPanel';

function saveError(err: unknown) {
  if (err instanceof ApiError && err.status === 409) return 'Someone else changed this brief. Copy your text, then reload to see their version.';
  if (err instanceof ApiError && err.status === 403) return 'Your role in this workspace cannot edit briefs.';
  return 'Could not save. Your text is still here; try again.';
}

export function BriefPage() {
  const { wsId = '', briefId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The version the user started editing from, captured on Edit. Reading it from the cache at save time would
  // pick up a background refetch and quietly overwrite whoever saved in between.
  const [editingFrom, setEditingFrom] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Navigation is a transition, so this page stays mounted for a moment after a delete. Turning its query off
  // first means dropping the cache entry can't make it fetch the deleted brief again (a 404).
  const [deleted, setDeleted] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.brief(wsId, briefId),
    queryFn: () => fetchBrief(wsId, briefId),
    enabled: !deleted,
    retry: (count, err) => !isNotFound(err) && count < 1,
  });

  const reviewQuery = useBriefReview(wsId, briefId, !!query.data && !deleted);
  const generating = useIsMutating({ mutationKey: queryKeys.review(wsId, briefId) });
  const review = reviewQuery.data?.review;

  const save = useMutation({
    mutationFn: (values: { title: string; body: string; version: number }) => updateBrief(wsId, briefId, values),
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.brief(wsId, briefId), res);
      await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId), exact: true });
      // New text makes the review outdated; refetch so the panel says so.
      await queryClient.invalidateQueries({ queryKey: queryKeys.review(wsId, briefId), exact: true });
      setEditingFrom(null);
      notify.done('Brief saved', `Version ${res.brief.version}`);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteBrief(wsId, briefId),
    onSuccess: async () => {
      setDeleted(true);
      navigate(`/w/${wsId}`, { replace: true });
      queryClient.removeQueries({ queryKey: queryKeys.brief(wsId, briefId), exact: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId), exact: true });
      notify.done('Brief deleted');
    },
  });

  const back = (
    <Link to={`/w/${wsId}`} className="mb-4 inline-flex items-center gap-1 text-accent">
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
      Briefs
    </Link>
  );

  if (query.isPending) return <p className="text-muted">Loading brief…</p>;
  if (isNotFound(query.error)) {
    return (
      <>
        {back}
        <p role="alert" className="alert">
          Brief not found.
        </p>
      </>
    );
  }
  if (query.error) return <p role="alert" className="alert">Could not load this brief.</p>;

  const { brief, permissions } = query.data;

  if (editingFrom !== null) {
    return (
      <div>
        {back}
        <h1 className="mb-6 page-title">Edit brief</h1>
        {save.error && (
          <p role="alert" className="alert mb-4">
            {saveError(save.error)}
          </p>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <BriefForm
          initial={brief}
          submitLabel="Save"
          pending={save.isPending}
          onSubmit={(values) => save.mutate({ ...values, version: editingFrom })}
          onCancel={() => {
            save.reset();
            setEditingFrom(null);
            // After a conflict the cached copy is stale; fetch the current one before the next edit.
            void queryClient.invalidateQueries({ queryKey: queryKeys.brief(wsId, briefId), exact: true });
          }}
        />
        {review?.review && <aside className="card p-5">
          <h2 className="mb-4 hidden font-medium lg:block">Findings from the last AI review</h2>
          <div className="hidden lg:block"><ReviewFindings review={review.review} /></div>
          <details className="lg:hidden"><summary className="cursor-pointer font-medium">Findings from the last AI review</summary><div className="mt-4"><ReviewFindings review={review.review} /></div></details>
        </aside>}
        </div>
      </div>
    );
  }

  return (
    <>
      {back}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-doc text-4xl leading-tight text-accent-hover">{brief.title}</h1>
          <p className="meta mt-2">version {brief.version}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.edit && (
            <button type="button" className="btn btn-tonal" onClick={() => setEditingFrom(brief.version)}>
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Edit
            </button>
          )}
          {permissions.delete && !confirmingDelete && (
            <button type="button" className="btn btn-ghost hover:bg-negative-soft hover:text-negative" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              Delete
            </button>
          )}
        </div>
      </header>

      {confirmingDelete && (
        <div role="group" aria-label="Confirm delete" className="note mb-4 flex-wrap items-center justify-between">
          <span>Delete “{brief.title}” for everyone in this workspace?</span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending}>
              Keep it
            </button>
          </span>
        </div>
      )}
      {remove.error && (
        <p role="alert" className="alert mb-4">
          Could not delete this brief.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          {/* The brief as a document: set for reading, like the printed page it usually starts as. */}
          <article className="rounded-small bg-surface px-6 py-6 shadow-[0_2px_8px_rgb(22_61_62/0.06)] sm:px-8 sm:py-7">
            <p className="max-w-[68ch] font-doc text-[17px] leading-7 whitespace-pre-wrap text-ink">{brief.body}</p>
          </article>
          <ReviewPanel wsId={wsId} briefId={briefId} briefVersion={brief.version} />
        </div>
        <aside className="grid gap-4 lg:sticky lg:top-8">
          <WorkflowPanel reviewReady={reviewQuery.isSuccess && review?.state === 'succeeded' && !review.outdated && review.briefVersion === brief.version && !generating} wsId={wsId} brief={brief} permissions={permissions} />
          {brief.source && <SourceDownload wsId={wsId} briefId={briefId} source={brief.source} />}
        </aside>
      </div>
    </>
  );
}
