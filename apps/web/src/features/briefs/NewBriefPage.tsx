import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardPaste, FileUp } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { BriefResponse } from '@briefly/contracts';
import { ApiError, createBrief, uploadBrief } from '../../lib/api';
import { notify } from '../../lib/notify';
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
    notify.done(res.brief.source ? 'Brief uploaded' : 'Brief created');
  };

  const create = useMutation({ mutationFn: (values: { title: string; body: string }) => createBrief(wsId, values), onSuccess: opened });
  const upload = useMutation({ mutationFn: ({ file, title }: { file: File; title: string }) => uploadBrief(wsId, file, title), onSuccess: opened });

  return (
    <div className="max-w-3xl">
      <Link to={`/w/${wsId}`} className="mb-4 inline-flex items-center gap-1 text-ink-2">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Briefs
      </Link>
      <h1 className="mb-6 page-title">New brief</h1>
      <div role="radiogroup" aria-label="How to add the brief" className="mb-6 inline-flex rounded-control border border-line bg-sunken p-1">
        {(['paste', 'upload'] as const).map((m) => (
          <label
            key={m}
            className={`flex h-8 cursor-pointer items-center gap-2 rounded-small px-3 transition-colors duration-150 ease-out has-focus-visible:outline-2 has-focus-visible:outline-accent ${
              mode === m ? 'bg-surface text-ink shadow-small' : 'text-ink-2'
            }`}
          >
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
            {m === 'paste' ? <ClipboardPaste size={16} strokeWidth={1.5} aria-hidden /> : <FileUp size={16} strokeWidth={1.5} aria-hidden />}
            {m === 'paste' ? 'Paste text' : 'Upload a file'}
          </label>
        ))}
      </div>

      {mode === 'paste' ? (
        <div className="grid gap-4">
          {create.error && (
            <p role="alert" className="alert">
              {create.error instanceof ApiError && create.error.status === 403
                ? 'Your role in this workspace cannot create briefs.'
                : 'Could not save the brief. Your text is still here; try again.'}
            </p>
          )}
          <BriefForm initial={{ title: '', body: '' }} submitLabel="Create brief" pending={create.isPending} onSubmit={create.mutate} />
        </div>
      ) : (
        <UploadBriefForm pending={upload.isPending} error={upload.error} onSubmit={(file, title) => upload.mutate({ file, title })} />
      )}
    </div>
  );
}
