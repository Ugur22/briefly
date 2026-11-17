import type { Brief, BriefPermissions, BriefResponse, BriefStatus } from '@briefly/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, decideBrief, fetchMe, submitBrief } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export const STATUS_TEXT: Record<BriefStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
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

type Props = { wsId: string; brief: Brief; permissions: BriefPermissions };

// Where the brief stands, and the one or two actions that move it on. The database enforces every rule here;
// this only decides what to offer and explains refusals.
export function WorkflowPanel({ wsId, brief, permissions }: Props) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  const [comment, setComment] = useState('');

  const moved = async (res: BriefResponse) => {
    queryClient.setQueryData(queryKeys.brief(wsId, brief.id), res);
    setComment('');
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

  return (
    <section aria-labelledby="workflow-heading">
      <h2 id="workflow-heading">Status: {STATUS_TEXT[brief.status]}</h2>

      {brief.status === 'changes_requested' && brief.decisionComment && (
        <p>
          <strong>Changes requested:</strong> {brief.decisionComment}
        </p>
      )}
      {brief.status === 'approved' && <p>Approved{brief.decisionComment ? `: ${brief.decisionComment}` : '.'} This brief is final.</p>}
      {brief.status === 'in_review' && (
        <p>{submittedByMe ? 'You submitted this brief. An approver or admin will decide on it.' : 'Waiting for a decision. The brief and its review are locked meanwhile.'}</p>
      )}

      {permissions.submit && (
        <p>
          <button type="button" onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : brief.status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review'}
          </button>
        </p>
      )}
      {submit.error && <p role="alert">{message(submit.error)}</p>}

      {mayDecide && (
        <form onSubmit={sendBack} aria-label="Decide">
          <p>
            <button type="button" onClick={() => decide.mutate('approve')} disabled={decide.isPending}>
              Approve
            </button>
          </p>
          <p>
            <label>
              What needs to change
              <br />
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} cols={80} />
            </label>
          </p>
          <button type="submit" disabled={decide.isPending || comment.trim() === ''}>
            Request changes
          </button>
        </form>
      )}
      {decide.error && <p role="alert">{message(decide.error)}</p>}
    </section>
  );
}
