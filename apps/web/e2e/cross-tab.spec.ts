import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { baseRoutes, briefPath, briefRoutes, workspacePath } from './mockApi';
import { colleague, me } from './fixtures/workspaces';

const issuer = 'https://okta.invalid/oauth2/default';
const clientId = 'visual-check';
const second = { id: colleague, email: 'second@agency.example' };
const keys = crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['sign', 'verify']);

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function tokens(account: typeof me, generation: number, ttl: number) {
  const iat = Math.floor(Date.now() / 1000);
  const expiresAt = iat + ttl;
  const claims = { iss: issuer, sub: account.id, uid: account.id, email: account.email, aud: clientId, iat, exp: expiresAt, ver: 1, jti: String(generation) };
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const body = encode({ alg: 'RS256', kid: 'offline' }) + '.' + encode(claims);
  const jwt = body + '.' + base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (await keys).privateKey, new TextEncoder().encode(body))));
  const shared = { expiresAt, scopes: ['openid', 'offline_access'], authorizeUrl: issuer + '/v1/authorize' };
  return {
    accessToken: { ...shared, accessToken: jwt, tokenType: 'Bearer', claims, userinfoUrl: issuer + '/v1/userinfo' },
    idToken: { ...shared, idToken: jwt, claims, issuer, clientId },
    refreshToken: { ...shared, refreshToken: 'offline-' + generation, tokenUrl: issuer + '/v1/token', issuer },
  };
}

async function installSession(page: Page, session: Awaited<ReturnType<typeof tokens>>) {
  await page.evaluate(async (session) => {
    const modulePath = '/src/lib/auth.ts';
    const { oktaAuth } = await import(modulePath);
    oktaAuth.tokenManager.setTokens(session);
  }, session);
}

async function offline(context: BrowserContext, origin: string, ttl = 3600) {
  const jwk = { ...await crypto.subtle.exportKey('jwk', (await keys).publicKey), kid: 'offline', use: 'sig' };
  let generation = 0;
  const refreshes: Page[] = [];
  // A failed expect inside a route handler can leave the request hanging instead of failing the test; collect here.
  const problems: string[] = [];
  const accounts = new Map<string, typeof me>();
  async function issue(account: typeof me) {
    const session = await tokens(account, generation, ttl);
    accounts.set('Bearer ' + session.accessToken.accessToken, account);
    return session;
  }
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === origin) {
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const account = accounts.get(req.headers().authorization ?? '');
      if (!account) return route.fulfill({ status: 401 });
      const json = url.pathname === '/api/me' ? account
        : url.pathname === '/api/workspaces' && account.id === colleague ? { workspaces: [] }
        : baseRoutes[req.method() + ' ' + url.pathname];
      return route.fulfill({ status: json ? 200 : 404, json: json ?? {} });
    }
    if (url.origin !== new URL(issuer).origin) return route.abort();
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      return route.fulfill({ json: { issuer, jwks_uri: issuer + '/v1/keys', token_endpoint: issuer + '/v1/token' } });
    }
    if (url.pathname.endsWith('/keys')) return route.fulfill({ json: { keys: [jwk] } });
    if (url.pathname.endsWith('/revoke')) return route.fulfill({ status: 200, body: '' });
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 302, headers: { location: origin } });
    if (url.pathname.endsWith('/token')) {
      const form = new URLSearchParams(req.postData() ?? '');
      if (form.get('grant_type') !== 'refresh_token') problems.push(`unexpected grant ${form.get('grant_type')}`);
      if (form.get('refresh_token') !== 'offline-' + generation) {
        problems.push(`stale refresh token ${form.get('refresh_token')} while offline-${generation} is current`);
      }
      refreshes.push(req.frame().page());
      generation++;
      const session = await issue(me);
      return route.fulfill({ json: {
        token_type: 'Bearer', scope: form.get('scope'), expires_in: ttl, access_token: session.accessToken.accessToken,
        id_token: session.idToken.idToken, refresh_token: session.refreshToken.refreshToken,
      } });
    }
    return route.abort();
  });
  return { issue, refreshes, problems };
}

const signIn = (page: Page) => page.getByRole('button', { name: 'Sign in with Okta' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });

test('independent deep link recovers session and observes signout and account switch', async ({ page, context, baseURL }) => {
  const provider = await offline(context, baseURL!);
  await page.goto('/');
  await expect(signIn(page)).toBeVisible();
  await installSession(page, await provider.issue(me));
  await expect(heading(page, 'Your workspaces')).toBeVisible();
  const peer = await context.newPage();
  await peer.goto(workspacePath);
  await expect(heading(peer, 'Briefs')).toBeVisible();
  await expect(peer).toHaveURL(baseURL + workspacePath);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(signIn(peer)).toBeVisible();
  await expect(signIn(page)).toBeVisible();
  await peer.goto('/');
  // goto resolves before the app has subscribed to storage events; a session installed earlier is missed on slow runners.
  await expect(signIn(peer)).toBeVisible();
  await installSession(page, await provider.issue(second));
  await expect(peer.getByText(/not in any workspace/)).toBeVisible();
  await expect(peer.getByRole('link', { name: /Noordzee Energie/ })).toHaveCount(0);
});

test('one tab rotates the refresh token and the survivor renews after leader close', async ({ page, context, baseURL }) => {
  test.setTimeout(60000);
  // The SDK schedules renewal 30 seconds before expiry.
  const provider = await offline(context, baseURL!, 40);
  const peer = await context.newPage();
  // Renewals keep firing every ~10 s, so assert who refreshes and that the survivor follows storage, never a fixed
  // generation. Reloads and page errors are recorded so a failure explains itself.
  const events: string[] = [];
  for (const [name, tab] of [['page', page], ['peer', peer]] as const) {
    tab.on('load', () => events.push(`${name} load`));
    tab.on('pageerror', (err) => events.push(`${name} error: ${err.message}`));
  }
  const who = (tab: Page | undefined) => (tab === page ? 'page' : tab === peer ? 'peer' : 'unknown');
  const story = () => [...events, `refreshes: ${provider.refreshes.map(who).join(', ')}`, ...provider.problems].join('\n');
  // Poll messages are fixed when the poll starts; attach the history as it stood when the wait gave up.
  const explained = (wait: Promise<unknown>) => wait.catch((err: Error) => {
    throw new Error(`${err.message}\n--- what happened ---\n${story()}`);
  });

  await Promise.all([page.goto('/'), peer.goto('/')]);
  await expect(signIn(peer)).toBeVisible();
  await expect(signIn(page)).toBeVisible();
  await installSession(page, await provider.issue(me));
  for (const tab of [page, peer]) await expect(heading(tab, 'Your workspaces')).toBeVisible();
  await expect.poll(() => provider.refreshes.length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
  const leader = provider.refreshes[0];
  if (!leader) throw new Error('No tab sent the first refresh request');
  const survivor = leader === page ? peer : page;

  // The survivor's auth state follows the rotated token in shared storage, whichever generation that is by now.
  await explained(expect.poll(() => survivor.evaluate(async () => {
    const modulePath = '/src/lib/auth.ts';
    const { oktaAuth } = await import(modulePath);
    const state = oktaAuth.authStateManager.getAuthState()?.idToken?.claims?.jti;
    const stored = JSON.parse(localStorage.getItem('okta-token-storage') ?? '{}')?.idToken?.claims?.jti;
    return stored !== undefined && stored !== '0' && state === stored;
  }), { timeout: 20000 }).toBe(true));
  expect(provider.refreshes.every((tab) => tab === leader), `only the leader refreshes while both tabs are open\n${story()}`).toBe(true);

  const before = provider.refreshes.length;
  await leader.close();
  await explained(expect.poll(() => provider.refreshes.length, { timeout: 25000 }).toBeGreaterThan(before));
  // A request the leader had in flight when it closed is fine; every refresh it didn't start comes from the survivor.
  expect(provider.refreshes.slice(before).every((tab) => tab === survivor), `survivor takes over\n${story()}`).toBe(true);
  expect(provider.problems, story()).toEqual([]);
  await survivor.reload();
  await expect(heading(survivor, 'Your workspaces')).toBeVisible();
});

test('a dirty form cannot send account A’s draft after shared storage switches to B', async ({ page, context, baseURL }) => {
  const provider = await offline(context, baseURL!);
  await page.goto('/');
  await expect(signIn(page)).toBeVisible();
  await installSession(page, await provider.issue(me));
  const editor = await context.newPage();
  await editor.goto(workspacePath + '/briefs/new');
  await editor.getByLabel('Title').fill('Account A only');
  await editor.getByLabel('Brief', { exact: true }).fill('Private draft for A');
  const writes: string[] = [];
  editor.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url());
  });

  // Split the SDK storage write from its broadcast so the old form is deterministically still mounted.
  const replacement = await provider.issue(second);
  await page.evaluate((value) => localStorage.setItem('okta-token-storage', JSON.stringify(value)), replacement);
  await expect(editor.getByLabel('Title')).toHaveValue('Account A only');
  await editor.getByRole('button', { name: 'Create brief' }).click();
  await expect(editor.getByRole('alert')).toContainText('Could not save');
  expect(writes).toEqual([]);
});

test('an interrupted review save restores the draft after same-account sign-in', async ({ page, context, baseURL }) => {
  const provider = await offline(context, baseURL!);
  const path = briefPath('reviewed');
  const routes = briefRoutes('reviewed', 'done');
  let saves = 0;
  await page.route('**/api/workspaces/*/briefs/**', async route => {
    if (route.request().method() === 'PUT') {
      saves++;
      return route.fulfill({ status: 401 });
    }
    const json = routes['GET ' + new URL(route.request().url()).pathname];
    return route.fulfill({ status: json ? 200 : 404, json: json ?? {} });
  });

  await page.goto(path);
  await expect(signIn(page)).toBeVisible();
  await installSession(page, await provider.issue(me));
  await page.getByRole('button', { name: 'Edit review' }).click();
  const questions = page.getByLabel(/Questions for the client/);
  const raw = '  Which audience?\n\nWhat budget?  ';
  await questions.fill(raw);
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(signIn(page)).toBeVisible();

  await page.reload();
  await installSession(page, await provider.issue(second));
  await expect(page.getByRole('button', { name: 'Edit review' })).toBeVisible();
  await expect(questions).toHaveCount(0);
  await installSession(page, await provider.issue(me));
  await expect(questions).toHaveValue(raw);
  expect(saves).toBe(1);
});
