-- Storage RLS for the briefs bucket: members read, editors and admins upload, only to the exact original path.
-- Deletes are covered by the hosted spike and smoke: storage blocks direct SQL deletes on its tables.
-- Each refusal pins the RLS message, so a missing privilege or a storage trigger can't pass in its place.
begin;
create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated;
select plan(12);

insert into public.users (id, issuer, subject, email) values
  ('f0000000-0000-4000-8000-000000000001', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-s-editor', 'e@test.dev'),
  ('f0000000-0000-4000-8000-000000000002', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-s-approver', 'a@test.dev');
insert into public.workspaces (id, name) values
  ('c0000000-0000-4000-8000-00000000000c', 'Storage A'),
  ('d0000000-0000-4000-8000-00000000000d', 'Storage B');
insert into public.memberships (workspace_id, user_id, role) values
  ('c0000000-0000-4000-8000-00000000000c', 'f0000000-0000-4000-8000-000000000001', 'editor'),
  ('c0000000-0000-4000-8000-00000000000c', 'f0000000-0000-4000-8000-000000000002', 'approver');
-- An object in workspace B, put there by the storage service (as postgres, bypassing RLS).
insert into storage.objects (bucket_id, name) values
  ('briefs', 'workspaces/d0000000-0000-4000-8000-00000000000d/briefs/d1000000-0000-4000-8000-0000000000d1/original');

set local role authenticated;
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-s-editor","email":"e@test.dev"}', true);

select lives_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c1000000-0000-4000-8000-0000000000c1/original')$$, 'editor uploads an original into A');
select results_eq($$select name from storage.objects where bucket_id = 'briefs'$$, array['workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c1000000-0000-4000-8000-0000000000c1/original'], 'editor sees only A objects');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/d0000000-0000-4000-8000-00000000000d/briefs/d2000000-0000-4000-8000-0000000000d2/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'editor cannot upload into B');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c2000000-0000-4000-8000-0000000000c2/original.exe')$$, '42501', 'new row violates row-level security policy for table "objects"', 'the file must be named original');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c3000000-0000-4000-8000-0000000000c3/extra/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'no deeper paths');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/notes/c4000000-0000-4000-8000-0000000000c4/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'only under briefs/');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'other/c0000000-0000-4000-8000-00000000000c/briefs/c5000000-0000-4000-8000-0000000000c5/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'only under workspaces/');
select is_empty($$select 1 from storage.objects where name = 'workspaces/not-a-uuid/briefs/x/original'$$, 'a junk path segment is compared as text, never cast, so it cannot error');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-s-approver","email":"a@test.dev"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'briefs'), 1, 'approver reads A objects');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c6000000-0000-4000-8000-0000000000c6/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'approver cannot upload');

select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oaOTHERCLIENT","role":"authenticated","uid":"uid-s-editor","email":"e@test.dev"}', true);
select is_empty($$select 1 from storage.objects where bucket_id = 'briefs'$$, 'wrong cid sees no objects');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('briefs', 'workspaces/c0000000-0000-4000-8000-00000000000c/briefs/c7000000-0000-4000-8000-0000000000c7/original')$$, '42501', 'new row violates row-level security policy for table "objects"', 'wrong cid cannot upload');

reset role;
select * from finish();
rollback;
