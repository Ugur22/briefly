#!/bin/bash
# Prints every RLS gap in supabase/; prints nothing (exit 0) when covered. Used by CI and `/goal`.
# - every public table has RLS enabled in a migration
# - every table with a workspace_id column is named in a pgTAP test other than privileges.test.sql (grants alone prove no isolation)
# - no auth.uid() outside comments (it casts sub to uuid; Okta's sub is an email)
set -u
cd "$(dirname "$0")/.." || exit 1

migrations=supabase/migrations
tests=supabase/tests
gaps=0
report() { echo "$1"; gaps=1; }

# Lowercased SQL with -- comments stripped, so prose can mention what code must not use.
sql() { sed -e 's/--.*$//' "$@" | tr '[:upper:]' '[:lower:]'; }

all_migrations=$(sql "$migrations"/*.sql 2>/dev/null)
isolation_tests=$(find "$tests" -name '*.sql' ! -name 'privileges.test.sql' -print0 2>/dev/null | xargs -0 cat 2>/dev/null | sed -e 's/--.*$//' | tr '[:upper:]' '[:lower:]')

tables=$(echo "$all_migrations" | grep -oE 'create table (if not exists )?public\.[a-z_0-9]+' | awk '{print $NF}' | sort -u)

for t in $tables; do
  echo "$all_migrations" | grep -qE "alter table $t enable row level security" \
    || report "$t: RLS not enabled"

  # The column list runs from `create table <t> (` to the closing `);`.
  if echo "$all_migrations" | awk -v t="$t" '$0 ~ "create table (if not exists )?"t" " {f=1} f {print} f && /^\);/ {f=0}' | grep -qE '^\s*workspace_id\s'; then
    echo "$isolation_tests" | grep -qF "$t" || report "$t: has workspace_id but no isolation test names it"
  fi
done

if grep -rn --include='*.sql' 'auth\.uid()' supabase | grep -vE ':\s*--' >/dev/null; then
  grep -rn --include='*.sql' 'auth\.uid()' supabase | grep -vE ':[0-9]+:\s*--' | sed 's/^/auth.uid() used: /'
  gaps=1
fi

exit $gaps
