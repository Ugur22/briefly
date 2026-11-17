-- provision_me(): creates the user from verified claims only, keyed on uid, idempotent.
begin;
create extension if not exists pgtap with schema extensions;
-- The migration revokes default EXECUTE on new functions, which would include pgTAP's own.
grant execute on all functions in schema extensions to anon, authenticated;
select plan(8);

set local role authenticated;

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-new","sub":"new@test.dev","email":"new@test.dev"}', true);

select is((select email from public.provision_me()), 'new@test.dev', 'first call creates the user');
select is((select subject from public.provision_me()), 'uid-new', 'keyed on the Okta uid');

-- Kept in a transaction-local setting rather than a temp table, which authenticated may not be allowed to create.
select set_config('test.first_id', (select id::text from public.provision_me()), true);
select is((select id from public.provision_me()), current_setting('test.first_id')::uuid, 'repeat calls return the same user');

-- The login (and so sub and email) changes; uid doesn't.
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-new","sub":"renamed@test.dev","email":"renamed@test.dev"}', true);
select is((select id from public.provision_me()), current_setting('test.first_id')::uuid, 'an email change keeps the same user');
select is((select email from public.users), 'renamed@test.dev', 'and updates the stored email');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oaOTHERCLIENT","role":"authenticated","uid":"uid-other","email":"other@test.dev"}', true);
select throws_ok('select public.provision_me()', '42501', null, 'a token for another client cannot provision');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-noemail"}', true);
select throws_ok('select public.provision_me()', '42501', null, 'a token without email cannot provision');

reset role;
select is((select count(*)::int from public.users where subject in ('uid-other', 'uid-noemail')), 0, 'refused calls wrote nothing');

select * from finish();
rollback;
