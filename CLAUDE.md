# Briefly

Internal Client Brief Review tool, built as interview practice. Users sign in with Okta, pick a workspace, paste or upload a campaign brief, generate an AI review, edit it, and submit it for human approval.

Nx + Bun workspaces: `apps/web` (React, Vite, TanStack Query), `apps/api` (Fastify on Node 22), `libs/contracts` (Zod schemas shared by both). Supabase (Postgres + RLS, private Storage) arrives in Phase 1 under `supabase/`.

## Run
- Setup: `bun install`. Copy `.env.example` to `.env` (never commit it).
- Dev: `bun run dev:api` (http://127.0.0.1:3000) and `bun run dev:web` (http://localhost:5173, proxies `/api`).
- Container: `docker compose up --build api`, then `curl localhost:3000/api/health`.

## Architecture rules
- Identity: Okta access token → Node verifies it (issuer, audience, expiry, `role`) → a per-request Supabase client forwards the same token, so RLS decides what the user sees. Never use the secret-key client in a request path; `platform/system-client` is for system jobs only and ESLint blocks importing it from request code.
- The browser only talks to the Node API. No `supabase-js` in `apps/web`. `apps/web/src/lib/api.ts` is the only caller of `/api/*` and parses every response with the shared contract.
- Tenancy: every tenant table has `workspace_id` and RLS via `is_member` / `has_role`. Routes carry the workspace in the path (`/api/workspaces/:wsId/...`); unknown and forbidden workspaces both return 404.
- Query keys come from `apps/web/src/lib/queryKeys.ts`; workspace data lives under `['ws', wsId, ...]`. Logout clears the whole cache.
- AI calls happen only in the API, with structured output validated by Zod. Brief text is untrusted data and is never logged.
- DDD where it pays: pure domain rules in `*/domain`, use cases in `*/application`, Supabase/LLM adapters in `*/infra`. No empty layers, no interfaces with a single implementation except `ReviewGenerator` (faked in tests).

## Rules
- No commits or pushes without explicit approval. Never read, print or edit `.env`.
- Anything non-trivial: plan first, wait for approval. Before an auth, RLS or tenancy plan is approved, ask the `advisor` agent to review it.
- Keep hand-written files under 400 lines; split by responsibility before growing past that.
- Do not edit `.claude/settings.json` or `scripts/hooks/` to loosen the checks.

## Verify
`bun run check` (Nx: lint, typecheck, test, build for every project; offline, a few seconds) before reporting done. A Stop hook enforces it. CI also builds the API image, boots it and hits `/api/health`, and runs gitleaks. The real Okta tenant and LLM are only called by hand.

## Agents
- Lead: the main session plans, edits, and runs checks.
- `advisor` (Opus, read-only): call it before a plan is approved, after the same failure twice, and before reporting an auth/RLS/tenancy change done. It advises; the lead applies.
- `backend-developer` (`apps/api`, `libs/contracts`), `db-developer` (`supabase/`), `frontend-developer` (`apps/web`): scoped changes. Cross-stack work starts with the contract in `libs/contracts`, agreed in the plan.
- Repo-wide searches: the built-in Explore agent with `model: haiku`.
- Run parallel agents with `isolation: "worktree"`, and finish with `reviewer` (read-only) on the diff.
- UI polish: the `unslop` skill.
