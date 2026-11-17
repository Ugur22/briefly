import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchWorkspace, isNotFound } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { BriefList } from '../briefs/BriefList';

export function WorkspacePage() {
  const { wsId = '' } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.workspace(wsId),
    queryFn: () => fetchWorkspace(wsId),
    retry: (count, err) => !isNotFound(err) && count < 1,
  });

  if (isPending) return <p className="text-muted">Loading workspace…</p>;
  if (isNotFound(error)) {
    return (
      <p role="alert" className="alert">
        Workspace not found. <Link to="/">Back to your workspaces</Link>
      </p>
    );
  }
  if (error) return <p role="alert" className="alert">Could not load this workspace.</p>;

  return (
    <>
      <header className="mb-6">
        <h1 className="page-title">{data.name}</h1>
        <p className="mt-2 text-ink-2">
          Your role: <span className="meta">{data.role}</span>
        </p>
      </header>
      <BriefList wsId={wsId} />
    </>
  );
}
