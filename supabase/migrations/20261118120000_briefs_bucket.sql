-- Private bucket for uploaded brief originals, protected by Storage RLS on the caller's own Okta token.
-- Path: workspaces/{workspace_id}/briefs/{brief_id}/original. foldername(name) = {workspaces, ws, briefs, brief}.
-- Text comparisons only: never cast a path segment (a junk path must not error) and never use owner_id or
-- auth.uid() (Okta's sub is an email).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'briefs',
  'briefs',
  false,
  10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

create policy briefs_objects_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'briefs'
    and (storage.foldername(name))[2] in (select ws::text from private.member_workspace_ids() ws)
  );

create policy briefs_objects_insert_writer on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'briefs'
    and array_length(storage.foldername(name), 1) = 4
    and (storage.foldername(name))[1] = 'workspaces'
    and (storage.foldername(name))[3] = 'briefs'
    and storage.filename(name) = 'original'
    and (storage.foldername(name))[2] in (select ws::text from private.workspace_ids_with_role(array['editor', 'admin']) ws)
  );

-- Admins clean up after deleting a brief. Editors may only remove an original whose brief row was never created:
-- the API's compensation when the upload succeeded but saving the brief failed.
create policy briefs_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'briefs'
    and (
      (storage.foldername(name))[2] in (select ws::text from private.workspace_ids_with_role(array['admin']) ws)
      or (
        (storage.foldername(name))[2] in (select ws::text from private.workspace_ids_with_role(array['editor', 'admin']) ws)
        and not exists (select 1 from public.briefs b where b.id::text = (storage.foldername(name))[4])
      )
    )
  );

-- No update policy: originals are immutable.
