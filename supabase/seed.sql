-- Demo data: two workspaces. alice: admin of Acme. bob: editor of Globex and approver (read-only) in Acme.
-- The owner: admin of both.
-- Users are pre-provisioned with their Okta uids (not secret); provision_me() replaces the placeholder email on first sign-in.
-- Idempotent, so it can be re-run while preparing the demo.

insert into public.users (id, issuer, subject, email) values
  ('a11ce000-0000-4000-8000-000000000001', 'https://integrator-1689783.okta.com/oauth2/default', '00u19zzk1frqbosSJ698', 'alice@seed.invalid'),
  ('b0b00000-0000-4000-8000-000000000002', 'https://integrator-1689783.okta.com/oauth2/default', '00u19zzi2k70rx0Aw698', 'bob@seed.invalid'),
  ('0e0e0000-0000-4000-8000-000000000003', 'https://integrator-1689783.okta.com/oauth2/default', '00u19z08ikycsscqX698', 'owner@seed.invalid')
on conflict (issuer, subject) do nothing;

insert into public.workspaces (id, name) values
  ('acacacac-0000-4000-8000-000000000001', 'Acme Rotterdam'),
  ('6106e600-0000-4000-8000-000000000002', 'Globex Amsterdam')
on conflict (id) do nothing;

insert into public.memberships (workspace_id, user_id, role)
select ws.id, u.id, m.role
from (values
  ('acacacac-0000-4000-8000-000000000001'::uuid, '00u19zzk1frqbosSJ698', 'admin'),
  ('6106e600-0000-4000-8000-000000000002'::uuid, '00u19zzi2k70rx0Aw698', 'editor'),
  ('acacacac-0000-4000-8000-000000000001'::uuid, '00u19zzi2k70rx0Aw698', 'approver'),
  ('acacacac-0000-4000-8000-000000000001'::uuid, '00u19z08ikycsscqX698', 'admin'),
  ('6106e600-0000-4000-8000-000000000002'::uuid, '00u19z08ikycsscqX698', 'admin')
) as m (workspace_id, subject, role)
join public.workspaces ws on ws.id = m.workspace_id
join public.users u on u.subject = m.subject and u.issuer = 'https://integrator-1689783.okta.com/oauth2/default'
on conflict (workspace_id, user_id) do nothing;

-- Runs without a token, so created_by is explicit (its default, current_user_id(), would be null here).
insert into public.briefs (id, workspace_id, title, body, created_by)
select b.id, b.workspace_id, b.title, b.body, u.id
from (values
  ('b1ef0000-0000-4000-8000-000000000001'::uuid, 'acacacac-0000-4000-8000-000000000001'::uuid, '00u19zzk1frqbosSJ698',
   'Spring launch: Rotterdam e-bikes',
   'Client: Acme Mobility. Goal: 5,000 test rides in April. Audience: commuters 25-45 in Rotterdam. Channels: Instagram, Spotify audio, OOH near Centraal. Budget: EUR 80k. Must mention the 30-day trial.'),
  ('b1ef0000-0000-4000-8000-000000000002'::uuid, 'acacacac-0000-4000-8000-000000000001'::uuid, '00u19z08ikycsscqX698',
   'Q3 retention email series',
   'Client: Acme Mobility. Three emails to riders who stopped after the trial. Tone: friendly, no discounts above 15%. KPI: reactivation rate.'),
  ('b1ef0000-0000-4000-8000-000000000003'::uuid, '6106e600-0000-4000-8000-000000000002'::uuid, '00u19zzi2k70rx0Aw698',
   'Globex brand refresh teaser',
   'Client: Globex Amsterdam. Teaser campaign for the new identity, launch 1 June. Channels: LinkedIn and trade press. No product claims before launch.')
) as b (id, workspace_id, subject, title, body)
join public.users u on u.subject = b.subject and u.issuer = 'https://integrator-1689783.okta.com/oauth2/default'
on conflict (id) do nothing;
