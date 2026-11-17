-- The approval workflow trigger: every transition per role, locks, comments and self-approval, exercised as
-- direct UPDATEs (the same thing a PostgREST PATCH does), so the rules hold whatever the path.
begin;
create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated;
select plan(30);

insert into public.users (id, issuer, subject, email) values
  ('90000000-0000-4000-8000-000000000001', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-w-editor', 'e@test.dev'),
  ('90000000-0000-4000-8000-000000000002', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-w-approver', 'p@test.dev'),
  ('90000000-0000-4000-8000-000000000003', 'https://integrator-1689783.okta.com/oauth2/default', 'uid-w-admin', 'd@test.dev');
insert into public.workspaces (id, name) values
  ('9a000000-0000-4000-8000-00000000000a', 'Workflow A'),
  ('9a000000-0000-4000-8000-00000000000b', 'Workflow B');
insert into public.memberships (workspace_id, user_id, role) values
  ('9a000000-0000-4000-8000-00000000000a', '90000000-0000-4000-8000-000000000001', 'editor'),
  ('9a000000-0000-4000-8000-00000000000a', '90000000-0000-4000-8000-000000000002', 'approver'),
  ('9a000000-0000-4000-8000-00000000000a', '90000000-0000-4000-8000-000000000003', 'admin');
-- x and z have a succeeded review of their current text; y has none.
insert into public.briefs (id, workspace_id, title, body, created_by) values
  ('9b000000-0000-4000-8000-0000000000a1', '9a000000-0000-4000-8000-00000000000a', 'X', 'x', '90000000-0000-4000-8000-000000000001'),
  ('9b000000-0000-4000-8000-0000000000a2', '9a000000-0000-4000-8000-00000000000a', 'Y', 'y', '90000000-0000-4000-8000-000000000001'),
  ('9b000000-0000-4000-8000-0000000000a3', '9a000000-0000-4000-8000-00000000000a', 'Z', 'z', '90000000-0000-4000-8000-000000000003'),
  ('9b000000-0000-4000-8000-0000000000a4', '9a000000-0000-4000-8000-00000000000a', 'W', 'written by the admin', '90000000-0000-4000-8000-000000000003'),
  ('9b000000-0000-4000-8000-0000000000b1', '9a000000-0000-4000-8000-00000000000b', 'B', 'b', '90000000-0000-4000-8000-000000000003');
-- set up as postgres (the trigger only judges requests made as users)
update public.briefs set status = 'in_review', submitted_by = '90000000-0000-4000-8000-000000000001', submitted_at = now()
where id in ('9b000000-0000-4000-8000-0000000000a4', '9b000000-0000-4000-8000-0000000000b1');
insert into public.brief_reviews (brief_id, workspace_id, brief_version, state, result, created_by) values
  ('9b000000-0000-4000-8000-0000000000a1', '9a000000-0000-4000-8000-00000000000a', 1, 'succeeded', '{"summary":"ok","areas":{}}', '90000000-0000-4000-8000-000000000001'),
  ('9b000000-0000-4000-8000-0000000000a3', '9a000000-0000-4000-8000-00000000000a', 1, 'succeeded', '{"summary":"ok","areas":{}}', '90000000-0000-4000-8000-000000000003');

set local role authenticated;

-- editor
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-w-editor","email":"e@test.dev"}', true);
select throws_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a2'$$, 'BRF03', null, 'no submit without a review of the current text');
select throws_ok($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000a2'$$, 'BRF04', null, 'a draft cannot jump to approved');
select lives_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'editor submits a reviewed brief');
select is((select submitted_by from public.briefs where id = '9b000000-0000-4000-8000-0000000000a1'), '90000000-0000-4000-8000-000000000001'::uuid, 'the database records who submitted');
select throws_ok($$update public.briefs set title = 'changed' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF01', null, 'a brief in review is locked');
select is_empty($$update public.brief_reviews set state = 'pending' where brief_id = '9b000000-0000-4000-8000-0000000000a1' returning brief_id$$, 'its review is locked too (RLS: brief not editable)');
select throws_ok($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'an editor cannot approve');
select throws_ok($$update public.briefs set decision_comment = 'sneaky' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF04', null, 'a comment cannot be set without a decision');
select throws_ok($$update public.briefs set submitted_by = '90000000-0000-4000-8000-000000000002' where id = '9b000000-0000-4000-8000-0000000000a1'$$, '42501', 'permission denied for table briefs', 'who submitted cannot be rewritten');
select throws_ok($$update public.briefs set decided_by = '90000000-0000-4000-8000-000000000001', decided_at = now() where id = '9b000000-0000-4000-8000-0000000000a1'$$, '42501', 'permission denied for table briefs', 'who decided cannot be written');

-- approver
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-w-approver","email":"p@test.dev"}', true);
select throws_ok($$update public.briefs set title = 'by approver' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF01', null, 'an approver cannot change the text');
select throws_ok($$update public.briefs set status = 'changes_requested' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF05', null, 'sending back needs a comment');
select throws_ok($$update public.briefs set status = 'changes_requested', decision_comment = '   ' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF05', null, 'a blank comment is no comment');
select throws_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a2'$$, '42501', 'only editors and admins submit briefs', 'an approver cannot submit');
select is_empty($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000b1' returning id$$, 'an approver of A cannot decide on a B brief');
select lives_ok($$update public.briefs set status = 'changes_requested', decision_comment = '  Add the launch date.  ' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'approver sends it back with a comment');
select is((select decision_comment from public.briefs where id = '9b000000-0000-4000-8000-0000000000a1'), 'Add the launch date.', 'the comment is stored trimmed');
select is((select decided_by from public.briefs where id = '9b000000-0000-4000-8000-0000000000a1'), '90000000-0000-4000-8000-000000000002'::uuid, 'the database records who decided');

-- editor fixes it; the old review no longer matches the text
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-w-editor","email":"e@test.dev"}', true);
select lives_ok($$update public.briefs set body = 'x, launch 1 April' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'changes_requested is editable again');
select throws_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF03', null, 'resubmitting needs a review of the new text');
select lives_ok($$update public.brief_reviews set brief_version = 2 where brief_id = '9b000000-0000-4000-8000-0000000000a1'$$, 'the review is regenerated for the new text');
select lives_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'editor resubmits');
select is((select decision_comment from public.briefs where id = '9b000000-0000-4000-8000-0000000000a1'), null, 'resubmitting clears the previous decision');

-- admin: may decide, but not on their own submission
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-w-admin","email":"d@test.dev"}', true);
select lives_ok($$update public.briefs set status = 'in_review' where id = '9b000000-0000-4000-8000-0000000000a3'$$, 'admin submits their own brief');
select throws_ok($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000a3'$$, 'BRF02', null, 'nobody approves their own submission, admins included');
select lives_ok($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000a4'$$, 'self-approval is about who submitted: an admin may approve a brief they wrote that an editor submitted (documented limit)');

-- approver approves the editor's brief
select set_config('request.jwt.claims', '{"iss":"https://integrator-1689783.okta.com/oauth2/default","aud":"api://briefly","cid":"0oa19zytyljuR1XIg698","role":"authenticated","uid":"uid-w-approver","email":"p@test.dev"}', true);
select lives_ok($$update public.briefs set status = 'approved' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'approver approves');
select throws_ok($$update public.briefs set title = 'after approval' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF01', null, 'an approved brief is final');
select throws_ok($$update public.briefs set status = 'draft' where id = '9b000000-0000-4000-8000-0000000000a1'$$, 'BRF04', null, 'and cannot be reopened');

reset role;
select is((select status from public.briefs where id = '9b000000-0000-4000-8000-0000000000a1'), 'approved', 'the brief ended approved');

select * from finish();
rollback;
