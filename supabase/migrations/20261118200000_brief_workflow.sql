-- Approval workflow: draft → in_review → approved | changes_requested → (edit) → in_review …
-- The trigger below is the authority on the state machine, whatever the path (our API or a direct PostgREST
-- call); whether a review is "current" is a weaker guarantee, see the limits further down:
--   * title/body change only in draft | changes_requested, and only by editors/admins;
--   * submit (→ in_review) by editors/admins, only with a succeeded review of the current text;
--   * decide (→ approved | changes_requested) by approvers/admins, never by whoever submitted it;
--     sending back needs a comment;
--   * who submitted and who decided are set here, never taken from the request.
-- Deliberate limits, stated so they are choices rather than surprises:
--   * "a review of the current text" means a review row exists for this version. Editors may edit reviews, so
--     with their own token they could also mark one current; the gate proves a review exists, the human
--     approver is the control on its content.
--   * self-approval is checked against who submitted, not who wrote the text (an admin can approve a brief
--     they wrote if an editor submitted it).
--   * admins may still delete a brief in any status.
--   * only requests made as `authenticated` are judged: a future security-definer function writing briefs
--     would bypass this trigger and must enforce the same rules itself.
-- Errors carry their own SQLSTATEs so the API can answer with specific codes:
--   BRF01 locked · BRF02 self_approval · BRF03 no_current_review · BRF04 invalid_transition · BRF05 comment_required

alter table public.briefs drop constraint briefs_status_check;
alter table public.briefs add constraint briefs_status_check
  check (status in ('draft', 'in_review', 'approved', 'changes_requested'));

alter table public.briefs
  add column submitted_by uuid references public.users (id),
  add column submitted_at timestamptz,
  add column decided_by uuid references public.users (id),
  add column decided_at timestamptz,
  add column decision_comment text check (char_length(decision_comment) <= 2000);
create index briefs_submitted_by_idx on public.briefs (submitted_by);
create index briefs_decided_by_idx on public.briefs (decided_by);

-- Grants are table-wide for every authenticated user, so the trigger guards every column they open.
grant update (status, decision_comment) on public.briefs to authenticated;

-- Approvers need to update a row to decide on it; what they may change is decided by the trigger.
create policy briefs_update_approver on public.briefs
  for update to authenticated
  using (workspace_id in (select private.workspace_ids_with_role(array['approver', 'admin'])))
  with check (workspace_id in (select private.workspace_ids_with_role(array['approver', 'admin'])));

create function private.briefs_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller uuid;
  caller_role text;
  text_changed boolean := (new.title, new.body) is distinct from (old.title, old.body);
  status_changed boolean := new.status is distinct from old.status;
begin
  -- Only requests made as a user are judged; migrations, seeds and test setup run as other roles.
  if current_user <> 'authenticated' then
    return new;
  end if;

  caller := private.current_user_id();
  if caller is null then
    raise exception 'unknown caller' using errcode = '42501';
  end if;
  select m.role into caller_role
  from public.memberships m
  where m.workspace_id = old.workspace_id and m.user_id = caller;

  if text_changed then
    if old.status not in ('draft', 'changes_requested') then
      raise exception 'brief is locked' using errcode = 'BRF01';
    end if;
    if caller_role is distinct from 'editor' and caller_role is distinct from 'admin' then
      raise exception 'only editors and admins edit briefs' using errcode = '42501';
    end if;
  end if;

  -- The comment is part of a decision; it can't be set or changed on its own.
  if new.decision_comment is distinct from old.decision_comment
     and not (status_changed and new.status in ('approved', 'changes_requested')) then
    raise exception 'a comment belongs to a decision' using errcode = 'BRF04';
  end if;

  if not status_changed then
    return new;
  end if;

  if new.status = 'in_review' and old.status in ('draft', 'changes_requested') then
    if caller_role is distinct from 'editor' and caller_role is distinct from 'admin' then
      raise exception 'only editors and admins submit briefs' using errcode = '42501';
    end if;
    if text_changed then
      raise exception 'submit the brief as saved' using errcode = 'BRF04';
    end if;
    if not exists (
      select 1 from public.brief_reviews r
      where r.brief_id = old.id and r.state = 'succeeded' and r.brief_version = old.version
    ) then
      raise exception 'a review of the current text is required' using errcode = 'BRF03';
    end if;
    new.submitted_by := caller;
    new.submitted_at := now();
    new.decided_by := null;
    new.decided_at := null;
    new.decision_comment := null;
    return new;
  end if;

  if old.status = 'in_review' and new.status in ('approved', 'changes_requested') then
    if caller_role is distinct from 'approver' and caller_role is distinct from 'admin' then
      raise exception 'only approvers and admins decide' using errcode = '42501';
    end if;
    -- Null-safe: an unknown submitter must never read as "someone else".
    if old.submitted_by is null or caller is not distinct from old.submitted_by then
      raise exception 'nobody approves their own submission' using errcode = 'BRF02';
    end if;
    if new.status = 'changes_requested' and coalesce(btrim(new.decision_comment), '') = '' then
      raise exception 'say what needs to change' using errcode = 'BRF05';
    end if;
    new.decided_by := caller;
    new.decided_at := now();
    new.decision_comment := nullif(btrim(new.decision_comment), '');
    return new;
  end if;

  raise exception 'invalid status change' using errcode = 'BRF04';
end;
$$;
revoke execute on function private.briefs_workflow() from public, anon, authenticated;

-- Runs after briefs_touch (triggers fire in name order), so it sees the version the text change produced.
create trigger briefs_workflow
  before update on public.briefs
  for each row execute function private.briefs_workflow();
