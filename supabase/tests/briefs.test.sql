-- public.briefs: members read, editors and admins write, admins delete; immutable columns stay immutable.
-- RLS refusals and missing column privileges share SQLSTATE 42501, so each throws_ok pins the message too.
begin;
create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated;
select plan(30);

insert into public.users (id, issuer, subject, email) values
  ('e0000000-0000-4000-8000-000000000001', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-editor', 'editor@test.dev'),
  ('e0000000-0000-4000-8000-000000000002', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-approver', 'approver@test.dev'),
  ('e0000000-0000-4000-8000-000000000003', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-admin', 'admin@test.dev'),
  ('e0000000-0000-4000-8000-000000000004', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-other', 'other@test.dev');
insert into public.workspaces (id, name) values
  ('a0000000-0000-4000-8000-00000000000a', 'Tenant A'),
  ('b0000000-0000-4000-8000-00000000000b', 'Tenant B');
insert into public.memberships (workspace_id, user_id, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', 'editor'),
  ('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000002', 'approver'),
  ('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000003', 'admin'),
  ('b0000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-000000000004', 'editor');
insert into public.briefs (id, workspace_id, title, body, created_by) values
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'A brief', 'a body', 'e0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'B brief', 'b body', 'e0000000-0000-4000-8000-000000000004');

set local role authenticated;

-- editor of A
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-editor","email":"editor@test.dev"}', true);

select results_eq('select title from public.briefs', array['A brief'], 'editor sees only Tenant A briefs');
select is_empty($$select 1 from public.briefs where id = 'b1000000-0000-4000-8000-0000000000b1'$$, 'editor cannot read a Tenant B brief by id');
select lives_ok($$insert into public.briefs (workspace_id, title, body) values ('a0000000-0000-4000-8000-00000000000a', 'New A', 'x')$$, 'editor creates a brief in A');
select is((select created_by from public.briefs where title = 'New A'), 'e0000000-0000-4000-8000-000000000001'::uuid, 'created_by is the caller, set by the database');
select is((select status from public.briefs where title = 'New A'), 'draft', 'a new brief is a draft');
select throws_ok($$insert into public.briefs (workspace_id, title, body) values ('b0000000-0000-4000-8000-00000000000b', 'Into B', 'x')$$, '42501', 'new row violates row-level security policy for table "briefs"', 'editor cannot create a brief in B (RLS)');
select throws_ok($$insert into public.briefs (workspace_id, title, body, created_by) values ('a0000000-0000-4000-8000-00000000000a', 'Spoof', 'x', 'e0000000-0000-4000-8000-000000000003')$$, '42501', 'permission denied for table briefs', 'editor cannot choose created_by (column privilege)');

select lives_ok($$update public.briefs set title = 'A brief v2' where id = 'a1000000-0000-4000-8000-0000000000a1'$$, 'editor edits an A brief');
select is((select version from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1'), 2, 'an edit bumps the version');
select throws_ok($$update public.briefs set workspace_id = 'b0000000-0000-4000-8000-00000000000b' where id = 'a1000000-0000-4000-8000-0000000000a1'$$, '42501', 'permission denied for table briefs', 'editor cannot move a brief to another workspace (column privilege)');
select throws_ok($$update public.briefs set status = 'draft' where id = 'a1000000-0000-4000-8000-0000000000a1'$$, '42501', 'permission denied for table briefs', 'editor cannot set status (column privilege)');
select throws_ok($$update public.briefs set version = 99 where id = 'a1000000-0000-4000-8000-0000000000a1'$$, '42501', 'permission denied for table briefs', 'editor cannot set version (column privilege)');
select is_empty($$update public.briefs set title = 'pwned' where id = 'b1000000-0000-4000-8000-0000000000b1' returning id$$, 'editor cannot edit a B brief by id');
select is_empty($$delete from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1' returning id$$, 'editor cannot delete');
select is((select title from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1'), 'A brief v2', 'the refused delete left the brief in place');

select lives_ok($$insert into public.briefs (id, workspace_id, title, body, source_name, source_mime, source_size) values ('a2000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'Uploaded', 'text', 'brief.pdf', 'application/pdf', 1234)$$, 'editor creates an uploaded brief with its source');
select throws_ok($$insert into public.briefs (workspace_id, title, body, source_name) values ('a0000000-0000-4000-8000-00000000000a', 'Half a source', 'x', 'brief.pdf')$$, '23514', null, 'source fields are all or none');
select throws_ok($$update public.briefs set source_name = 'other.pdf' where id = 'a2000000-0000-4000-8000-0000000000a2'$$, '42501', 'permission denied for table briefs', 'the source cannot be changed afterwards (column privilege)');

-- approver of A: read-only
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-approver","email":"approver@test.dev"}', true);

select is((select count(*)::int from public.briefs), 3, 'approver reads every A brief');
select throws_ok($$insert into public.briefs (workspace_id, title, body) values ('a0000000-0000-4000-8000-00000000000a', 'Nope', 'x')$$, '42501', 'new row violates row-level security policy for table "briefs"', 'approver cannot create (RLS)');
select is_empty($$update public.briefs set title = 'by approver' where id = 'a1000000-0000-4000-8000-0000000000a1' returning id$$, 'approver cannot edit');
select is((select title from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1'), 'A brief v2', 'the refused edit changed nothing');
select is_empty($$delete from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1' returning id$$, 'approver cannot delete');

-- admin of A
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-admin","email":"admin@test.dev"}', true);

select is_empty($$delete from public.briefs where id = 'b1000000-0000-4000-8000-0000000000b1' returning id$$, 'admin of A cannot delete a B brief');
select results_eq($$delete from public.briefs where id = 'a1000000-0000-4000-8000-0000000000a1' returning id$$, $$values ('a1000000-0000-4000-8000-0000000000a1'::uuid)$$, 'admin deletes an A brief');

-- editor of B
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-other","email":"other@test.dev"}', true);

select results_eq('select title from public.briefs', array['B brief'], 'B editor sees only Tenant B briefs');

-- the A editor's uid in a token issued to another Okta client
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oaOTHERCLIENT","role":"authenticated","uid":"uid-editor","email":"editor@test.dev"}', true);

select is_empty('select 1 from public.briefs', 'wrong cid reads no briefs');
select throws_ok($$insert into public.briefs (workspace_id, title, body) values ('a0000000-0000-4000-8000-00000000000a', 'Wrong cid', 'x')$$, '42501', 'new row violates row-level security policy for table "briefs"', 'wrong cid cannot create (RLS, before the null created_by is even checked)');
select is_empty($$update public.briefs set title = 'wrong cid' returning id$$, 'wrong cid cannot edit');

reset role;
select is((select count(*)::int from public.briefs where title in ('pwned', 'by approver', 'wrong cid', 'Into B', 'Spoof', 'Nope', 'Wrong cid')), 0, 'no refused write left a trace');

select * from finish();
rollback;
