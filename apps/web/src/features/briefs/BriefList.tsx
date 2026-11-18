import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { fetchBriefs } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { Status } from './Status';

const updated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function BriefList({ wsId }: { wsId: string }) {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.briefs(wsId), queryFn: () => fetchBriefs(wsId) });

  if (isPending) return <p className="text-muted">Loading briefs…</p>;
  if (isError) return <p role="alert" className="alert">Could not load briefs.</p>;

  return (
    <section aria-labelledby="briefs-heading" className="grid max-w-4xl gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="briefs-heading" className="text-base font-medium">
          Briefs
        </h2>
        {data.permissions.create && (
          <Link to={`/w/${wsId}/briefs/new`} className="btn btn-primary hover:no-underline">
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            New brief
          </Link>
        )}
      </div>

      {data.briefs.length === 0 ? (
        <div className="card grid gap-1 px-5 py-12 text-center">
          <p className="font-medium">No briefs yet.</p>
          {data.permissions.create && <p className="text-ink-2">Paste or upload a client brief to check it against the seven areas.</p>}
        </div>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {data.briefs.map((b) => (
            <li key={b.id} className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-2 py-3 hover:bg-accent-soft md:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <Link to={`/w/${wsId}/briefs/${b.id}`} className="truncate font-doc text-lg text-accent-hover hover:underline">
                {b.title}
              </Link>
              <Status status={b.status} />
              <span className="meta hidden justify-self-end whitespace-nowrap md:block">updated {updated.format(new Date(b.updatedAt))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
