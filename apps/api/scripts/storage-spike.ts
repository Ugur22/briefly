// Phase 3 go/no-go: does hosted Supabase Storage accept Okta tokens (non-UUID sub) and enforce the briefs policies?
//   ALICE_TOKEN=<alice's token> BOB_TOKEN=<bob's token> bun run --cwd apps/api spike:storage
// alice: admin of Acme. bob: editor of Globex, approver (read-only) in Acme. Cleans up everything it uploads.
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALICE_TOKEN, BOB_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ALICE_TOKEN || !BOB_TOKEN) {
  console.error('Need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (from .env), ALICE_TOKEN and BOB_TOKEN.');
  process.exit(2);
}

const ACME = 'acacacac-0000-4000-8000-000000000001';
const GLOBEX = '6106e600-0000-4000-8000-000000000002';
const PDF = new TextEncoder().encode('%PDF-1.4\n% storage spike\n%%EOF\n');

const storageFor = (token: string) =>
  createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from('briefs');
const alice = storageFor(ALICE_TOKEN);
const bob = storageFor(BOB_TOKEN);

// Paths use fresh brief ids that have no briefs row, so the "editor may clean up an orphan" delete rule applies.
const path = (ws: string) => `workspaces/${ws}/briefs/${crypto.randomUUID()}/original`;
const acmePath = path(ACME);
const globexPath = path(GLOBEX);

let failed = 0;
const describe = (error: unknown) => {
  if (!error) return 'ok';
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return `status=${String(e.status ?? '-')} statusCode=${String(e.statusCode ?? '-')} message=${String(e.message ?? error)}`;
};
function step(name: string, expectOk: boolean, error: unknown) {
  const pass = expectOk ? !error : !!error;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} [expected ${expectOk ? 'success' : 'refusal'}] → ${describe(error)}`);
  if (!pass) failed++;
}
const upload = (s: typeof alice, p: string) => s.upload(p, PDF, { contentType: 'application/pdf', upsert: false });

// 0. Is the token accepted at all? A missing object should be "not found", not a JWT error.
const probe = await alice.download(`workspaces/${ACME}/briefs/${crypto.randomUUID()}/original`);
console.log(`info probe: download of a missing object → ${describe(probe.error)}`);
console.log('     (not found = token accepted; "jwt"/"invalid"/"signature" = no-go)');

const aliceUp = await upload(alice, acmePath);
step('alice uploads into Acme', true, aliceUp.error);

const aliceDown = await alice.download(acmePath);
step('alice downloads her Acme upload', true, aliceDown.error);
if (aliceDown.data) {
  const same = Buffer.from(await aliceDown.data.arrayBuffer()).equals(Buffer.from(PDF));
  step('the bytes round-trip unchanged', true, same ? null : new Error('bytes differ'));
}

step('alice cannot upload into Globex', false, (await upload(alice, path(GLOBEX))).error);

const bobUp = await upload(bob, globexPath);
step('bob (Globex editor) uploads into Globex', true, bobUp.error);

step('alice cannot download the Globex object', false, (await alice.download(globexPath)).error);
step('bob (Acme approver) downloads the Acme object', true, (await bob.download(acmePath)).error);
step('bob (Acme approver) cannot upload into Acme', false, (await upload(bob, path(ACME))).error);

// remove() reports success with an empty list when RLS hides the row, so check what it actually removed.
const bobRemove = await bob.remove([acmePath]);
step('bob (Acme approver) cannot remove the Acme object', false, bobRemove.error ?? (bobRemove.data?.length ? null : new Error('nothing removed')));
step('…and it is still there', true, (await alice.download(acmePath)).error);

const aliceRemove = await alice.remove([acmePath]);
step('alice (Acme admin) removes the Acme object', true, aliceRemove.error ?? (aliceRemove.data?.length ? null : new Error('nothing removed')));

const bobCleanup = await bob.remove([globexPath]);
step('bob (Globex editor) removes his orphan upload (no brief row)', true, bobCleanup.error ?? (bobCleanup.data?.length ? null : new Error('nothing removed')));

console.log(failed ? `\nNO-GO candidates: ${failed} step(s) failed (see messages above)` : '\nGO: Storage accepts Okta tokens and enforces the policies');
process.exit(failed ? 1 : 0);
