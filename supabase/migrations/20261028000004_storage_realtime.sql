-- =============================================================================
-- Storage buckets + policies, Realtime publication
-- =============================================================================
-- Buckets
--   proof         PRIVATE. Challenge photos/videos. Path:
--                 {event_id}/{auth.uid()}/{submission_id}/{file}
--                 Read via short-lived signed URLs only.
--   event-assets  PUBLIC. Intentionally public event covers / venue images.
--                 Path: {event_id}/{file}
-- Size and MIME limits are enforced by Storage itself (bucket config below),
-- independent of anything the browser claims.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('proof', 'proof', false, 52428800,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('event-assets', 'event-assets', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.proof_event(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select private.try_uuid(split_part(p_name, '/', 1));
$$;

create or replace function private.can_upload_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_name, '/', 2) = auth.uid()::text
    and private.try_uuid(split_part(p_name, '/', 3)) is not null
    and split_part(p_name, '/', 4) <> ''
    and split_part(p_name, '/', 5) = ''
    and private.is_member(private.proof_event(p_name))
    and exists (select 1 from public.events e where e.id = private.proof_event(p_name) and e.status = 'in_progress')
    -- once a submission exists, its folder is sealed
    and not exists (select 1 from public.challenge_submissions s where s.id = private.try_uuid(split_part(p_name, '/', 3)));
$$;

create or replace function private.can_view_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- your own uploads (needed to preview before the submission is attached)
    (split_part(p_name, '/', 2) = auth.uid()::text and private.is_member(private.proof_event(p_name)))
    or private.is_organiser(private.proof_event(p_name))
    or exists (
      select 1 from public.submission_media sm
      join public.challenge_submissions s on s.id = sm.submission_id
      where (sm.object_path = p_name or sm.thumb_path = p_name)
        and private.can_view_submission(s.event_id, s.member_id, s.team_id, s.status, s.hidden)
    );
$$;

create or replace function private.can_delete_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organiser(private.proof_event(p_name))
    or (
      split_part(p_name, '/', 2) = auth.uid()::text
      -- participants may tidy up unattached uploads or withdraw/rejected proof,
      -- never media that is backing an approved or pending score
      and not exists (
        select 1 from public.submission_media sm
        join public.challenge_submissions s on s.id = sm.submission_id
        where (sm.object_path = p_name or sm.thumb_path = p_name) and s.status in ('approved', 'pending')
      )
    );
$$;

create or replace function private.can_manage_assets(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organiser(private.proof_event(p_name));
$$;

revoke all on function private.proof_event(text), private.can_upload_proof(text), private.can_view_proof(text),
  private.can_delete_proof(text), private.can_manage_assets(text) from public, anon;
grant execute on function private.proof_event(text), private.can_upload_proof(text), private.can_view_proof(text),
  private.can_delete_proof(text), private.can_manage_assets(text) to authenticated;

drop policy if exists "proof: members upload own" on storage.objects;
drop policy if exists "proof: authorised read" on storage.objects;
drop policy if exists "proof: owner or organiser delete" on storage.objects;
drop policy if exists "assets: organiser upload" on storage.objects;
drop policy if exists "assets: organiser update" on storage.objects;
drop policy if exists "assets: organiser delete" on storage.objects;

create policy "proof: members upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'proof' and private.can_upload_proof(name));
create policy "proof: authorised read" on storage.objects for select to authenticated
  using (bucket_id = 'proof' and private.can_view_proof(name));
create policy "proof: owner or organiser delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proof' and private.can_delete_proof(name));
-- no UPDATE policy on proof: files cannot be overwritten (upsert) once uploaded

create policy "assets: organiser upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-assets' and private.can_manage_assets(name));
create policy "assets: organiser update" on storage.objects for update to authenticated
  using (bucket_id = 'event-assets' and private.can_manage_assets(name))
  with check (bucket_id = 'event-assets' and private.can_manage_assets(name));
create policy "assets: organiser delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-assets' and private.can_manage_assets(name));

-- -----------------------------------------------------------------------------
-- Realtime: Postgres Changes respect RLS, so clients only receive rows they
-- are allowed to select. Clients treat events as "something changed" signals
-- and refetch authoritative state.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['events', 'event_members', 'venues', 'teams', 'team_members', 'challenges',
                           'challenge_submissions', 'venue_participation', 'score_ledger',
                           'event_announcements', 'member_achievements'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
