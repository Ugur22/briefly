#!/bin/bash
# Claude Code Stop and SubagentStop hook: refuse to finish while `bun run check` is red.
# Stop checks the lead's tree. SubagentStop checks only a subagent's own worktree, and only when it has changes:
# agents working in the lead's tree are covered by the lead's Stop, and read-only agents must never be blocked by it.
# Exit 2 blocks and feeds the output back to the agent.
set -u

input=$(cat)
{ read -r event; read -r cwd; read -r session; read -r keys; } < <(printf '%s' "$input" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s)}catch{}
console.log([j.hook_event_name??"Stop",j.cwd??"",(j.session_id??"").replace(/[^A-Za-z0-9_-]/g,""),Object.keys(j).join(",")].map(v=>String(v).replace(/\n/g," ")).join("\n"))})')

# Field names and paths only, never content: lets a human confirm what the harness sends.
if [ "${BRIEFLY_HOOK_DEBUG:-}" = 1 ]; then
  echo "$(date -u +%FT%TZ) event=$event keys=$keys cwd=$cwd project=${CLAUDE_PROJECT_DIR:-} pwd=$PWD" >> "${TMPDIR:-/tmp}/briefly-hook-debug.log"
fi

if [ "$event" = SubagentStop ]; then
  [ -n "$cwd" ] || exit 0
  top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
  # The main checkout, found from git itself: CLAUDE_PROJECT_DIR may point at the worktree during SubagentStop.
  common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$top" ] && [ -n "$common" ] || exit 0
  tree=$(cd "$top" && pwd -P) && main=$(cd "$common/.." && pwd -P) || exit 0
  [ "$tree" != "$main" ] || exit 0
  # Changed: uncommitted work, or commits the main checkout doesn't have (agents shouldn't commit, but must not slip past).
  [ -n "$(git -C "$tree" status --porcelain)" ] || [ -n "$(git -C "$tree" rev-list -n1 "$(git -C "$main" rev-parse HEAD)..HEAD" 2>/dev/null)" ] || exit 0
  where=" in $tree"
else
  tree="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
  where=""
fi
cd "$tree" || exit 0

# The tree's git state: commit, every tracked change (deletions included) and every untracked file, ignored ones excluded.
# Same view as check-size.sh, so any file the check can see re-runs it, whatever its type.
state() {
  {
    git rev-parse HEAD
    git diff HEAD --binary
    git ls-files -o --exclude-standard
    git ls-files -o --exclude-standard -z | xargs -0 git hash-object --
  } 2>/dev/null | git hash-object --stdin
}

stamp="node_modules/.cache/briefly/check-state"
# Taken before the check, so an edit made while it runs is never stamped as green.
current=$(state)
[ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current" ] && exit 0

# Cap consecutive blocks so a check the agent can't fix never traps the session.
# Keyed by session and tree so parallel sessions and worktree agents don't spend each other's tries.
treekey=$(printf '%s' "$(pwd -P)" | git hash-object --stdin | cut -c1-12)
counter="${TMPDIR:-/tmp}/briefly-stop-blocks-${session:-default}-$treekey"
blocks=$(cat "$counter" 2>/dev/null || echo 0)

if [ ! -d node_modules ]; then
  out="node_modules is missing$where. Run \`bun install --frozen-lockfile\` there, then \`bun run check\`."
# No daemon: a sandboxed hook can't reach a daemon an earlier command started, and hangs on it.
elif out=$(NX_NO_CLOUD=true NX_DAEMON=false bun run check 2>&1); then
  rm -f "$counter"
  mkdir -p "$(dirname "$stamp")" && echo "$current" > "$stamp"
  exit 0
fi

if [ "$blocks" -ge 3 ]; then
  rm -f "$counter"
  # stderr on exit 0 reaches neither the model nor (visibly) the user; a systemMessage does reach the user.
  node -e 'console.log(JSON.stringify({systemMessage: process.argv[1]}))' \
    "bun run check is still red$where after 3 blocked stops; the work is NOT done. Last output:
$(echo "$out" | tail -30)"
  exit 0
fi

n=$((blocks + 1))
echo "$n" > "$counter"
{
  echo "bun run check failed$where (block $n/3); fix before finishing."
  [ "$n" -eq 2 ] && echo "Second red stop in a row: if it is the same failure, ask the advisor agent with this output before another attempt."
  [ "$n" -eq 3 ] && echo "Last block: if you cannot fix it, your final reply must say bun run check is red and quote the failure."
  echo "$out" | tail -60
} >&2
exit 2
