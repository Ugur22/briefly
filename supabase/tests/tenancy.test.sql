-- Cross-tenant isolation for users, workspaces and memberships, with claims shaped like real Okta access tokens.
begin;
create extension if not exists pgtap with schema extensions;
-- The migration revokes default EXECUTE on new functions, which would include pgTAP's own.
grant execute on all functions in schema extensions to anon, authenticated;
select plan(21);

insert into public.users (id, issuer, subject, email) values
  ('11111111-1111-4111-8111-111111111111', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-alice', 'alice@test.dev'),
  ('22222222-2222-4222-8222-222222222222', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-bob', 'bob@test.dev');
insert into public.workspaces (id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Globex');
insert into public.memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'editor');

-- alice
set local role authenticated;
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-alice","sub":"alice@test.dev","email":"alice@test.dev"}', true);

select results_eq('select name from public.workspaces', array['Acme'], 'alice sees only Acme');
select results_eq('select workspace_id from public.memberships', array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid], 'alice sees only Acme memberships');
select results_eq('select email from public.users', array['alice@test.dev'], 'alice sees only her own user row');
select results_eq('select name, role from public.my_workspaces()', $$values ('Acme'::text, 'admin'::text)$$, 'my_workspaces returns Acme as admin');
select is_empty($$select 1 from public.workspaces where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'alice cannot read Globex by id');
select throws_ok($$insert into public.memberships (workspace_id, user_id, role) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'admin')$$, '42501', null, 'alice cannot add herself to Globex');
select throws_ok($$update public.workspaces set name = 'pwned'$$, '42501', null, 'alice cannot rename workspaces');
select throws_ok($$delete from public.memberships$$, '42501', null, 'alice cannot delete memberships');
select throws_ok($$update public.users set subject = 'uid-bob'$$, '42501', null, 'alice cannot rewrite her identity');

-- bob
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-bob","sub":"bob@test.dev","email":"bob@test.dev"}', true);

select results_eq('select name from public.workspaces', array['Globex'], 'bob sees only Globex');
select results_eq('select email from public.users', array['bob@test.dev'], 'bob sees only his own user row');

-- alice's uid, but a token issued to another Okta client (same server, so same aud)
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oaOTHERCLIENT","role":"authenticated","uid":"uid-alice","email":"alice@test.dev"}', true);
select is_empty('select 1 from public.workspaces', 'wrong cid sees no workspaces');
select is_empty('select 1 from public.users', 'wrong cid sees no users');
select is_empty('select 1 from public.my_workspaces()', 'wrong cid gets no my_workspaces');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://other","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-alice","email":"alice@test.dev"}', true);
select is_empty('select 1 from public.workspaces', 'wrong aud sees no workspaces');

select set_config('request.jwt.claims', '{"iss":"https://evil.example.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-alice","email":"alice@test.dev"}', true);
select is_empty('select 1 from public.workspaces', 'wrong iss sees no workspaces');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","sub":"alice@test.dev","email":"alice@test.dev"}', true);
select is_empty('select 1 from public.workspaces', 'missing uid sees no workspaces (sub alone is never identity)');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-alice","email":"alice@test.dev"}', true);
select results_eq('select name from public.workspaces', array['Acme'], 'alice is back to Acme with valid claims');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-stranger","email":"stranger@test.dev"}', true);
select is_empty('select 1 from public.workspaces', 'a valid but unknown user sees no workspaces');
select is_empty('select 1 from public.memberships', 'a valid but unknown user sees no memberships');
select is_empty('select 1 from public.users', 'a valid but unknown user sees no users');

reset role;
select * from finish();
rollback;
