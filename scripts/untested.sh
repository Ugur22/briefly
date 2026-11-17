#!/bin/bash
# Prints every non-test source file under */domain or */application without a sibling test; prints nothing when covered.
set -u
cd "$(dirname "$0")/.." || exit 1

status=0
while IFS= read -r f; do
  base="${f%.*}"
  ext="${f##*.}"
  [ -f "$base.test.$ext" ] || { echo "$f"; status=1; }
done < <(find apps libs -type f \( -path '*/domain/*' -o -path '*/application/*' \) \
  \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' ! -name 'index.ts' ! -path '*/node_modules/*' 2>/dev/null)

exit $status
