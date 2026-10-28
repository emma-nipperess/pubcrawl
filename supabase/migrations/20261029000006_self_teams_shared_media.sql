-- =============================================================================
-- 1. Players can create and pick their own teams by default.
-- 2. Everyone in a crawl can see everyone's photos/videos (approved AND
--    awaiting review) unless the organiser switches sharing off or hides an
--    item. Rejected/withdrawn media stays private to its uploader + organisers.
-- =============================================================================

alter table public.events alter column allow_self_teams set default true;

-- create_event: same as before, but player-made teams default to on.
create or replace function public.create_event(p_event jsonb, p_venues jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r public.events;
  v_id uuid;
begin
  if (select count(*) from public.events where owner_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have created a lot of events today. Please try again tomorrow.' using errcode = '54000';
  end if;
  r := jsonb_populate_record(null::public.events, p_event);
  insert into public.events (
    owner_id, name, description, event_date, start_time, end_time, timezone, start_location, meeting_instructions,
    theme_key, theme_custom, organiser_name, capacity, visibility, require_code, allow_late_join, join_open,
    play_mode, team_selection, allow_self_teams, team_max_size, allow_skip, skip_policy, skip_penalty,
    allow_any_venue, challenges_visible_early, default_requires_approval, show_others_submissions,
    leaderboard_visible, provisional_scoring, allow_partial_points, tie_break, media_retention_days
  ) values (
    v_uid, btrim(r.name), nullif(btrim(coalesce(r.description, '')), ''), r.event_date, r.start_time, r.end_time,
    coalesce(r.timezone, 'Europe/London'), nullif(btrim(coalesce(r.start_location, '')), ''),
    nullif(btrim(coalesce(r.meeting_instructions, '')), ''),
    coalesce(r.theme_key, 'classic'), coalesce(r.theme_custom, '{}'::jsonb), btrim(coalesce(r.organiser_name, 'Organiser')),
    r.capacity, coalesce(r.visibility, 'private'), coalesce(r.require_code, true), coalesce(r.allow_late_join, true),
    coalesce(r.join_open, true), coalesce(r.play_mode, 'team'), coalesce(r.team_selection, 'organiser'),
    coalesce(r.allow_self_teams, true), r.team_max_size, coalesce(r.allow_skip, true), coalesce(r.skip_policy, 'none'),
    coalesce(r.skip_penalty, 0), coalesce(r.allow_any_venue, false), coalesce(r.challenges_visible_early, false),
    coalesce(r.default_requires_approval, false), coalesce(r.show_others_submissions, true),
    coalesce(r.leaderboard_visible, true), coalesce(r.provisional_scoring, false), coalesce(r.allow_partial_points, false),
    coalesce(r.tie_break, 'shared'), coalesce(r.media_retention_days, 30)
  ) returning id into v_id;

  insert into public.event_members (event_id, user_id, role, display_name, is_player)
  values (v_id, v_uid, 'organiser', btrim(coalesce(r.organiser_name, 'Organiser')), coalesce((p_event ->> 'organiser_plays')::boolean, false));

  insert into public.event_invites (event_id, code) values (v_id, private.new_invite_code());
  perform private.seed_achievements(v_id);
  perform private.insert_venues(v_id, p_venues);

  if jsonb_typeof(p_event -> 'team_names') = 'array' then
    insert into public.teams (event_id, name, color, icon, created_by)
    select v_id, btrim(t ->> 'name'), coalesce(t ->> 'color', '#2F6F5E'), coalesce(t ->> 'icon', 'flag'), v_uid
    from jsonb_array_elements(p_event -> 'team_names') t
    where btrim(coalesce(t ->> 'name', '')) <> ''
    on conflict do nothing;
  end if;

  perform private.audit(v_id, 'event.created');
  return v_id;
end;
$$;


-- Self-service team choice is allowed when the event uses self-selection OR
-- lets players create their own teams.
create or replace function public.choose_team(p_event_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  v_member uuid;
begin
  perform private.require_uid();
  select * into e from public.events where id = p_event_id for update;
  v_member := private.my_member_id(p_event_id);
  if v_member is null then raise exception 'Join the event first' using errcode = '42501'; end if;
  if e.play_mode = 'individual' then
    raise exception 'This crawl is played individually' using errcode = '42501';
  end if;
  if e.teams_locked then
    raise exception 'Teams are locked by the organiser' using errcode = '42501';
  end if;
  if e.team_selection <> 'self' and not e.allow_self_teams then
    raise exception 'Teams are assigned by the organiser for this event' using errcode = '42501';
  end if;
  if e.status in ('completed', 'archived', 'cancelled') then
    raise exception 'This crawl is over' using errcode = '55000';
  end if;
  perform private.assign_team(v_member, p_team_id, true);
  perform private.audit(p_event_id, 'team.chosen', jsonb_build_object('member_id', v_member, 'team_id', p_team_id));
end;
$$;

create or replace function private.can_view_submission(p_event uuid, p_member uuid, p_team uuid, p_status text, p_hidden boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organiser(p_event) or (
    private.is_member(p_event) and (
      exists (select 1 from public.event_members m where m.id = p_member and m.user_id = auth.uid())
      or (p_team is not null and p_team = private.current_team(private.my_member_id(p_event)) and not p_hidden)
      or (p_status in ('approved', 'pending') and not p_hidden and exists (
            select 1 from public.events e where e.id = p_event and e.show_others_submissions))
    )
  );
$$;

-- Everything the caller may see in one list (used by the gallery and
-- "download all"). RLS-equivalent filtering, no media from other events.
create or replace function public.list_event_media(p_event_id uuid, p_limit integer default 1000, p_offset integer default 0)
returns table (
  media_id uuid,
  submission_id uuid,
  object_path text,
  thumb_path text,
  kind text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  created_at timestamptz,
  status text,
  member_name text,
  team_name text,
  challenge_title text,
  venue_name text,
  caption text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not (private.is_member(p_event_id) or private.is_organiser(p_event_id)) then
    raise exception 'Join the event to see its photos' using errcode = '42501';
  end if;
  return query
    select sm.id, s.id, sm.object_path, sm.thumb_path, sm.kind, sm.mime_type, sm.size_bytes, sm.width, sm.height, sm.created_at,
           s.status, m.display_name, t.name, c.title, v.name, s.caption
    from public.submission_media sm
    join public.challenge_submissions s on s.id = sm.submission_id
    join public.event_members m on m.id = s.member_id
    left join public.teams t on t.id = s.team_id
    join public.challenges c on c.id = s.challenge_id
    left join public.venues v on v.id = s.venue_id
    where sm.event_id = p_event_id
      and private.can_view_submission(s.event_id, s.member_id, s.team_id, s.status, s.hidden)
    order by sm.created_at desc, sm.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_event_media(uuid, integer, integer) from public, anon;
grant execute on function public.list_event_media(uuid, integer, integer) to authenticated;
