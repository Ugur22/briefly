import rateLimit from '@fastify/rate-limit';
import { RATE_LIMITED, type Workspace, type WorkspaceRole } from '@briefly/contracts';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { IdentityRepo } from '../identity/infra/identity-repo';
import { requireAuth } from './auth';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by memberOf(): the caller's membership of the workspace in the URL.
    workspace: Workspace | null;
  }
}

export type Limit = { max: number; timeWindow: number };
export type Limits = { uploadPerUser: Limit; generatePerUser: Limit; generatePerWorkspace: Limit };

const MINUTE = 60_000;
export const defaultLimits: Limits = {
  uploadPerUser: { max: 20, timeWindow: 10 * MINUTE },
  generatePerUser: { max: 10, timeWindow: 10 * MINUTE },
  generatePerWorkspace: { max: 60, timeWindow: 60 * MINUTE },
};

type Check = { limit: Limit; key: (req: FastifyRequest) => string };

// In-memory counters: right for one API instance; several instances need a shared store (Redis).
// Register before the routes: they call app.createRateLimit() when they load.
export function registerRateLimit(app: FastifyInstance) {
  app.register(rateLimit, { global: false });
  app.decorateRequest('workspace', null);
}

// Not app.rateLimit(): its preHandlers share one per-request "already ran" flag, so a second limiter on the same
// route (user, then workspace) would silently never count. createRateLimit() checkers have no such flag.
export function limitedBy(app: FastifyInstance, name: string, checks: Check[]): preHandlerAsyncHookHandler {
  const checkers = checks.map(({ limit, key }) => app.createRateLimit({ ...limit, keyGenerator: (req) => `${name}:${key(req)}` }));
  // Peek first, count only if every limit has room: a user stuck at their own limit who keeps retrying must not
  // also drain the workspace's quota for everyone else.
  return async (req, reply) => {
    let retryAfter = 0;
    for (const check of checkers) {
      const peek = await check(req, { increment: false });
      if (!peek.isAllowed && peek.remaining === 0) retryAfter = Math.max(retryAfter, peek.ttlInSeconds, 1);
    }
    if (retryAfter > 0) return reply.code(429).header('retry-after', String(retryAfter)).send({ error: RATE_LIMITED });
    // The count itself decides too: parallel requests that all passed the peek can't all get through.
    for (const check of checkers) {
      const counted = await check(req);
      if (!counted.isAllowed && counted.isExceeded) retryAfter = Math.max(retryAfter, counted.ttlInSeconds, 1);
    }
    if (retryAfter > 0) return reply.code(429).header('retry-after', String(retryAfter)).send({ error: RATE_LIMITED });
  };
}

// Membership and role are checked before any limiter, so refused calls never count: an outsider can't use up a
// workspace's quota through its URL. Not a member and no such workspace both 404, as everywhere else.
export function memberOf(identityFor: (token: string) => IdentityRepo, allowed: (role: WorkspaceRole) => boolean): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ws = await identityFor(requireAuth(req).token).findWorkspace(wsId);
    if (!ws) return reply.code(404).send({ error: 'not found' });
    if (!allowed(ws.role)) return reply.code(403).send({ error: 'forbidden' });
    req.workspace = ws;
  };
}

// Keys are the verified Okta uid and the checked workspace id, never the IP: behind a proxy everyone shares one.
export const byUser = (req: FastifyRequest) => `user:${requireAuth(req).uid}`;
export const byWorkspace = (req: FastifyRequest) => `ws:${requireWorkspace(req).id}`;

export const requireWorkspace = (req: FastifyRequest): Workspace => {
  if (!req.workspace) throw new Error('route has no memberOf() preHandler');
  return req.workspace;
};
