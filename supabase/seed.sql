-- Demo data: two workspaces, alice and bob in one each, the owner in both.
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
  ('acacacac-0000-4000-8000-000000000001'::uuid, '00u19z08ikycsscqX698', 'admin'),
  ('6106e600-0000-4000-8000-000000000002'::uuid, '00u19z08ikycsscqX698', 'admin')
) as m (workspace_id, subject, role)
join public.workspaces ws on ws.id = m.workspace_id
join public.users u on u.subject = m.subject and u.issuer = 'https://integrator-1689783.okta.com/oauth2/default'
on conflict (workspace_id, user_id) do nothing;
