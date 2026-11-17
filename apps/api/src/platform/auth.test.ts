import { generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signToken, testEnv, testJwks, validClaims } from '../test/fixtures';
import { verifyAccessToken } from './auth';

const opts = { issuer: testEnv.OKTA_ISSUER, audience: testEnv.OKTA_AUDIENCE, clientId: testEnv.OKTA_CLIENT_ID, jwks: testJwks };

describe('verifyAccessToken', () => {
  it('accepts a Briefly access token and keys identity on uid, not sub', async () => {
    const token = await signToken();

    await expect(verifyAccessToken(token, opts)).resolves.toEqual({ uid: '00uALICE', email: 'alice@test.dev', token });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.test/oauth2/default' }],
    ['another audience', { aud: 'api://other' }],
    ['another Okta client on the same server', { cid: '0oaOTHER' }],
    ['no role (Supabase would treat it as anon)', { role: undefined }],
    ['role anon', { role: 'anon' }],
    ['no uid', { uid: undefined }],
    ['an empty uid', { uid: '' }],
    ['an ID token (aud is the client id)', { aud: testEnv.OKTA_CLIENT_ID }],
    ['no email', { email: undefined }],
  ])('rejects a token from %s', async (_, overrides) => {
    await expect(verifyAccessToken(await signToken(overrides), opts)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signToken({}, { expiresAt: Math.floor(Date.now() / 1000) - 120 });

    await expect(verifyAccessToken(token, opts)).rejects.toThrow();
  });

  it('rejects a token signed with a key Okta never published', async () => {
    const { privateKey } = await generateKeyPair('RS256');

    await expect(verifyAccessToken(await signToken({}, { key: privateKey }), opts)).rejects.toThrow();
  });

  it('rejects alg=none', async () => {
    const token = new UnsecuredJWT(validClaims).setIssuedAt().setExpirationTime('5m').encode();

    await expect(verifyAccessToken(token, opts)).rejects.toThrow();
  });

  it('rejects HS256 signed with the public key material (algorithm confusion)', async () => {
    const token = await new SignJWT(validClaims)
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('not-a-real-secret'));

    await expect(verifyAccessToken(token, opts)).rejects.toThrow();
  });
});
