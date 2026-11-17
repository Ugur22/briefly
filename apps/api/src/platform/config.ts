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
