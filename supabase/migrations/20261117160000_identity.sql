-- Identity and tenancy: users (keyed on Okta issuer + uid), workspaces, memberships.
-- Requests reach Postgres as role `authenticated` with the Okta access token as request.jwt.claims.
-- Supabase verifies the signature and issuer but not aud or cid, so private.trusted_claims() does.
-- Never use auth.uid(): it casts sub to uuid, and Okta's sub is the login email.

-- Nothing is exposed unless a migration grants it, on the local stack and hosted alike.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- Postgres can't scope this one per schema, so it is global: functions postgres creates later, extensions
-- included, need an explicit grant before anon or authenticated can call them (the pgTAP tests do this).
alter default privileges for role postgres revoke execute on functions from public;

-- Not in the Data API's exposed schemas, so helpers can't be called over HTTP.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_issuer_subject_key unique (issuer, subject)
);
comment on column public.users.subject is 'Okta uid (00u...), stable across email/login changes. Not the token''s sub.';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('editor', 'approver', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;

-- Invoker is enough: it only reads the caller's own claims.
create function private.trusted_claims()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() ->> 'iss' = 'https://integrator-1689783.okta.com/oauth2/default'
    and auth.jwt() ->> 'aud' = 'api://briefly'
    and auth.jwt() ->> 'cid' = '0oa19zytyljuR1XIg698'
    and auth.jwt() ->> 'role' = 'authenticated'
    and coalesce(auth.jwt() ->> 'uid', '') <> '',
    false
  );
$$;

-- Definer: the users policy calls this, so reading users as the caller would recurse.
create function private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where private.trusted_claims()
    and u.issuer = auth.jwt() ->> 'iss'
    and u.subject = auth.jwt() ->> 'uid';
$$;

-- Set-returning so policies evaluate it once per statement (`x in (select ...)`), not once per row.
create function private.member_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.memberships m
  where m.user_id = private.current_user_id();
$$;

revoke execute on function private.trusted_claims() from public, anon;
revoke execute on function private.current_user_id() from public, anon;
revoke execute on function private.member_workspace_ids() from public, anon;
grant execute on function private.trusted_claims() to authenticated;
grant execute on function private.current_user_id() to authenticated;
grant execute on function private.member_workspace_ids() to authenticated;

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select private.current_user_id()));

create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (id in (select private.member_workspace_ids()));

create policy memberships_select_member on public.memberships
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

-- Read-only for users in Phase 1; workspaces and memberships are seeded.
grant select on public.users, public.workspaces, public.memberships to authenticated;

-- Just-in-time provisioning. Definer because the caller can't see (or insert) a row that doesn't exist yet;
-- it takes no arguments, so everything it writes comes from the verified token.
create function public.provision_me()
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := auth.jwt();
  result public.users;
begin
  if not private.trusted_claims() or coalesce(claims ->> 'email', '') = '' then
    raise exception 'token not accepted' using errcode = '42501';
  end if;

  insert into public.users (issuer, subject, email)
  values (claims ->> 'iss', claims ->> 'uid', claims ->> 'email')
  on conflict (issuer, subject) do update
    set email = excluded.email, updated_at = now()
    where public.users.email is distinct from excluded.email;

  select * into result
  from public.users u
  where u.issuer = claims ->> 'iss' and u.subject = claims ->> 'uid';

  return result;
end;
$$;

-- Invoker: RLS on workspaces and memberships decides what comes back.
create function public.my_workspaces()
returns table (id uuid, name text, role text)
language sql
stable
set search_path = ''
as $$
  select w.id, w.name, m.role
  from public.memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select private.current_user_id())
  order by w.name;
$$;

revoke execute on function public.provision_me() from public, anon;
revoke execute on function public.my_workspaces() from public, anon;
grant execute on function public.provision_me() to authenticated;
grant execute on function public.my_workspaces() to authenticated;
