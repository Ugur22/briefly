import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

// A quiet dot in the sidebar; the build it's talking to is in the tooltip for whoever needs it.
export function HealthStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.health, queryFn: fetchHealth });

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <span className="size-2 rounded-full bg-muted" aria-hidden />
        Checking API…
      </p>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="flex items-center gap-2 text-xs text-negative">
        <span className="size-2 rounded-full bg-negative" aria-hidden />
        API unreachable
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-xs text-muted" title={`v${data.version} (${data.commit})`}>
      <span className="size-2 rounded-full bg-present" aria-hidden />
      Connected <span className="meta">v{data.version}</span>
    </p>
  );
}
