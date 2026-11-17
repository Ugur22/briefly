-- Exact grants, so the local stack and hosted (auto-expose off) can't drift apart unnoticed.
begin;
create extension if not exists pgtap with schema extensions;
-- The migration revokes default EXECUTE on new functions, which would include pgTAP's own.
grant execute on all functions in schema extensions to anon, authenticated;
select plan(35);

select table_privs_are('public', 'users', 'anon', array[]::text[], 'anon has no access to users');
select table_privs_are('public', 'workspaces', 'anon', array[]::text[], 'anon has no access to workspaces');
select table_privs_are('public', 'memberships', 'anon', array[]::text[], 'anon has no access to memberships');

select table_privs_are('public', 'users', 'authenticated', array['SELECT'], 'authenticated can only select users');
select table_privs_are('public', 'workspaces', 'authenticated', array['SELECT'], 'authenticated can only select workspaces');
select table_privs_are('public', 'memberships', 'authenticated', array['SELECT'], 'authenticated can only select memberships');

select function_privs_are('public', 'provision_me', array[]::name[], 'anon', array[]::text[], 'anon cannot provision');
select function_privs_are('public', 'my_workspaces', array[]::name[], 'anon', array[]::text[], 'anon cannot list workspaces');
select function_privs_are('public', 'provision_me', array[]::name[], 'authenticated', array['EXECUTE'], 'authenticated can provision');
select function_privs_are('public', 'my_workspaces', array[]::name[], 'authenticated', array['EXECUTE'], 'authenticated can list workspaces');
select function_privs_are('private', 'trusted_claims', array[]::name[], 'anon', array[]::text[], 'anon cannot call trusted_claims');
select function_privs_are('private', 'current_user_id', array[]::name[], 'anon', array[]::text[], 'anon cannot call current_user_id');
select function_privs_are('private', 'member_workspace_ids', array[]::name[], 'anon', array[]::text[], 'anon cannot call member_workspace_ids');

-- briefs: whole-table read and delete, but only the editable columns can be written.
select table_privs_are('public', 'briefs', 'anon', array[]::text[], 'anon has no access to briefs');
select table_privs_are('public', 'briefs', 'authenticated', array['SELECT', 'DELETE'], 'authenticated has table-wide select and delete only');
select column_privs_are('public', 'briefs', 'workspace_id', 'authenticated', array['SELECT', 'INSERT'], 'workspace_id is set on insert, never changed');
select column_privs_are('public', 'briefs', 'title', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], 'title is writable');
select column_privs_are('public', 'briefs', 'body', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], 'body is writable');
select column_privs_are('public', 'briefs', 'created_by', 'authenticated', array['SELECT'], 'created_by is set by the database');
select column_privs_are('public', 'briefs', 'status', 'authenticated', array['SELECT'], 'status is not writable yet');
select column_privs_are('public', 'briefs', 'version', 'authenticated', array['SELECT'], 'version is set by the database');
select column_privs_are('public', 'briefs', 'id', 'authenticated', array['SELECT', 'INSERT'], 'the API chooses a new brief id, which is never changed');
select column_privs_are('public', 'briefs', 'source_name', 'authenticated', array['SELECT', 'INSERT'], 'source_name is set once');
select column_privs_are('public', 'briefs', 'source_mime', 'authenticated', array['SELECT', 'INSERT'], 'source_mime is set once');
select column_privs_are('public', 'briefs', 'source_size', 'authenticated', array['SELECT', 'INSERT'], 'source_size is set once');
select table_privs_are('public', 'brief_reviews', 'anon', array[]::text[], 'anon has no access to reviews');
select table_privs_are('public', 'brief_reviews', 'authenticated', array['SELECT'], 'reviews: table-wide read only; writes are per column');
select column_privs_are('public', 'brief_reviews', 'result', 'authenticated', array['SELECT', 'UPDATE'], 'the result is written by update');
select column_privs_are('public', 'brief_reviews', 'brief_id', 'authenticated', array['SELECT', 'INSERT'], 'a review is attached once');
select column_privs_are('public', 'brief_reviews', 'created_by', 'authenticated', array['SELECT'], 'created_by is set by the database');
select function_privs_are('private', 'workspace_ids_with_role', array['text[]'], 'anon', array[]::text[], 'anon cannot call workspace_ids_with_role');
select function_privs_are('private', 'workspace_ids_with_role', array['text[]'], 'authenticated', array['EXECUTE'], 'authenticated can call workspace_ids_with_role (policies need it)');

select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.users'::regclass, 'public.workspaces'::regclass, 'public.memberships'::regclass, 'public.briefs'::regclass, 'public.brief_reviews'::regclass)),
  'RLS is enabled on every table'
);

set local role anon;
select throws_ok('select * from public.workspaces', '42501', null, 'anon is refused at the table, not just filtered');
select throws_ok('select public.provision_me()', '42501', null, 'anon cannot call provision_me');
reset role;

select * from finish();
rollback;
