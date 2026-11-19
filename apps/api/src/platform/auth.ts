import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AuthContext = { uid: string; email: string; token: string };

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export type AuthOptions = {
  issuer: string;
  audience: string;
  clientId: string;
  jwks: JWTVerifyGetKey;
};

export const oktaJwks = (issuer: string) => createRemoteJWKSet(new URL(`${issuer}/v1/keys`));

class TokenRejected extends Error {}

const isTokenError = (err: unknown) =>
  err instanceof TokenRejected || (err instanceof errors.JOSEError && !(err instanceof errors.JWKSTimeout));

export async function verifyAccessToken(token: string, opts: AuthOptions): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, opts.jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ['RS256'],
    clockTolerance: 30,
  });
  // aud is per authorization server in Okta, so cid is what proves the token was issued to Briefly.
  if (payload.cid !== opts.clientId) throw new TokenRejected('cid');
  // Without role=authenticated, Supabase would run the request as anon.
  if (payload.role !== 'authenticated') throw new TokenRejected('role');
  if (typeof payload.uid !== 'string' || payload.uid === '') throw new TokenRejected('uid');
  if (typeof payload.email !== 'string' || payload.email === '') throw new TokenRejected('email');
  return { uid: payload.uid, email: payload.email, token };
}

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/') || path.startsWith('/api?');

// Deny by default: every /api request needs a valid token unless its route opts out with `config: { public: true }`.
// Unknown API routes therefore answer 401 to anonymous callers, which reveals nothing about what exists.
// Everything outside /api is the web app's static build, which is public by nature.
export function registerAuth(app: FastifyInstance, opts: AuthOptions) {
  app.decorateRequest('auth', null);
  // The check above skips everything outside /api, so a protected route must not be registered outside it.
  app.addHook('onRoute', (route) => {
    if (!isApiPath(route.url) && !route.config?.public) throw new Error(`${route.url} is outside /api: mark it public or move it`);
  });
  app.addHook('onRequest', async (req, reply) => {
    // The matched route's pattern, not the raw URL: the router decodes %61pi to api, a string check would not.
    if (req.routeOptions.config?.public || !isApiPath(req.routeOptions.url ?? req.url)) return;

    const token = bearerToken(req);
    if (!token) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }
    try {
      req.auth = await verifyAccessToken(token, opts);
    } catch (err) {
      // Okta's key set unreachable is our outage, not a bad token: a 401 here would sign every user out.
      if (!isTokenError(err)) {
        req.log.error({ err }, 'could not verify access token');
        return reply.code(503).send({ error: 'unavailable' });
      }
      req.log.debug({ reason: err instanceof Error ? err.message : 'unknown' }, 'access token rejected');
      return reply.code(401).header('WWW-Authenticate', 'Bearer error="invalid_token"').send({ error: 'unauthorized' });
    }
  });
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new Error('route is not public but has no auth context');
  return req.auth;
}
