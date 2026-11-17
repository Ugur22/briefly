import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchWorkspaces } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export function WorkspaceList() {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.workspaces, queryFn: fetchWorkspaces });

  if (isPending) return <p className="text-muted">Loading workspaces…</p>;
  if (isError) return <p role="alert" className="alert">Could not load workspaces.</p>;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] leading-tight font-medium">Your workspaces</h1>
        <p className="mt-2 text-ink-2">Each workspace is one client account. You see the briefs of the workspaces you belong to.</p>
      </header>
      {data.length === 0 ? (
        <p className="card px-5 py-12 text-center text-ink-2">You are not in any workspace yet. Ask an admin to add you.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {data.map((ws) => (
            <li key={ws.id}>
              <Link
                to={`/w/${ws.id}`}
                className="card grid gap-2 p-5 text-ink transition-colors duration-150 ease-out hover:border-line-strong hover:no-underline"
              >
                <span className="text-base font-medium">{ws.name}</span>
                <span className="meta">{ws.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
