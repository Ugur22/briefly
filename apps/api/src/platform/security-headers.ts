import type { FastifyInstance } from 'fastify';

// Okta tokens live in the browser's localStorage, so any script that runs on the page can read them: only our own
// bundle may run. connect-src admits the Okta origin for the PKCE token exchange, renewal and revocation.
// No frame-src on purpose: renewal uses the refresh token over XHR, never a hidden iframe.
export const contentSecurityPolicy = (oktaIssuer: string) =>
  [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${new URL(oktaIssuer).origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

export function registerSecurityHeaders(app: FastifyInstance, opts: { oktaIssuer: string; production: boolean }) {
  const csp = contentSecurityPolicy(opts.oktaIssuer);
  // onSend runs for every reply, errors and 429s included.
  app.addHook('onSend', async (_req, reply) => {
    // A route that set its own policy keeps it (the source download is served with `sandbox`).
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    // No includeSubDomains or preload: the demo runs on a shared *.fly.dev or *.onrender.com name.
    if (opts.production) reply.header('strict-transport-security', 'max-age=31536000');
  });
}
