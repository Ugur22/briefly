// Manual end-to-end checks against the hosted Supabase project and a running API; run by hand, never in CI.
//   ALICE_TOKEN=<alice's Okta access token> bun run --cwd apps/api smoke:hosted
// Bun loads SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from .env. The token is only sent to Supabase and the local API.
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALICE_TOKEN, API_URL = 'http://127.0.0.1:3000' } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ALICE_TOKEN) {
  console.error('Need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (from .env) and ALICE_TOKEN.');
  process.exit(2);
}

const ACME = 'acacacac-0000-4000-8000-000000000001';
const GLOBEX = '6106e600-0000-4000-8000-000000000002';

let failed = 0;
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

async function rest(path: string, token?: string) {
  const headers: Record<string, string> = { apikey: SUPABASE_PUBLISHABLE_KEY! };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(body) ? (body as { id?: string }[]) : null, body };
}

// Same claims and kid as alice's real token, signed with a key Okta never published.
async function forge(token: string) {
  const { privateKey } = await generateKeyPair('RS256');
  const { kid } = decodeProtectedHeader(token);
  return new SignJWT(decodeJwt(token)).setProtectedHeader({ alg: 'RS256', kid }).sign(privateKey);
}

const direct = await rest('workspaces?select=id,name', ALICE_TOKEN);
check('alice, straight to PostgREST, sees only Acme', direct.rows?.length === 1 && direct.rows[0]?.id === ACME, direct);

const globex = await rest(`workspaces?id=eq.${GLOBEX}`, ALICE_TOKEN);
check('alice, straight to PostgREST, cannot read Globex by id', globex.rows?.length === 0, globex);

const forged = await rest('workspaces?select=id', await forge(ALICE_TOKEN));
check('a forged signature is rejected by Supabase', forged.status === 401, forged);

const anon = await rest('workspaces?select=id');
check('the publishable key alone gets nothing', anon.status === 401 || anon.rows?.length === 0, anon);

const api = await fetch(`${API_URL}/api/workspaces/${GLOBEX}`, { headers: { Authorization: `Bearer ${ALICE_TOKEN}` } }).catch(() => null);
check('the API answers 404 for Globex to alice', api?.status === 404, api ? api.status : 'API not running');

process.exit(failed ? 1 : 0);
