import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

export const testEnv = {
  NODE_ENV: 'test',
  OKTA_ISSUER: 'https://okta.test/oauth2/default',
  OKTA_AUDIENCE: 'api://briefly',
  OKTA_CLIENT_ID: '0oaTESTCLIENT',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
} satisfies NodeJS.ProcessEnv;

const kid = 'test-key';
const { privateKey, publicKey } = await generateKeyPair('RS256');
export const testJwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256' }] });

// The shape of a real Okta access token for Briefly; override fields to break one claim at a time.
export const validClaims = {
  iss: testEnv.OKTA_ISSUER,
  aud: testEnv.OKTA_AUDIENCE,
  cid: testEnv.OKTA_CLIENT_ID,
  role: 'authenticated',
  uid: '00uALICE',
  sub: 'alice@test.dev',
  email: 'alice@test.dev',
};

export async function signToken(overrides: JWTPayload = {}, opts: { expiresAt?: string | number; key?: CryptoKey } = {}) {
  return new SignJWT({ ...validClaims, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime(opts.expiresAt ?? '5m')
    .sign(opts.key ?? privateKey);
}
