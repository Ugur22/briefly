import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { JWTVerifyGetKey } from 'jose';
import { healthRoutes } from './http/health';
import { identityRepo, type IdentityRepo } from './identity/infra/identity-repo';
import { identityRoutes } from './identity/http/routes';
import { briefsRepo, type BriefsRepo } from './briefs/infra/briefs-repo';
import { briefsRoutes } from './briefs/http/routes';
import { sourceRoutes } from './briefs/http/source-routes';
import { createTextExtractor, type TextExtractor } from './briefs/infra/extract-text';
import { sourceStorage, type SourceStorage } from './briefs/infra/source-storage';
import type { ReviewGenerator, ReviewsRepo } from './briefs/application/generate-review';
import { reviewRoutes } from './briefs/http/review-routes';
import { claudeReviewGenerator, fakeReviewGenerator } from './briefs/infra/claude-review-generator';
import { openAIReviewGenerator } from './briefs/infra/openai-review-generator';
import { reviewsRepo } from './briefs/infra/reviews-repo';
import type { FastifyBaseLogger } from 'fastify';
import { isApiPath, oktaJwks, registerAuth } from './platform/auth';
import { registerSecurityHeaders } from './platform/security-headers';
import { loadWebApp, registerWebApp, serveIndex, type WebApp } from './platform/web-app';
import { defaultLimits, registerRateLimit, type Limits } from './platform/rate-limit';
import type { Config } from './platform/config';
import { userClientFactory } from './platform/supabase';

// As the router sees it (%61pi is api), so an encoded API path is never answered with the web app.
const decodedPath = (url: string) => {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
};

function loggerOptions(config: Config) {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: config.LOG_LEVEL };
}

// Picks the model adapter from config; null means AI review is unavailable (the route answers 503).
export function reviewGeneratorFrom(config: Config, log: FastifyBaseLogger): ReviewGenerator | null {
  switch (config.REVIEW_GENERATOR) {
    case 'fake':
      return fakeReviewGenerator;
    case 'openai':
      return config.OPENAI_API_KEY && config.OPENAI_MODEL ? openAIReviewGenerator({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, log }) : null;
    case 'claude':
      return config.ANTHROPIC_API_KEY ? claudeReviewGenerator({ apiKey: config.ANTHROPIC_API_KEY, log }) : null;
  }
}

// Seams for tests: a local key set instead of Okta's, and in-memory repos instead of Supabase.
export type AppDeps = {
  jwks?: JWTVerifyGetKey;
  repoFor?: (accessToken: string) => IdentityRepo;
  briefsFor?: (accessToken: string) => BriefsRepo;
  sourcesFor?: (accessToken: string) => SourceStorage;
  extract?: TextExtractor;
  reviewsFor?: (accessToken: string) => ReviewsRepo;
  // undefined: from config; null: AI unavailable.
  generate?: ReviewGenerator | null;
  limits?: Limits;
  // The built web app; by default loaded from WEB_DIST when the image has one built for this issuer.
  web?: WebApp | null;
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
  const web = deps.web !== undefined ? deps.web : config.WEB_DIST && config.WEB_OKTA_ISSUER ? loadWebApp(config.WEB_DIST) : null;
  if (web) registerWebApp(app, web);
  app.setNotFoundHandler((req, reply) => {
    if (web && !isApiPath(decodedPath(req.url)) && serveIndex(req, reply, web)) return;
    return reply.code(404).send({ error: 'not found' });
  });
  registerSecurityHeaders(app, { oktaIssuer: config.OKTA_ISSUER, production: config.NODE_ENV === 'production' });

  registerAuth(app, {
    issuer: config.OKTA_ISSUER,
    audience: config.OKTA_AUDIENCE,
    clientId: config.OKTA_CLIENT_ID,
    jwks: deps.jwks ?? oktaJwks(config.OKTA_ISSUER),
  });

  registerRateLimit(app);
  const limits = deps.limits ?? defaultLimits;

  const userClient = userClientFactory(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
  const repoFor = deps.repoFor ?? ((token: string) => identityRepo(userClient(token)));
  const briefsFor = deps.briefsFor ?? ((token: string) => briefsRepo(userClient(token)));
  const sourcesFor = deps.sourcesFor ?? ((token: string) => sourceStorage(userClient(token)));
  const reviewsFor = deps.reviewsFor ?? ((token: string) => reviewsRepo(userClient(token)));
  const generate = deps.generate !== undefined ? deps.generate : reviewGeneratorFrom(config, app.log);

  app.register(healthRoutes, { prefix: '/api', version: config.APP_VERSION, commit: config.GIT_SHA });
  app.register(identityRoutes, { prefix: '/api', repoFor });
  app.register(briefsRoutes, { prefix: '/api', identityFor: repoFor, briefsFor, sourcesFor });
  app.register(reviewRoutes, { prefix: '/api', identityFor: repoFor, briefsFor, reviewsFor, generate, limits });
  app.register(sourceRoutes, { prefix: '/api', identityFor: repoFor, briefsFor, sourcesFor, extract: deps.extract ?? createTextExtractor(), limits });

  return app;
}
