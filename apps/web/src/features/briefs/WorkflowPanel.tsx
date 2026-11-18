import type { Brief, BriefPermissions, BriefResponse } from '@briefly/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, decideBrief, fetchMe, submitBrief } from '../../lib/api';
import { notify } from '../../lib/notify';
import { queryKeys } from '../../lib/queryKeys';
import { Status, STATUS_TEXT } from './Status';

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const DONE: Record<string, string> = {
  in_review: 'Submitted for review',
  approved: 'Brief approved',
  changes_requested: 'Sent back with your comment',
};

const ERRORS: Record<string, string> = {
  no_current_review: 'Generate an AI review of the current text before submitting.',
  self_approval: 'You submitted this brief, so someone else has to decide on it.',
  locked: 'This brief is locked while it is in review.',
  invalid_transition: 'That step is not possible from the brief’s current status.',
  not_in_review: 'This brief is no longer waiting for a decision.',
  conflict: 'Someone changed this brief. Reload to see the current version.',
  comment_required: 'Say what needs to change.',
  forbidden: 'Your role in this workspace cannot do that.',
};
const message = (err: unknown) => (err instanceof ApiError && err.code && ERRORS[err.code]) || 'That did not work. Try again.';

// Where the brief stands and why. Rendered near the title on small screens, so status and the approver's reason
// are not 2000px down the page, and at the top of the side column on large ones.
export function WorkflowStatus({ brief, permissions, headingId }: { brief: Brief; permissions: BriefPermissions; headingId?: string }) {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  const submittedByMe = me.data !== undefined && brief.submittedBy === me.data.id;
  const myDecision = brief.status === 'in_review' && permissions.decide && me.data !== undefined && !submittedByMe;
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <p className="text-xs text-muted">Status</p>
        <h2 id={headingId} className="text-base font-medium">
          <Status status={brief.status} />
          <span className="sr-only">Status: {STATUS_TEXT[brief.status]}</span>
        </h2>
      </div>
      {brief.status === 'changes_requested' && brief.decisionComment && (
        <p className="grid gap-1 rounded-control bg-unclear-soft px-3 py-2">
          <span className="text-xs text-ink-2">From the approver</span>
          <span className="text-ink">{brief.decisionComment}</span>
        </p>
      )}
      {brief.status === 'approved' && brief.decisionComment && (
        <p className="grid gap-1 rounded-control bg-sunken px-3 py-2">
          <span className="text-xs text-ink-2">Approver’s note</span>
          <span className="text-ink">{brief.decisionComment}</span>
        </p>
      )}
      {brief.status === 'approved' && <p className="text-ink-2">This brief is final.</p>}
      {brief.status === 'draft' && permissions.submit && <p className="text-ink-2">Next: check the AI review, then submit it for human review.</p>}
      {brief.status === 'in_review' && !myDecision && (
        <p className="text-ink-2">{submittedByMe ? 'You submitted this brief. An approver or admin will decide on it.' : 'Waiting for a decision. The brief and its review are locked meanwhile.'}</p>
      )}
      {myDecision && (
        <>
          <p className="text-ink-2">Your decision. Read the brief and its review, then approve or request changes.</p>
          {/* Below lg the decision form sits after the whole brief and review. */}
          <a href="#decide" className="btn btn-tonal w-fit hover:no-underline lg:hidden">
            Go to decision
          </a>
        </>
      )}
    </div>
  );
}

type Props = {
  reviewReady: boolean;
  // An approver must be able to read the review before approving it.
  reviewStatus: 'pending' | 'error' | 'success';
  onRetryReview: () => void;
  // Submitting sends the last saved review, so unsaved edits would silently not reach the approver.
  reviewEditing: boolean;
  wsId: string;
  brief: Brief;
  permissions: BriefPermissions;
};

// Where the brief stands, and the one or two actions that move it on. The database enforces every rule here;
// this only decides what to offer and explains refusals.
export function WorkflowPanel({ wsId, brief, permissions, reviewReady, reviewStatus, onRetryReview, reviewEditing }: Props) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  const [comment, setComment] = useState('');

  const moved = async (res: BriefResponse) => {
    queryClient.setQueryData(queryKeys.brief(wsId, brief.id), res);
    setComment('');
    notify.done(DONE[res.brief.status] ?? 'Status updated');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review(wsId, brief.id), exact: true }),
    ]);
  };
  const submit = useMutation({ mutationFn: () => submitBrief(wsId, brief.id, brief.version), onSuccess: moved });
  const decide = useMutation({
    // The comment box belongs to "Request changes"; approving doesn't send what was typed there.
    mutationFn: (decision: 'approve' | 'request_changes') =>
      decideBrief(wsId, brief.id, decision === 'approve' ? { decision } : { decision, comment: comment.trim() }),
    onSuccess: moved,
  });

  const submittedByMe = me.data !== undefined && brief.submittedBy === me.data.id;
  // Offer a decision only once we know this isn't the submitter (the database would refuse them anyway).
  const mayDecide = permissions.decide && me.data !== undefined && !submittedByMe;
  const sendBack = (e: FormEvent) => {
    e.preventDefault();
    decide.mutate('request_changes');
  };

  const when = (iso: string | null) => (iso ? stamp.format(new Date(iso)) : null);

  return (
    <section aria-labelledby="workflow-heading" className="grid gap-4 py-2 lg:pl-4">
      {/* Below lg the page shows the status under the title instead (WorkflowStatus in BriefPage). */}
      <div className="hidden lg:grid">
        <WorkflowStatus brief={brief} permissions={permissions} headingId="workflow-heading" />
      </div>

      {permissions.submit && reviewReady && reviewEditing && (
        <p role="status" className="note">Save or cancel your review edits before submitting.</p>
      )}
      {permissions.submit && reviewReady && !reviewEditing && (
        <button type="button" className="btn btn-primary justify-center" onClick={() => submit.mutate()} disabled={submit.isPending}>
          <Send size={16} strokeWidth={1.5} aria-hidden />
          {submit.isPending ? 'Submitting…' : brief.status === 'changes_requested' ? 'Resubmit for human review' : 'Submit for human review'}
        </button>
      )}
      {submit.error && (
        <p role="alert" className="alert">
          {message(submit.error)}
        </p>
      )}

      {mayDecide && (
        <form id="decide" onSubmit={sendBack} aria-label="Decide" className="grid scroll-mt-6 gap-3">
          {reviewStatus === 'pending' && <p role="status" className="note">Approve becomes available once the review has loaded.</p>}
          {reviewStatus === 'error' && (
            <div role="status" className="note flex-wrap items-center justify-between">
              <span>The review could not be loaded, so it cannot be approved yet.</span>
              <button type="button" className="btn btn-ghost" onClick={onRetryReview}>
                Try again
              </button>
            </div>
          )}
          <button type="button" className="btn btn-primary justify-center" onClick={() => decide.mutate('approve')} disabled={decide.isPending || reviewStatus !== 'success'}>
            <Check size={16} strokeWidth={1.5} aria-hidden />
            Approve
          </button>
          <label className="label">
            What needs to change
            <textarea className="textarea font-normal" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
          </label>
          <button type="submit" className="btn justify-center" disabled={decide.isPending || comment.trim() === ''}>
            Request changes
          </button>
        </form>
      )}
      {decide.error && (
        <p role="alert" className="alert">
          {message(decide.error)}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">Updated</dt>
        <dd className="meta self-center">{when(brief.updatedAt)}</dd>
        {brief.submittedAt && (
          <>
            <dt className="text-muted">Submitted</dt>
            <dd className="meta self-center">{when(brief.submittedAt)}</dd>
          </>
        )}
        {brief.decidedAt && (
          <>
            <dt className="text-muted">Decided</dt>
            <dd className="meta self-center">{when(brief.decidedAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
