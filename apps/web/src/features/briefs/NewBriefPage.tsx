import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { BriefResponse } from '@briefly/contracts';
import { ApiError, createBrief, uploadBrief } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { BriefForm } from './BriefForm';
import { UploadBriefForm } from './UploadBriefForm';

type Mode = 'paste' | 'upload';

export function NewBriefPage() {
  const { wsId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('paste');

  const opened = async (res: BriefResponse) => {
    queryClient.setQueryData(queryKeys.brief(wsId, res.brief.id), res);
    await queryClient.invalidateQueries({ queryKey: queryKeys.briefs(wsId) });
    navigate(`/w/${wsId}/briefs/${res.brief.id}`, { replace: true });
  };

  const create = useMutation({ mutationFn: (values: { title: string; body: string }) => createBrief(wsId, values), onSuccess: opened });
  const upload = useMutation({ mutationFn: ({ file, title }: { file: File; title: string }) => uploadBrief(wsId, file, title), onSuccess: opened });

  return (
    <>
      <p>
        <Link to={`/w/${wsId}`}>← Briefs</Link>
      </p>
      <h1>New brief</h1>
      <p role="radiogroup" aria-label="How to add the brief">
        {(['paste', 'upload'] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />{' '}
            {m === 'paste' ? 'Paste text' : 'Upload a file'}{' '}
          </label>
        ))}
      </p>

      {mode === 'paste' ? (
        <>
          {create.error && (
            <p role="alert">
              {create.error instanceof ApiError && create.error.status === 403
                ? 'Your role in this workspace cannot create briefs.'
                : 'Could not save the brief. Your text is still here; try again.'}
            </p>
          )}
          <BriefForm initial={{ title: '', body: '' }} submitLabel="Create brief" pending={create.isPending} onSubmit={create.mutate} />
        </>
      ) : (
        <UploadBriefForm pending={upload.isPending} error={upload.error} onSubmit={(file, title) => upload.mutate({ file, title })} />
      )}
    </>
  );
}
