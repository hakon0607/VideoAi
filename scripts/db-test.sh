#!/usr/bin/env bash
# Applies the full schema to a throwaway Postgres and runs the RLS test suite.
# Needs a reachable Postgres (PGHOST/PGPORT/PGUSER) — see README > Testing.
set -euo pipefail
DB=${1:-videoai_test}
dropdb --if-exists "$DB"
createdb "$DB"
export PGDATABASE=$DB
for f in supabase/test/00_stub_supabase.sql supabase/migrations/*.sql; do
  echo "-> $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -v ON_ERROR_STOP=1 -f supabase/test/10_rls_test.sql

# The admin suite needs a clean database of its own.
ADMIN_DB="${DB}_admin"
dropdb --if-exists "$ADMIN_DB"
createdb "$ADMIN_DB"
export PGDATABASE=$ADMIN_DB
for f in supabase/test/00_stub_supabase.sql supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -v ON_ERROR_STOP=1 -f supabase/test/11_admin_test.sql

echo "Schema, RLS and admin tests passed." 
