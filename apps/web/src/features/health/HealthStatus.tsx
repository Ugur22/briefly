import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

export function HealthStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: queryKeys.health, queryFn: fetchHealth });

  if (isPending) return <p>Checking API…</p>;
  if (isError) return <p role="alert">API unreachable</p>;
  return (
    <p>
      API ok · v{data.version} ({data.commit})
    </p>
  );
}
