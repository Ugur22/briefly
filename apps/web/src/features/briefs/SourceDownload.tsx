import type { BriefSource } from '@briefly/contracts';
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
    <p>
      Original: {source.name} ({size(source.size)}){' '}
      <button type="button" onClick={download} disabled={state === 'loading'}>
        {state === 'loading' ? 'Downloading…' : 'Download'}
      </button>
      {state === 'failed' && <span role="alert"> Could not download the original.</span>}
    </p>
  );
}
