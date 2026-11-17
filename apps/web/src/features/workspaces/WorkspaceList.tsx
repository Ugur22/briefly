import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchWorkspaces } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export function WorkspaceList() {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.workspaces, queryFn: fetchWorkspaces });

  if (isPending) return <p>Loading workspaces…</p>;
  if (isError) return <p role="alert">Could not load workspaces.</p>;
  if (data.length === 0) return <p>You are not in any workspace yet. Ask an admin to add you.</p>;

  return (
    <>
      <h1>Your workspaces</h1>
      <ul>
        {data.map((ws) => (
          <li key={ws.id}>
            <Link to={`/w/${ws.id}`}>{ws.name}</Link> · {ws.role}
          </li>
        ))}
      </ul>
    </>
  );
}
