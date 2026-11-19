import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('dev'),
  // No trailing slash: it must equal the token's iss exactly.
  OKTA_ISSUER: z.url().refine((v) => !v.endsWith('/'), 'must not end with /'),
  OKTA_AUDIENCE: z.string().min(1),
  OKTA_CLIENT_ID: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  // Optional: without a key the review route answers 503 ai_unavailable, so dev and CI run without one.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  // Which OpenAI model reviews briefs; set it explicitly rather than trusting a default that ages.
  OPENAI_MODEL: z.string().min(1).optional(),
  // 'fake' stores a canned review labelled as such: the offline fallback for a demo without a key or model.
  REVIEW_GENERATOR: z.enum(['claude', 'openai', 'fake']).default('claude'),
  // The built web app to serve from this process (the image sets it); unset in dev, where Vite serves the web.
  WEB_DIST: z.string().min(1).optional(),
  // The Okta issuer baked into that bundle at build time. The CSP admits OKTA_ISSUER's origin, so the two must match.
  // Empty: an image built without Okta settings (CI); its bundle can't sign in, so it is not served.
  WEB_OKTA_ISSUER: z.string().optional(),
}).refine((env) => !env.WEB_DIST || !env.WEB_OKTA_ISSUER || env.WEB_OKTA_ISSUER === env.OKTA_ISSUER, {
  message: 'the web bundle was built for another Okta issuer (WEB_OKTA_ISSUER) than OKTA_ISSUER; sign-in would be blocked',
  path: ['WEB_OKTA_ISSUER'],
}).refine((env) => env.REVIEW_GENERATOR !== 'openai' || (env.OPENAI_API_KEY && env.OPENAI_MODEL), {
  message: 'REVIEW_GENERATOR=openai needs OPENAI_API_KEY and OPENAI_MODEL',
  path: ['REVIEW_GENERATOR'],
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
