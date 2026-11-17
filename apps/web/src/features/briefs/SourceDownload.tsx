import type { BriefSource } from '@briefly/contracts';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { downloadBriefSource } from '../../lib/api';

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Fetched with the bearer token in a header (never in a URL), then handed to the browser as a local blob.
export function SourceDownload({ wsId, briefId, source }: { wsId: string; briefId: string; source: BriefSource }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  const download = async () => {
    setState('loading');
    try {
      const url = URL.createObjectURL(await downloadBriefSource(wsId, briefId));
      const a = document.createElement('a');
      a.href = url;
      a.download = source.name;
      // Safari and older Firefox only download from an attached link, and cancel if the URL is revoked at once.
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return (
    <section aria-label="Original file" className="card grid gap-3 p-5">
      <p className="text-xs text-muted">Original</p>
      <p className="flex items-start gap-2 break-all text-ink">
        <FileText size={16} strokeWidth={1.5} className="mt-0.5 flex-none text-muted" aria-hidden />
        {source.name}
      </p>
      <p className="meta">{size(source.size)}</p>
      <button type="button" className="btn w-fit" onClick={download} disabled={state === 'loading'}>
        <Download size={16} strokeWidth={1.5} aria-hidden />
        {state === 'loading' ? 'Downloading…' : 'Download'}
      </button>
      {state === 'failed' && (
        <p role="alert" className="alert">
          Could not download the original.
        </p>
      )}
    </section>
  );
}
