-- public.brief_reviews: members read, editors and admins of the workspace write, never across tenants.
-- The "only while the brief is editable" rule is exercised in Phase 4b, when briefs can leave draft.
begin;
create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated;
select plan(14);

insert into public.users (id, issuer, subject, email) values
  ('70000000-0000-4000-8000-000000000001', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-r-editor', 'e@test.dev'),
  ('70000000-0000-4000-8000-000000000002', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-r-approver', 'a@test.dev'),
  ('70000000-0000-4000-8000-000000000003', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-r-other', 'o@test.dev');
insert into public.workspaces (id, name) values
  ('7a000000-0000-4000-8000-00000000000a', 'Review A'),
  ('7b000000-0000-4000-8000-00000000000b', 'Review B');
insert into public.memberships (workspace_id, user_id, role) values
  ('7a000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000001', 'editor'),
  ('7a000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000002', 'approver'),
  ('7b000000-0000-4000-8000-00000000000b', '70000000-0000-4000-8000-000000000003', 'editor');
insert into public.briefs (id, workspace_id, title, body, created_by) values
  ('7a100000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-00000000000a', 'A1', 'a', '70000000-0000-4000-8000-000000000001'),
  ('7a200000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-00000000000a', 'A2', 'a', '70000000-0000-4000-8000-000000000001'),
  ('7b100000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-00000000000b', 'B1', 'b', '70000000-0000-4000-8000-000000000003');
insert into public.brief_reviews (brief_id, workspace_id, brief_version, state, created_by) values
  ('7b100000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-00000000000b', 1, 'pending', '70000000-0000-4000-8000-000000000003');

set local role authenticated;

-- editor of A
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-r-editor","email":"e@test.dev"}', true);

select lives_ok($$insert into public.brief_reviews (brief_id, workspace_id, brief_version, state) values ('7a100000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-00000000000a', 1, 'pending')$$, 'editor starts a review of an A brief');
select lives_ok($$update public.brief_reviews set state = 'succeeded', result = '{"summary":"ok","areas":{}}', completed_at = now() where brief_id = '7a100000-0000-4000-8000-0000000000a1'$$, 'editor saves the result');
select results_eq('select brief_id from public.brief_reviews', array['7a100000-0000-4000-8000-0000000000a1'::uuid], 'editor sees only A reviews');
select throws_ok($$insert into public.brief_reviews (brief_id, workspace_id, brief_version, state) values ('7b100000-0000-4000-8000-0000000000b1', '7a000000-0000-4000-8000-00000000000a', 1, 'pending')$$, '42501', 'new row violates row-level security policy for table "brief_reviews"', 'a review cannot pair a B brief with workspace A (RLS first; the composite foreign key backs it up)');
select throws_ok($$insert into public.brief_reviews (brief_id, workspace_id, brief_version, state, created_by) values ('7a200000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-00000000000a', 1, 'pending', '70000000-0000-4000-8000-000000000003')$$, '42501', 'permission denied for table brief_reviews', 'created_by is set by the database');
select is_empty($$update public.brief_reviews set state = 'failed', error_code = 'timeout' where brief_id = '7b100000-0000-4000-8000-0000000000b1' returning brief_id$$, 'editor cannot touch a B review');
select throws_ok($$delete from public.brief_reviews$$, '42501', 'permission denied for table brief_reviews', 'reviews are never deleted directly');
select throws_ok($$update public.brief_reviews set result = '{"no":"areas"}' where brief_id = '7a100000-0000-4000-8000-0000000000a1'$$, '23514', null, 'a stored review keeps its shape');

-- the version moves only with the text
select lives_ok($$update public.briefs set title = title where id = '7a100000-0000-4000-8000-0000000000a1'$$, 'a no-op update');
select is((select version from public.briefs where id = '7a100000-0000-4000-8000-0000000000a1'), 1, 'an update that leaves the text alone keeps the version (the review stays current)');

-- approver of A: reads, never writes
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-r-approver","email":"a@test.dev"}', true);
select is((select count(*)::int from public.brief_reviews), 1, 'approver reads the A review');
select throws_ok($$insert into public.brief_reviews (brief_id, workspace_id, brief_version, state) values ('7a200000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-00000000000a', 1, 'pending')$$, '42501', 'new row violates row-level security policy for table "brief_reviews"', 'approver cannot start a review');
select is_empty($$update public.brief_reviews set state = 'failed', error_code = 'timeout' returning brief_id$$, 'approver cannot change a review');

-- wrong client
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oaOTHERCLIENT","role":"authenticated","uid":"uid-r-editor","email":"e@test.dev"}', true);
select is_empty('select 1 from public.brief_reviews', 'wrong cid reads no reviews');

reset role;
select * from finish();
rollback;
