import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, createBrief } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { BriefForm } from './BriefForm';

export function NewBriefPage() {
  const { wsId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (values: { title: string; body: string }) => createBrief(wsId, values),
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.brief(wsId, res.brief.id), res);
      await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId) });
      navigate(`/w/${wsId}/briefs/${res.brief.id}`, { replace: true });
    },
  });

  return (
    <>
      <p>
        <Link to={`/w/${wsId}`}>← Briefs</Link>
      </p>
      <h1>New brief</h1>
      {create.error && (
        <p role="alert">
          {create.error instanceof ApiError && create.error.status === 403
            ? 'Your role in this workspace cannot create briefs.'
            : 'Could not save the brief. Your text is still here; try again.'}
        </p>
      )}
      <BriefForm initial={{ title: '', body: '' }} submitLabel="Create brief" pending={create.isPending} onSubmit={create.mutate} />
    </>
  );
}
