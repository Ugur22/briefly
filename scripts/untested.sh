#!/bin/bash
# Prints every non-test source file under */domain or */application without a sibling test; prints nothing when covered.
# Part of `bun run check`, and a `/goal` stop condition: stdout is only the list, the explanation goes to stderr.
set -u
cd "$(dirname "$0")/.." || exit 1

# index.ts only re-exports; declaration files have nothing to test.
# A failing find must fail the check, not look like "everything covered".
files=$(find apps libs -type f \( -path '*/domain/*' -o -path '*/application/*' \) \
  \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' ! -name '*.d.ts' ! -name 'index.ts' ! -path '*/node_modules/*') \
  || { echo "untested.sh: find failed" >&2; exit 2; }

status=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  base="${f%.*}"
  ext="${f##*.}"
  [ -f "$base.test.$ext" ] && continue
  [ "$status" -eq 0 ] && echo "Domain/application files without a sibling test (add <name>.test.ts):" >&2
  echo "$f"
  status=1
done <<< "$files"

exit $status
