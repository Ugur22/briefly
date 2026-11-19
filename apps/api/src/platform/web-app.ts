import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Vite's build is index.html plus a flat assets/ folder of content-hashed files. Loaded once into memory, so a
// request is a map lookup: no file-system path is ever built from the URL.
export function loadWebApp(dist: string) {
  const assets = new Map<string, { body: Buffer; type: string }>();
  for (const name of readdirSync(join(dist, 'assets'))) {
    const type = TYPES[extname(name)];
    // Fail at start rather than 404 a file the build now emits.
    if (!type) throw new Error(`web build has assets/${name}, a type the API does not serve`);
    assets.set(name, { body: readFileSync(join(dist, 'assets', name)), type });
  }
  return { index: readFileSync(join(dist, 'index.html')), assets };
}
export type WebApp = ReturnType<typeof loadWebApp>;

export function registerWebApp(app: FastifyInstance, web: WebApp) {
  app.get('/assets/:name', { config: { public: true } }, (req: FastifyRequest<{ Params: { name: string } }>, reply) => {
    const asset = web.assets.get(req.params.name);
    if (!asset) return reply.code(404).send({ error: 'not found' });
    return reply.header('content-type', asset.type).header('cache-control', 'public, max-age=31536000, immutable').send(asset.body);
  });
}

// For the not-found handler: client-side routes (/w/:id/briefs, /login/callback) get index.html. A path with a
// file extension never does, so a stale tab asking for an old chunk gets a 404 instead of HTML parsed as script.
export function serveIndex(req: FastifyRequest, reply: FastifyReply, web: WebApp) {
  const path = req.url.split('?')[0] ?? '';
  if ((req.method !== 'GET' && req.method !== 'HEAD') || extname(path) !== '') return false;
  void reply.code(200).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').send(web.index);
  return true;
}
