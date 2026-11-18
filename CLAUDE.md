# Briefly

Internal Client Brief Review tool, built as interview practice. Users sign in with Okta, pick a workspace, paste or upload a campaign brief, generate an AI review, edit it, and submit it for human approval.

Nx + Bun workspaces: `apps/web` (React, Vite, TanStack Query), `apps/api` (Fastify on Node 22), `libs/contracts` (Zod schemas shared by both). Supabase (Postgres + RLS, private Storage) arrives in Phase 1 under `supabase/`.

## Run
- Setup: `bun install`. Copy `.env.example` to `.env` (never commit it).
- Dev: `bun run dev:api` (http://127.0.0.1:3000) and `bun run dev:web` (http://localhost:5173, proxies `/api`).
- Container: `docker compose up --build api`, then `curl localhost:3000/api/health`.

## Architecture rules
- Identity: Okta access token → Node verifies it (issuer, audience, expiry, `cid`, `role`) → a per-request Supabase client forwards the same token, so RLS decides what the user sees. Never use the secret-key client in a request path; `platform/system-client` is for system jobs only and ESLint blocks importing it from request code.
- The browser only talks to the Node API. No `supabase-js` in `apps/web`. `apps/web/src/lib/api.ts` is the only caller of `/api/*` and parses every response with the shared contract.
- Users are keyed on Okta `iss` + `uid`. `sub` is the login email and can change, and `auth.uid()` throws on it: use `private.current_user_id()` (`scripts/rls-coverage.sh` fails on `auth.uid()`). Okta's `aud` is per authorization server, so `cid` is what proves a token was issued to Briefly; Supabase checks neither, so `private.trusted_claims()` does. The Okta `role` claim must only ever yield `authenticated` (or nothing): PostgREST trusts it, and `service_role` would bypass RLS.
- Tenancy: every tenant table has `workspace_id` and RLS via `workspace_id in (select private.member_workspace_ids())`. Routes carry the workspace in the path (`/api/workspaces/:wsId/...`); unknown and forbidden workspaces both return 404.
- Query keys come from `apps/web/src/lib/queryKeys.ts`; workspace data lives under `['ws', wsId, ...]`. Logout clears the whole cache.
- AI calls happen only in the API, with structured output validated by Zod. Brief text is untrusted data and is never logged.
- DDD where it pays: pure domain rules in `*/domain`, use cases in `*/application`, Supabase/LLM adapters in `*/infra`. No empty layers, no interfaces with a single implementation except `ReviewGenerator` (faked in tests).

## Rules
- No commits or pushes without explicit approval. Never read, print or edit `.env`.
- Anything non-trivial: plan first, wait for approval. Before an auth, RLS or tenancy plan is approved, ask the `advisor` agent to review it.
- Keep hand-written files under 400 lines; split by responsibility before growing past that.
- Do not edit `.claude/settings.json` or `scripts/hooks/` to loosen the checks.

## Verify
`bun run check` (file-size limit, `rls-coverage.sh` and `untested.sh`, then Nx: lint, typecheck, test, build for every project; offline, a few seconds) before reporting done. A Stop hook enforces it. CI also builds the API image, boots it and hits `/api/health`, and runs gitleaks. The real Okta tenant and LLM are only called by hand.

## Agents
- Lead: the main session plans, edits, and runs checks.
- `advisor` (Opus, read-only): call it before a plan is approved, after the same failure twice, and before reporting an auth/RLS/tenancy change done. It advises; the lead applies.
- `backend-developer` (`apps/api`, `libs/contracts`), `db-developer` (`supabase/`), `frontend-developer` (`apps/web`): scoped changes. Cross-stack work starts with the contract in `libs/contracts`, agreed in the plan.
- Repo-wide searches: the built-in Explore agent with `model: haiku`.
- Run parallel agents with `isolation: "worktree"`, and finish with `reviewer` (read-only) on the diff. A fresh worktree has no `node_modules` and a socket path too long for Nx: tell the agent to run `BUN_TMPDIR=$TMPDIR BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache bun install --frozen-lockfile` first (the sandbox denies bun's default temp dir) and to set `NX_SOCKET_DIR=$TMPDIR/n` for `bun run check`.
- Every delegation prompt states, so nothing depends on the agent guessing:
  - **Goal**: one sentence.
  - **Constraints**: the rules from the plan and this file that apply.
  - **Scope**: the files or folders to touch.
  - **Done when**: the exact command(s) and the expected result.
  - **Earlier attempts**: what was tried and how it failed, or "none".
  - **Report**: changed files, the last lines of `bun run check` and its exit code (run in the agent's own working directory), and what was not verified.
- `ui-designer` (Opus, read-only): design research before a new screen or redesign, and critique of rendered screenshots after one. It advises; `frontend-developer` implements.
- Design skills: `frontend-design` to build a screen, `critique` (used by `ui-designer`) to judge it, `audit` on request, `unslop` as the only finishing pass. Design direction and the reference log live in `.impeccable.md`; read it before any UI work.

## Loops
Pick the loop by what you hand off. Every loop needs an exit; never start one without it.
- **Turn-based (the check)**: the default. The Stop hook runs `bun run check` whenever the tree's git state changed since the last green run (any file type, deletions included) and blocks at most 3 times; the second block suggests `advisor`, and at the cap the user is told the work is not done, so your final reply must say so too. The same hook, on `PreToolUse` for `SubagentHandback`, refuses a worktree agent's report while its own tree is red (at most 3 times; after that the report arrives with a RED warning on top). Add `reviewer` on the diff and `advisor` per the rules above. Exit: check green, or 3 blocked stops and a report. Every block, give-up and recovery goes to `.harness/failures.jsonl` in the main checkout (local, gitignored); `scripts/ledger-report.sh` summarises it; read it before proposing any harness change. Handback events are unverified until a real worktree run shows `ledger=written` with `BRIEFLY_HOOK_DEBUG=1`.
- **Goal-based (the stop condition)**: `/goal "<command> exits 0, or stop after N tries"` when done is a command result, never an opinion. Keep N ≤ 3 while the Stop hook's 3-block cap applies. Exit: condition met, N reached, or `/goal clear`. Recipes (add each script in the PR that first needs it):
  - Domain and application code tested: `scripts/untested.sh` prints nothing (every non-test file in `*/domain` and `*/application` has a sibling test). From Phase 1; also runs in `bun run check`.
  - RLS covered: `supabase test db` exits 0 and `scripts/rls-coverage.sh` prints nothing (every table with `workspace_id` has a cross-tenant pgTAP test). From Phase 1; `advisor` still reviews before done.
  - Web quality: Lighthouse JSON of `vite preview` at 400px wide shows performance and accessibility ≥ 0.90 (checked with `jq`). Once real UI exists.
  - Smoke flow: `bunx playwright test` exits 0 at 400px and 1280px. Once real UI exists; shares the visual-check Playwright config.
- **Design (the eye)**: only for a new screen or flow, a change to tokens or shared classes in `index.css`, or when asked; never for copy tweaks, single-component fixes or backend work. Research with `ui-designer` first if it is a new screen or redesign, and put the direction in the plan. After `bun run check` is green, capture with `SHOT_SET=pass-1 bun run visual -g "<screens>"` (axe and 400px overflow must pass), have `ui-designer` review that set, fix P0 and P1 findings, then capture `pass-2` and have it compare. Exit: no P0/P1 left, 3 passes, or blocked; report P2s and which screenshots were reviewed.
- **Time-based (the trigger)**: GitHub Actions cron for anything a command answers (no tokens); `/schedule` only when the run needs judgement. Runs report, never change code. `/loop` is in-session only, e.g. watching CI on a PR. Exit: one report per run; `/loop` stops on a stated outcome.
- **Proactive (the prompt)**: Dependabot PRs, gated by CI, merged by a human. Nothing merges on its own and nothing loosens a check.
