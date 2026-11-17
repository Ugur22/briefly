// Manual end-to-end checks against the hosted Supabase project and a running API; run by hand, never in CI.
//   ALICE_TOKEN=<alice's token> [BOB_TOKEN=<bob's token>] bun run --cwd apps/api smoke:hosted
// Every write it attempts is one that must be refused, so a healthy project is left unchanged.
// Bun loads SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from .env. The token is only sent to Supabase and the local API.
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALICE_TOKEN, BOB_TOKEN, API_URL = 'http://127.0.0.1:3000' } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ALICE_TOKEN) {
  console.error('Need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (from .env) and ALICE_TOKEN.');
  process.exit(2);
}

const ACME = 'acacacac-0000-4000-8000-000000000001';
const GLOBEX = '6106e600-0000-4000-8000-000000000002';
const ACME_BRIEF = 'b1ef0000-0000-4000-8000-000000000001';
const GLOBEX_BRIEF = 'b1ef0000-0000-4000-8000-000000000003';

let failed = 0;
function check(name: string, ok: boolean, detail: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

type Row = { id?: string; workspace_id?: string; title?: string };

async function rest(path: string, token?: string, write?: { method: 'POST' | 'PATCH'; body: unknown }) {
  const headers: Record<string, string> = { apikey: SUPABASE_PUBLISHABLE_KEY! };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (write) Object.assign(headers, { 'Content-Type': 'application/json', Prefer: 'return=representation' });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: write?.method ?? 'GET',
    headers,
    body: write ? JSON.stringify(write.body) : undefined,
  });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(body) ? (body as Row[]) : null, body };
}

// A signed-in caller refused by RLS or a column privilege gets 403 + 42501. A 401 would mean the token itself was
// rejected, which proves nothing about the policies, so it doesn't count.
const refusedBy = (r: { status: number; body: unknown }, message: string) => {
  const err = r.body as { code?: string; message?: string } | null;
  return r.status === 403 && err?.code === '42501' && (err.message ?? '').includes(message);
};

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

// Briefs, straight to PostgREST
const aliceBriefs = await rest('briefs?select=id,workspace_id', ALICE_TOKEN);
check('alice reads only Acme briefs', !!aliceBriefs.rows?.length && aliceBriefs.rows.every((b) => b.workspace_id === ACME), aliceBriefs);

const globexBrief = await rest(`briefs?id=eq.${GLOBEX_BRIEF}`, ALICE_TOKEN);
check('alice cannot read a Globex brief by id', globexBrief.rows?.length === 0, globexBrief);

const intoGlobex = await rest('briefs', ALICE_TOKEN, { method: 'POST', body: { workspace_id: GLOBEX, title: 'smoke: must be refused', body: '' } });
check('alice cannot create a brief in Globex (RLS)', refusedBy(intoGlobex, 'row-level security'), intoGlobex);

const editGlobex = await rest(`briefs?id=eq.${GLOBEX_BRIEF}`, ALICE_TOKEN, { method: 'PATCH', body: { title: 'smoke: must be refused' } });
check('alice cannot edit a Globex brief (RLS hides it: 0 rows)', editGlobex.status === 200 && editGlobex.rows?.length === 0, editGlobex);

const spoof = await rest('briefs', ALICE_TOKEN, { method: 'POST', body: { workspace_id: ACME, title: 'smoke: must be refused', body: '', created_by: '0e0e0000-0000-4000-8000-000000000003' } });
check('alice cannot choose created_by (column privilege)', refusedBy(spoof, 'permission denied'), spoof);

// Briefs through our API, which scopes by the workspace in the URL as well as by RLS
const viaApi = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${API_URL}/api${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    .then((r) => r.status)
    .catch(() => 'API not running');

const crossWs = await viaApi(`/workspaces/${ACME}/briefs/${GLOBEX_BRIEF}`, ALICE_TOKEN);
check('API: a Globex brief under an Acme URL is 404', crossWs === 404, crossWs);
const globexList = await viaApi(`/workspaces/${GLOBEX}/briefs`, ALICE_TOKEN);
check('API: alice listing Globex briefs is 404', globexList === 404, globexList);

if (BOB_TOKEN) {
  const bobPut = await viaApi(`/workspaces/${ACME}/briefs/${ACME_BRIEF}`, BOB_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ title: 'smoke: must be refused', body: '', version: 1 }),
  });
  check('API: bob (approver) editing an Acme brief is 403', bobPut === 403, bobPut);

  const bobAcme = await rest(`briefs?select=id,workspace_id&workspace_id=eq.${ACME}`, BOB_TOKEN);
  check('bob (approver in Acme) reads Acme briefs', !!bobAcme.rows?.length, bobAcme);

  const bobEdit = await rest(`briefs?id=eq.${ACME_BRIEF}`, BOB_TOKEN, { method: 'PATCH', body: { title: 'smoke: must be refused' } });
  check('bob cannot edit an Acme brief (RLS: 0 rows)', bobEdit.status === 200 && bobEdit.rows?.length === 0, bobEdit);
} else {
  console.log('skip bob checks (no BOB_TOKEN)');
}

process.exit(failed ? 1 : 0);
