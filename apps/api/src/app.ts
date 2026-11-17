import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { JWTVerifyGetKey } from 'jose';
import { healthRoutes } from './http/health';
import { identityRepo, type IdentityRepo } from './identity/infra/identity-repo';
import { identityRoutes } from './identity/http/routes';
import { oktaJwks, registerAuth } from './platform/auth';
import type { Config } from './platform/config';
import { userClientFactory } from './platform/supabase';

function loggerOptions(config: Config) {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: config.LOG_LEVEL };
}

// Seams for tests: a local key set instead of Okta's, and an in-memory repo instead of Supabase.
export type AppDeps = {
  jwks?: JWTVerifyGetKey;
  repoFor?: (accessToken: string) => IdentityRepo;
};

export function buildApp(config: Config, deps: AppDeps = {}) {
  const app = Fastify({ logger: loggerOptions(config) }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Every error leaves as the ApiErrorBody contract; details (db op and code, stack) stay in the log.
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    else req.log.info({ err }, 'request refused');
    return reply.code(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  registerAuth(app, {
    issuer: config.OKTA_ISSUER,
    audience: config.OKTA_AUDIENCE,
    clientId: config.OKTA_CLIENT_ID,
    jwks: deps.jwks ?? oktaJwks(config.OKTA_ISSUER),
  });

  const userClient = userClientFactory(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
  const repoFor = deps.repoFor ?? ((token: string) => identityRepo(userClient(token)));

  app.register(healthRoutes, { prefix: '/api', version: config.APP_VERSION, commit: config.GIT_SHA });
  app.register(identityRoutes, { prefix: '/api', repoFor });

  return app;
}
