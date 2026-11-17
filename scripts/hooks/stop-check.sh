#!/bin/bash
# Claude Code Stop hook: refuse to finish while `bun run check` is red.
# Exit 2 blocks the stop and feeds the output back to the agent.
set -u

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# Skip when no source changed since the last green run (by mtime, so edits made through Bash count too).
stamp="node_modules/.cache/briefly/check-stamp"
if [ -f "$stamp" ] && [ -z "$(find . \
    \( -path ./node_modules -o -path '*/node_modules' -o -path '*/dist' -o -path ./.nx -o -path ./.git -o -path ./.claude \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name 'package.json' -o -name '*.config.js' \) \
    -newer "$stamp" -print -quit)" ]; then
  exit 0
fi

# Cap consecutive blocks so a check the agent can't fix never traps the session.
# Keyed by session so parallel sessions don't spend each other's tries.
session=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).session_id??"").replace(/[^A-Za-z0-9_-]/g,""))}catch{console.log("")}})')
counter="${TMPDIR:-/tmp}/briefly-stop-blocks-${session:-default}"
blocks=$(cat "$counter" 2>/dev/null || echo 0)

# No daemon: a sandboxed hook can't reach a daemon an earlier command started, and hangs on it.
if out=$(NX_NO_CLOUD=true NX_DAEMON=false bun run check 2>&1); then
  rm -f "$counter"
  mkdir -p "$(dirname "$stamp")" && touch "$stamp"
  exit 0
fi

if [ "$blocks" -ge 3 ]; then
  rm -f "$counter"
  echo "bun run check still failing after 3 blocked stops; letting the session end. Report the failure to the user." >&2
  exit 0
fi

echo $((blocks + 1)) > "$counter"
echo "bun run check failed; fix before finishing:" >&2
echo "$out" | tail -60 >&2
exit 2
