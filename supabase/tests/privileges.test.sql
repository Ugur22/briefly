-- Exact grants, so the local stack and hosted (auto-expose off) can't drift apart unnoticed.
begin;
create extension if not exists pgtap with schema extensions;
-- The migration revokes default EXECUTE on new functions, which would include pgTAP's own.
grant execute on all functions in schema extensions to anon, authenticated;
select plan(16);

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

select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.users'::regclass, 'public.workspaces'::regclass, 'public.memberships'::regclass)),
  'RLS is enabled on every identity table'
);

set local role anon;
select throws_ok('select * from public.workspaces', '42501', null, 'anon is refused at the table, not just filtered');
select throws_ok('select public.provision_me()', '42501', null, 'anon cannot call provision_me');
reset role;

select * from finish();
rollback;
