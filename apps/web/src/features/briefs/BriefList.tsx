import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchBriefs } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

const updated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function BriefList({ wsId }: { wsId: string }) {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.briefs(wsId), queryFn: () => fetchBriefs(wsId) });

  if (isPending) return <p>Loading briefs…</p>;
  if (isError) return <p role="alert">Could not load briefs.</p>;

  return (
    <section aria-labelledby="briefs-heading">
      <h2 id="briefs-heading">Briefs</h2>
      {data.permissions.create && <Link to={`/w/${wsId}/briefs/new`}>New brief</Link>}
      {data.briefs.length === 0 ? (
        <p>No briefs yet.</p>
      ) : (
        <ul>
          {data.briefs.map((b) => (
            <li key={b.id}>
              <Link to={`/w/${wsId}/briefs/${b.id}`}>{b.title}</Link> · {b.status} · updated {updated.format(new Date(b.updatedAt))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
