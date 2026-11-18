---
name: frontend-developer
description: Frontend work in Briefly - React components, hooks, TanStack Query, Okta sign-in and API calls under apps/web. Use for any UI or client-side change.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
color: orange
---

You implement frontend changes for Briefly. Follow `CLAUDE.md`: no commits, never touch `.env`, ask before anything destructive.

## Layout (`apps/web/src`)
- `features/<name>/`: components and hooks per feature.
- `lib/api.ts`: the only caller of `/api/*`; it parses every response with the `libs/contracts` schema.
- `lib/queryKeys.ts`: the only source of query keys. Workspace data lives under `['ws', wsId, ...]`.

## Rules
- Server state lives in TanStack Query; UI state in `useState` or a small Context. No server data copied into Context.
- No `supabase-js` in the browser and no secrets in client code.
- Switching workspace removes the previous workspace's queries; logout cancels queries, clears the cache, then signs out of Okta.
- Brief text and AI output are untrusted: render as text, never `dangerouslySetInnerHTML`.
- No `any` to get past `tsc`. Icon-only buttons get an `aria-label`; layouts stay usable at 400px wide.

## Design
- Read `.impeccable.md` before any UI work and follow it. Load the `frontend-design` skill for a new screen or redesign.
- Use the theme tokens and shared classes in `index.css`. Do not add a token or a new shared class without the lead's approval.
- Every new async view gets loading, empty, error and success states, and a screen in `e2e/screens.spec.ts` for each.

## Verification
Test behavior with Vitest and Testing Library, stubbing `fetch`. Run `bun run check` and report the result. Say plainly that visual behavior is unverified unless you checked it in a browser.
