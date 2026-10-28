-- =============================================================================
-- Privacy: media clean-up helpers and self-service account deletion
-- =============================================================================

-- Participants may always delete their own uploads (their photos, their
-- right). Points already awarded are unaffected. Nobody but organisers can
-- delete someone else's media.
create or replace function private.can_delete_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_name, '/', 2) = auth.uid()::text
    or private.is_organiser(private.proof_event(p_name));
$$;

-- Organisers: every proof object stored for an event (to purge media or
-- delete the event). Storage objects must be removed through the Storage API,
-- so the client deletes these paths before deleting the event row.
create or replace function public.event_proof_objects(p_event_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_organiser(p_event_id);
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'proof' and split_part(o.name, '/', 1) = p_event_id::text
    order by o.name;
end;
$$;

create or replace function public.event_asset_objects(p_event_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_organiser(p_event_id);
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'event-assets' and split_part(o.name, '/', 1) = p_event_id::text;
end;
$$;

-- Anyone: the proof files they uploaded, across all events.
create or replace function public.my_proof_objects()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'proof' and split_part(o.name, '/', 2) = auth.uid()::text
  order by o.name;
$$;

-- After media has been removed: delete the media metadata rows for an event
-- (submissions and scores stay, so results remain intact).
create or replace function public.forget_event_media(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  perform private.require_organiser(p_event_id);
  delete from public.submission_media where event_id = p_event_id;
  get diagnostics n = row_count;
  perform private.audit(p_event_id, 'media.purged', jsonb_build_object('rows', n));
  return n;
end;
$$;

-- Self-service deletion of the caller's account and everything attached to it
-- (memberships, submissions, scores, templates). Refuses while the caller
-- still owns events, so other people's data is never deleted as a side effect.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_uid();
begin
  if exists (select 1 from public.events where owner_id = v_uid) then
    raise exception 'Delete the events you organise first (or ask a co-organiser to take over).' using errcode = '55000';
  end if;
  delete from public.score_ledger l using public.event_members m where l.member_id = m.id and m.user_id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.event_proof_objects(uuid), public.event_asset_objects(uuid), public.my_proof_objects(),
  public.forget_event_media(uuid), public.delete_my_account() from public, anon;
grant execute on function public.event_proof_objects(uuid), public.event_asset_objects(uuid), public.my_proof_objects(),
  public.forget_event_media(uuid), public.delete_my_account() to authenticated;
