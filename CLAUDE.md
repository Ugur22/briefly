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
`bun run check` (file-size limit, then Nx: lint, typecheck, test, build for every project; offline, a few seconds) before reporting done. A Stop hook enforces it. CI also builds the API image, boots it and hits `/api/health`, and runs gitleaks. The real Okta tenant and LLM are only called by hand.

## Agents
- Lead: the main session plans, edits, and runs checks.
- `advisor` (Opus, read-only): call it before a plan is approved, after the same failure twice, and before reporting an auth/RLS/tenancy change done. It advises; the lead applies.
- `backend-developer` (`apps/api`, `libs/contracts`), `db-developer` (`supabase/`), `frontend-developer` (`apps/web`): scoped changes. Cross-stack work starts with the contract in `libs/contracts`, agreed in the plan.
- Repo-wide searches: the built-in Explore agent with `model: haiku`.
- Run parallel agents with `isolation: "worktree"`, and finish with `reviewer` (read-only) on the diff.
- UI polish: the `unslop` skill.

## Loops
Pick the loop by what you hand off. Every loop needs an exit; never start one without it.
- **Turn-based (the check)**: the default. The Stop hook runs `bun run check` and blocks at most 3 times, then you report the failure. Add `reviewer` on the diff and `advisor` per the rules above. Exit: check green, or 3 blocked stops and a report.
- **Goal-based (the stop condition)**: `/goal "<command> exits 0, or stop after N tries"` when done is a command result, never an opinion. Keep N ≤ 3 while the Stop hook's 3-block cap applies. Exit: condition met, N reached, or `/goal clear`. Recipes (add each script in the PR that first needs it):
  - Domain and application code tested: `scripts/untested.sh` prints nothing (every non-test file in `*/domain` and `*/application` has a sibling test). From Phase 1.
  - RLS covered: `supabase test db` exits 0 and `scripts/rls-coverage.sh` prints nothing (every table with `workspace_id` has a cross-tenant pgTAP test). From Phase 1; `advisor` still reviews before done.
  - Web quality: Lighthouse JSON of `vite preview` at 400px wide shows performance and accessibility ≥ 0.90 (checked with `jq`). Once real UI exists.
  - Smoke flow: `bunx playwright test` exits 0 at 400px and 1280px. Once real UI exists; shares the visual-check Playwright config.
- **Time-based (the trigger)**: GitHub Actions cron for anything a command answers (no tokens); `/schedule` only when the run needs judgement. Runs report, never change code. `/loop` is in-session only, e.g. watching CI on a PR. Exit: one report per run; `/loop` stops on a stated outcome.
- **Proactive (the prompt)**: Dependabot PRs, gated by CI, merged by a human. Nothing merges on its own and nothing loosens a check.
