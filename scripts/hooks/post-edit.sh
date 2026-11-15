#!/bin/bash
# Claude Code PostToolUse hook (Edit|Write): lint just the edited file.
# Exit 2 sends the failure back to the agent so it fixes it before moving on.
set -u

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input?.file_path??"")}catch{console.log("")}})')

case "$file" in
  *.ts|*.tsx|*.js) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if ! out=$(bunx eslint --no-warn-ignored "$file" 2>&1); then
  echo "eslint failed after editing $file:" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
