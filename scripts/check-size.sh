#!/bin/bash
# Fails when a hand-written tracked file exceeds the 400-line limit from CLAUDE.md.
# Lockfiles, migrations and generated files are exempt: nobody splits those by hand.
set -u

cd "$(dirname "$0")/.." || exit 1

limit=400
over=$(git ls-files -co --exclude-standard \
  | grep -Ev '(^|/)(bun\.lock|package-lock\.json)$|^supabase/migrations/|\.gen\.ts$|(^|/)dist/' \
  | while IFS= read -r f; do
      [ -f "$f" ] || continue
      n=$(wc -l < "$f" | tr -d ' ')
      [ "$n" -gt "$limit" ] && echo "  $f: $n lines"
    done)

if [ -n "$over" ]; then
  echo "Files over $limit lines; split them by responsibility:" >&2
  echo "$over" >&2
  exit 1
fi
