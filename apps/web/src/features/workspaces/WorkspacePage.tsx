import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, fetchWorkspace } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

// 400 is a malformed id in the URL; to the user that is the same as a workspace that doesn't exist.
const isNotFound = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 400);

export function WorkspacePage() {
  const { wsId = '' } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.workspace(wsId),
    queryFn: () => fetchWorkspace(wsId),
    retry: (count, err) => !isNotFound(err) && count < 1,
  });

  if (isPending) return <p>Loading workspace…</p>;
  if (isNotFound(error)) {
    return (
      <p role="alert">
        Workspace not found. <Link to="/">Back to your workspaces</Link>
      </p>
    );
  }
  if (error) return <p role="alert">Could not load this workspace.</p>;

  return (
    <>
      <p>
        <Link to="/">← Workspaces</Link>
      </p>
      <h1>{data.name}</h1>
      <p>Your role: {data.role}</p>
    </>
  );
}
