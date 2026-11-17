-- An uploaded brief records its original file. Set once at insert, never updated (no update grant):
-- the object lives at workspaces/{workspace_id}/briefs/{id}/original, derived in the API, never stored.

alter table public.briefs
  add column source_name text check (char_length(source_name) between 1 and 255),
  add column source_mime text check (source_mime in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  add column source_size integer check (source_size between 1 and 10485760),
  add constraint briefs_source_all_or_none check (
    (source_name is null) = (source_mime is null) and (source_mime is null) = (source_size is null)
  );

-- The API chooses the id so the object can be uploaded under the brief's path before the row exists
-- (editors can't delete briefs, so "row first, then file" could leave a brief with a missing original).
grant insert (id, source_name, source_mime, source_size) on public.briefs to authenticated;
