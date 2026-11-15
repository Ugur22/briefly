import { HealthResponse } from '@briefly/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
  }
}

// The only place that calls /api/*: responses are parsed against the shared contract, so drift fails loudly here.
async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status);
  return schema.parse(await res.json());
}

export const fetchHealth = () => getJson('/api/health', HealthResponse);
