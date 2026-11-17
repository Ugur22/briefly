-- Briefs: members read, editors and admins create and edit, admins delete.
-- Column grants keep workspace_id, created_by, status and version out of users' hands without a guard trigger.

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 50000),
  status text not null default 'draft' check (status in ('draft')),
  version integer not null default 1,
  -- Evaluated as the caller; the insert policy re-checks it.
  created_by uuid not null default private.current_user_id() references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index briefs_workspace_id_updated_at_idx on public.briefs (workspace_id, updated_at desc);
create index briefs_created_by_idx on public.briefs (created_by);

alter table public.briefs enable row level security;

-- Same shape as member_workspace_ids: set-returning, so a policy evaluates it once per statement.
create function private.workspace_ids_with_role(roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.memberships m
  where m.user_id = private.current_user_id()
    and m.role = any (roles);
$$;
revoke execute on function private.workspace_ids_with_role(text[]) from public, anon;
grant execute on function private.workspace_ids_with_role(text[]) to authenticated;

create policy briefs_select_member on public.briefs
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

create policy briefs_insert_writer on public.briefs
  for insert to authenticated
  with check (
    workspace_id in (select private.workspace_ids_with_role(array['editor', 'admin']))
    and created_by = (select private.current_user_id())
  );

create policy briefs_update_writer on public.briefs
  for update to authenticated
  using (workspace_id in (select private.workspace_ids_with_role(array['editor', 'admin'])))
  with check (workspace_id in (select private.workspace_ids_with_role(array['editor', 'admin'])));

create policy briefs_delete_admin on public.briefs
  for delete to authenticated
  using (workspace_id in (select private.workspace_ids_with_role(array['admin'])));

grant select, delete on public.briefs to authenticated;
grant insert (workspace_id, title, body) on public.briefs to authenticated;
grant update (title, body) on public.briefs to authenticated;

-- Every edit bumps the version the API's optimistic lock compares against.
-- Trigger functions run without an EXECUTE check, so no grant is needed.
create function private.briefs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.briefs_touch() from public, anon, authenticated;

create trigger briefs_touch
  before update on public.briefs
  for each row execute function private.briefs_touch();
