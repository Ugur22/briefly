import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, deleteBrief, fetchBrief, isNotFound, updateBrief } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { BriefForm } from './BriefForm';

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

  const query = useQuery({
    queryKey: queryKeys.brief(wsId, briefId),
    queryFn: () => fetchBrief(wsId, briefId),
    retry: (count, err) => !isNotFound(err) && count < 1,
  });

  const save = useMutation({
    mutationFn: (values: { title: string; body: string; version: number }) => updateBrief(wsId, briefId, values),
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.brief(wsId, briefId), res);
      await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId), exact: true });
      setEditingFrom(null);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteBrief(wsId, briefId),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.brief(wsId, briefId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId), exact: true });
      navigate(`/w/${wsId}`, { replace: true });
    },
  });

  const back = (
    <p>
      <Link to={`/w/${wsId}`}>← Briefs</Link>
    </p>
  );

  if (query.isPending) return <p>Loading brief…</p>;
  if (isNotFound(query.error)) {
    return (
      <>
        {back}
        <p role="alert">Brief not found.</p>
      </>
    );
  }
  if (query.error) return <p role="alert">Could not load this brief.</p>;

  const { brief, permissions } = query.data;

  if (editingFrom !== null) {
    return (
      <>
        {back}
        <h1>Edit brief</h1>
        {save.error && <p role="alert">{saveError(save.error)}</p>}
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
      </>
    );
  }

  return (
    <>
      {back}
      <h1>{brief.title}</h1>
      <p>
        {brief.status} · version {brief.version}
      </p>
      <p>
        {permissions.edit && (
          <button type="button" onClick={() => setEditingFrom(brief.version)}>
            Edit
          </button>
        )}{' '}
        {permissions.delete && !confirmingDelete && (
          <button type="button" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        )}
      </p>
      {confirmingDelete && (
        <p role="group" aria-label="Confirm delete">
          Delete “{brief.title}” for everyone in this workspace?{' '}
          <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Yes, delete'}
          </button>{' '}
          <button type="button" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending}>
            Keep it
          </button>
        </p>
      )}
      {remove.error && <p role="alert">Could not delete this brief.</p>}
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{brief.body}</pre>
    </>
  );
}
