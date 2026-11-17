import { HealthResponse } from '@briefly/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const healthRoutes: FastifyPluginAsyncZod<{ version: string; commit: string }> = async (app, opts) => {
  app.get('/health', { config: { public: true }, schema: { response: { 200: HealthResponse } } }, async () => ({
    status: 'ok' as const,
    version: opts.version,
    commit: opts.commit,
  }));
};
