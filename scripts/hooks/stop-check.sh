#!/bin/bash
# Claude Code hook: refuse to finish while `bun run check` is red.
# - Stop: checks the lead's tree.
# - PreToolUse on SubagentHandback: refuses a subagent's report while its own worktree is red. Not SubagentStop:
#   a subagent hands its report back before it stops, so a SubagentStop block arrives after the lead already has it.
#   Only worktrees with changes are checked: agents in the lead's tree are covered by the lead's Stop, and read-only
#   agents must never be blocked by the lead's red changes.
# Exit 2 blocks and feeds the output back to the agent.
set -u

input=$(cat)
{ read -r event; read -r cwd; read -r session; read -r keys; read -r tool; } < <(printf '%s' "$input" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s)}catch{}
console.log([j.hook_event_name??"Stop",j.cwd??"",(j.session_id??"").replace(/[^A-Za-z0-9_-]/g,""),Object.keys(j).join(","),j.tool_name??""].map(v=>String(v).replace(/\n/g," ")).join("\n"))})')

# Field names and paths only, never content: lets a human confirm what the harness sends.
if [ "${BRIEFLY_HOOK_DEBUG:-}" = 1 ]; then
  echo "$(date -u +%FT%TZ) event=$event tool=$tool keys=$keys cwd=$cwd project=${CLAUDE_PROJECT_DIR:-} pwd=$PWD" 2>/dev/null >> "${TMPDIR:-/tmp}/briefly-hook-debug.log"
fi

[ "$event" = PreToolUse ] && [ "$tool" != SubagentHandback ] && exit 0

if [ "$event" = PreToolUse ]; then
  [ -n "$cwd" ] || exit 0
  top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
  # The main checkout, found from git itself: CLAUDE_PROJECT_DIR may point at the worktree in a subagent's hook.
  common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$top" ] && [ -n "$common" ] || exit 0
  tree=$(cd "$top" && pwd -P) && main=$(cd "$common/.." && pwd -P) || exit 0
  [ "$tree" != "$main" ] || exit 0
  # Changed: uncommitted work, or commits the main checkout doesn't have (agents shouldn't commit, but must not slip past).
  [ -n "$(git -C "$tree" status --porcelain)" ] || [ -n "$(git -C "$tree" rev-list -n1 "$(git -C "$main" rev-parse HEAD)..HEAD" 2>/dev/null)" ] || exit 0
  where=" in $tree"
  # A subagent can't start another agent, so the nudge is to rethink, not to escalate.
  finish="handing back your report"; reply="report"
  nudge="stop repeating that fix: find the root cause first, and say in your report what you tried."
else
  tree="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
  where=""
  finish="finishing"; reply="reply"
  nudge="ask the advisor agent with this output before another attempt."
fi
cd "$tree" || exit 0

# The failure ledger: one JSON line per block, give-up or recovery in <main checkout>/.harness/failures.jsonl
# (gitignored), metadata only. It must never change a gate, so it writes nothing to stdout/stderr (the gate's
# channels) and swallows its own errors. Read it with scripts/ledger-report.sh.
gate=$([ "$event" = PreToolUse ] && echo handback || echo stop)
ledger() {
  local ok=failed
  {
    local root
    root=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P) \
      && mkdir -p "$root/.harness" \
      && printf '%s' "${out:-}" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const [outcome, n, gate, branch, session, tree, treekey] = process.argv.slice(1);
  s = s.replace(/\x1b\[[0-9;]*m/g, "");
  const nx = /Failed tasks:\s*-\s*(\S+)/.exec(s);
  // The first failing part of check; its steps run in order with &&, so only one of these can appear.
  const step = outcome === "recovered" ? null
    : /node_modules is missing/.test(s) ? "node_modules"
    : /Files over 400 lines/.test(s) ? "check-size"
    : /: RLS not enabled|but no isolation test names it|^auth\.uid\(\) used: /m.test(s) ? "rls-coverage"
    : /Domain\/application files without a sibling test/.test(s) ? "untested"
    : nx ? `nx:${nx[1]}` : "unknown";
  console.log(JSON.stringify({ ts: new Date().toISOString(), gate, outcome, n: Number(n), step, branch, session, tree, treekey }));
});' "$1" "$2" "$gate" "$(git rev-parse --abbrev-ref HEAD)" "$session" "$([ "$(pwd -P)" = "$root" ] && echo main || echo worktree)" "$treekey" \
        >> "$root/.harness/failures.jsonl" \
      && ok=written
  } >/dev/null 2>&1
  # Whether the write worked, for checking the handback gate (a worktree agent's sandbox may not reach the main checkout).
  if [ "${BRIEFLY_HOOK_DEBUG:-}" = 1 ]; then
    echo "$(date -u +%FT%TZ) ledger=$ok outcome=$1 gate=$gate" 2>/dev/null >> "${TMPDIR:-/tmp}/briefly-hook-debug.log"
  fi
  return 0
}

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

# Cap consecutive blocks so a check the agent can't fix never traps the session.
# Keyed by session and tree so parallel sessions and worktree agents don't spend each other's tries.
treekey=$(printf '%s' "$(pwd -P)" | git hash-object --stdin | cut -c1-12)
counter="${TMPDIR:-/tmp}/briefly-stop-blocks-${session:-default}-$treekey"
blocks=$(cat "$counter" 2>/dev/null || echo 0)
case $blocks in "" | *[!0-9]*) blocks=0 ;; esac

# Back to a state already known green (e.g. a red change reverted): that ends a block streak too.
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current" ]; then
  [ "$blocks" -gt 0 ] && ledger recovered "$blocks" && rm -f "$counter"
  exit 0
fi

if [ ! -d node_modules ]; then
  out="node_modules is missing$where. Run \`bun install --frozen-lockfile\` there, then \`bun run check\`."
# No daemon: a sandboxed hook can't reach a daemon an earlier command started, and hangs on it.
elif out=$(NX_NO_CLOUD=true NX_DAEMON=false bun run check 2>&1); then
  [ "$blocks" -gt 0 ] && ledger recovered "$blocks"
  rm -f "$counter"
  mkdir -p "$(dirname "$stamp")" && echo "$current" > "$stamp"
  exit 0
fi

if [ "$blocks" -ge 3 ]; then
  ledger giveup "$blocks"
  rm -f "$counter"
  msg="bun run check is still red$where after 3 blocked attempts; the work is NOT done. Last output:
$(echo "$out" | tail -30 | perl -pe 's/\e\[[0-9;]*m//g')"
  # stderr on exit 0 reaches neither the model nor (visibly) the user; a systemMessage does reach the user.
  # A refused handback can't stay refused forever, so the report goes through with the warning on top of it:
  # the lead then sees it whatever the agent wrote. updatedInput replaces the whole input, so every field is kept.
  # Input on stdin, not in the environment, so a long report can't hit the env size limit and drop the warning.
  printf '%s' "$input" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const msg = process.argv[1];
  let j = {}; try { j = JSON.parse(s); } catch {}
  const out = { systemMessage: msg };
  // Rewrite only the field we know; an unexpected shape keeps the report as is, and the user still gets systemMessage.
  if (j.hook_event_name === "PreToolUse" && typeof j.tool_input?.message === "string") {
    const input = { ...j.tool_input, message: `⚠ ${msg}\n\n---\n\n${j.tool_input.message}` };
    out.hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: input };
  }
  console.log(JSON.stringify(out));
});' "$msg"
  exit 0
fi

n=$((blocks + 1))
echo "$n" > "$counter"
ledger block "$n"
{
  echo "bun run check failed$where (block $n/3); fix it before $finish."
  [ "$n" -eq 2 ] && echo "Second red attempt in a row: if it is the same failure, $nudge"
  [ "$n" -eq 3 ] && echo "Last block: if you cannot fix it, your final $reply must say bun run check is red and quote the failure."
  echo "$out" | tail -60
} >&2
exit 2
