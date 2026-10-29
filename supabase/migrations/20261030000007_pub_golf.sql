-- =============================================================================
-- Game modes: 'crawl' (points, highest wins — unchanged) and 'golf'
-- (strokes per hole against par, lowest "to par" wins).
--
-- Golf scoring
--   * each hole = a non-disabled venue; par = venues.par or events.golf_default_par
--   * players record strokes (sips to finish the hole's drink; any drink counts,
--     including soft drinks/water — no timing) once per hole, capped at
--     par + golf_max_over (the "pick-up" rule)
--   * a finished hole with no score counts as par + golf_max_over, unless
--     skip_policy = 'none' (then it simply isn't counted) or the player joined
--     after it (late joiners are compared on holes they actually played)
--   * challenges still write to the score ledger; in golf every ledger point
--     takes one stroke off (penalties add strokes)
--   * to_par = strokes - par of holes counted - ledger points; lowest wins
--   * team score = average to_par of members who have played, minus team-only
--     challenge credits
-- =============================================================================

alter table public.events
  add column game_mode text not null default 'crawl' check (game_mode in ('crawl', 'golf')),
  add column golf_default_par integer not null default 3 check (golf_default_par between 1 and 20),
  add column golf_max_over integer not null default 3 check (golf_max_over between 1 and 20);

alter table public.venues
  add column drink text check (drink is null or char_length(drink) <= 120);

-- par now means strokes (small numbers); keep it sane
update public.venues set par = null where par > 20;
alter table public.venues drop constraint if exists venues_par_check;
alter table public.venues add constraint venues_par_check check (par is null or par between 1 and 20);

grant update (game_mode, golf_default_par, golf_max_over) on public.events to authenticated;
grant update (drink) on public.venues to authenticated;

create table public.golf_scores (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  venue_id     uuid not null references public.venues (id) on delete cascade,
  member_id    uuid not null references public.event_members (id) on delete cascade,
  strokes      integer not null check (strokes between 1 and 40),
  recorded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (venue_id, member_id)
);
create index golf_scores_event_idx on public.golf_scores (event_id, member_id);
create trigger golf_scores_updated_at before update on public.golf_scores
  for each row execute function public.set_updated_at();

alter table public.golf_scores enable row level security;
grant select on public.golf_scores to authenticated;
-- same visibility as points: own, team, or everyone when the board is public
create policy golf_scores_select on public.golf_scores for select to authenticated
  using (private.can_view_ledger(event_id, member_id, null));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'golf_scores') then
    alter publication supabase_realtime add table public.golf_scores;
  end if;
end;
$$;

-- create_event / duplicate_event / venue helpers: unchanged apart from the new columns.
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
    leaderboard_visible, provisional_scoring, allow_partial_points, tie_break, media_retention_days,
    game_mode, golf_default_par, golf_max_over
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
    coalesce(r.tie_break, 'shared'), coalesce(r.media_retention_days, 30),
    coalesce(r.game_mode, 'crawl'), coalesce(r.golf_default_par, 3), coalesce(r.golf_max_over, 3)
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

create or replace function private.insert_venues(p_event uuid, p_venues jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  c jsonb;
  v_id uuid;
  v_pos int;
  ci int;
begin
  if p_venues is null or jsonb_typeof(p_venues) <> 'array' then
    return;
  end if;
  if jsonb_array_length(p_venues) > 40 then
    raise exception 'Up to 40 venues per event' using errcode = '22023';
  end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.venues where event_id = p_event;
  for v in select * from jsonb_array_elements(p_venues) loop
    insert into public.venues (
      event_id, position, name, address, maps_url, latitude, longitude, description, meeting_instructions,
      arrive_at, depart_at, duration_minutes, accent_color, par, bonus_points, time_limit_minutes, drink
    ) values (
      p_event, v_pos, btrim(v ->> 'name'),
      nullif(btrim(coalesce(v ->> 'address', '')), ''),
      nullif(btrim(coalesce(v ->> 'maps_url', '')), ''),
      nullif(v ->> 'latitude', '')::numeric, nullif(v ->> 'longitude', '')::numeric,
      nullif(btrim(coalesce(v ->> 'description', '')), ''),
      nullif(btrim(coalesce(v ->> 'meeting_instructions', '')), ''),
      nullif(v ->> 'arrive_at', '')::time, nullif(v ->> 'depart_at', '')::time,
      nullif(v ->> 'duration_minutes', '')::int,
      nullif(v ->> 'accent_color', ''),
      nullif(v ->> 'par', '')::int,
      coalesce(nullif(v ->> 'bonus_points', '')::int, 0),
      nullif(v ->> 'time_limit_minutes', '')::int,
      left(nullif(btrim(coalesce(v ->> 'drink', '')), ''), 120)
    ) returning id into v_id;
    if nullif(btrim(coalesce(v ->> 'organiser_notes', '')), '') is not null then
      insert into public.venue_organiser_notes (venue_id, event_id, notes) values (v_id, p_event, btrim(v ->> 'organiser_notes'));
    end if;
    ci := 0;
    if jsonb_typeof(v -> 'challenges') = 'array' then
      for c in select * from jsonb_array_elements(v -> 'challenges') loop
        perform private.upsert_challenge(p_event, v_id, c - 'id', ci);
        ci := ci + 1;
      end loop;
    end if;
    v_pos := v_pos + 1;
    return next v_id;
  end loop;
end;
$$;

create or replace function public.duplicate_venue(p_venue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  v_new uuid;
  c public.challenges;
  v_new_c uuid;
begin
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(v.event_id);
  perform 1 from public.events where id = v.event_id for update;
  if (select count(*) from public.venues where event_id = v.event_id) >= 40 then
    raise exception 'Up to 40 venues per event' using errcode = '22023';
  end if;
  insert into public.venues (event_id, position, name, address, maps_url, latitude, longitude, description,
    meeting_instructions, arrive_at, depart_at, duration_minutes, accent_color, image_path, par, bonus_points, time_limit_minutes, drink)
  select v.event_id, (select max(position) + 1 from public.venues where event_id = v.event_id), left(v.name || ' (copy)', 80),
    v.address, v.maps_url, v.latitude, v.longitude, v.description, v.meeting_instructions, v.arrive_at, v.depart_at,
    v.duration_minutes, v.accent_color, v.image_path, v.par, v.bonus_points, v.time_limit_minutes, v.drink
  returning id into v_new;
  insert into public.venue_organiser_notes (venue_id, event_id, notes)
    select v_new, n.event_id, n.notes from public.venue_organiser_notes n where n.venue_id = p_venue_id;
  for c in select * from public.challenges where venue_id = p_venue_id and not archived order by position loop
    insert into public.challenges (event_id, venue_id, position, title, description, type, scope, required, points,
      bonus_points, time_limit_minutes, proof_media, media_required, text_prompt, text_required, choices,
      requires_approval, max_attempts, repeatable, all_members_required, reveal, reveal_at, penalty_points,
      team_award_mode, rules, safety_notes)
    values (c.event_id, v_new, c.position, c.title, c.description, c.type, c.scope, c.required, c.points,
      c.bonus_points, c.time_limit_minutes, c.proof_media, c.media_required, c.text_prompt, c.text_required, c.choices,
      c.requires_approval, c.max_attempts, c.repeatable, c.all_members_required, c.reveal, c.reveal_at, c.penalty_points,
      c.team_award_mode, c.rules, c.safety_notes)
    returning id into v_new_c;
    insert into public.challenge_answers (challenge_id, event_id, correct_choice, accepted_answers)
      select v_new_c, a.event_id, a.correct_choice, a.accepted_answers from public.challenge_answers a where a.challenge_id = c.id;
  end loop;
  return v_new;
end;
$$;

create or replace function public.duplicate_event(p_event_id uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  e public.events;
  v_new uuid;
  v public.venues;
  v_new_venue uuid;
  c public.challenges;
  v_new_c uuid;
begin
  perform private.require_organiser(p_event_id);
  select * into e from public.events where id = p_event_id;
  insert into public.events (owner_id, name, description, event_date, start_time, end_time, timezone, start_location,
    meeting_instructions, theme_key, theme_custom, cover_path, organiser_name, capacity, visibility, require_code,
    allow_late_join, join_open, play_mode, team_selection, allow_self_teams, team_max_size, allow_skip, skip_policy,
    skip_penalty, allow_any_venue, challenges_visible_early, default_requires_approval, show_others_submissions,
    leaderboard_visible, provisional_scoring, allow_partial_points, tie_break, media_retention_days,
    game_mode, golf_default_par, golf_max_over)
  values (v_uid, left(coalesce(nullif(btrim(p_name), ''), e.name || ' (copy)'), 80), e.description, null, e.start_time,
    e.end_time, e.timezone, e.start_location, e.meeting_instructions, e.theme_key, e.theme_custom, null,
    e.organiser_name, e.capacity, e.visibility, e.require_code, e.allow_late_join, true, e.play_mode, e.team_selection,
    e.allow_self_teams, e.team_max_size, e.allow_skip, e.skip_policy, e.skip_penalty, e.allow_any_venue,
    e.challenges_visible_early, e.default_requires_approval, e.show_others_submissions, e.leaderboard_visible,
    e.provisional_scoring, e.allow_partial_points, e.tie_break, e.media_retention_days,
    e.game_mode, e.golf_default_par, e.golf_max_over)
  returning id into v_new;

  insert into public.event_members (event_id, user_id, role, display_name, is_player)
    values (v_new, v_uid, 'organiser', e.organiser_name, false);
  insert into public.event_invites (event_id, code) values (v_new, private.new_invite_code());
  insert into public.achievement_definitions (event_id, key, title, description, icon, rule, enabled)
    select v_new, key, title, description, icon, rule, enabled from public.achievement_definitions where event_id = p_event_id;
  perform private.seed_achievements(v_new);

  for v in select * from public.venues where event_id = p_event_id order by position loop
    insert into public.venues (event_id, position, name, address, maps_url, latitude, longitude, description,
      meeting_instructions, arrive_at, depart_at, duration_minutes, accent_color, image_path, par, bonus_points,
      time_limit_minutes, disabled, drink)
    values (v_new, v.position, v.name, v.address, v.maps_url, v.latitude, v.longitude, v.description,
      v.meeting_instructions, v.arrive_at, v.depart_at, v.duration_minutes, v.accent_color, null, v.par,
      v.bonus_points, v.time_limit_minutes, v.disabled, v.drink)
    returning id into v_new_venue;
    insert into public.venue_organiser_notes (venue_id, event_id, notes)
      select v_new_venue, v_new, n.notes from public.venue_organiser_notes n where n.venue_id = v.id;
    for c in select * from public.challenges where venue_id = v.id and not archived order by position loop
      v_new_c := private.upsert_challenge(v_new, v_new_venue, (to_jsonb(c) - 'id' - 'event_id' - 'venue_id')
        || coalesce((select jsonb_build_object('correct_choice', a.correct_choice, 'accepted_answers', to_jsonb(a.accepted_answers))
                     from public.challenge_answers a where a.challenge_id = c.id), '{}'::jsonb), c.position);
    end loop;
  end loop;
  for c in select * from public.challenges where event_id = p_event_id and venue_id is null and not archived loop
    perform private.upsert_challenge(v_new, null, (to_jsonb(c) - 'id' - 'event_id' - 'venue_id')
      || coalesce((select jsonb_build_object('correct_choice', a.correct_choice, 'accepted_answers', to_jsonb(a.accepted_answers))
                   from public.challenge_answers a where a.challenge_id = c.id), '{}'::jsonb), c.position);
  end loop;
  perform private.audit(v_new, 'event.duplicated', jsonb_build_object('from', p_event_id));
  return v_new;
end;
$$;

-- Record strokes for a hole. Players: their own score, while the hole is
-- open. Organisers: anyone's score at any started hole (audited).
-- p_strokes = null clears the score.
create or replace function public.record_golf_score(p_venue_id uuid, p_strokes integer, p_member_id uuid default null)
returns public.golf_scores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  e public.events;
  m public.event_members;
  v_org boolean;
  v_par int;
  v_max int;
  r public.golf_scores;
begin
  perform private.require_uid();
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Hole not found' using errcode = 'P0002'; end if;
  select * into e from public.events where id = v.event_id;
  v_org := private.is_organiser(v.event_id);
  if p_member_id is not null and p_member_id <> coalesce(private.my_member_id(v.event_id), '00000000-0000-0000-0000-000000000000'::uuid) and not v_org then
    raise exception 'Only organisers can change someone else''s score' using errcode = '42501';
  end if;
  select * into m from public.event_members
    where id = coalesce(p_member_id, private.my_member_id(v.event_id)) and event_id = v.event_id and status = 'active';
  if m.id is null then raise exception 'Join the event first' using errcode = '42501'; end if;
  if e.game_mode <> 'golf' then raise exception 'This crawl isn''t using pub golf scoring' using errcode = '55000'; end if;
  if v.disabled or v.status = 'skipped' then raise exception 'This hole isn''t being played' using errcode = '55000'; end if;
  v_par := coalesce(v.par, e.golf_default_par);
  v_max := v_par + e.golf_max_over;

  if not v_org then
    if not m.is_player then raise exception 'You are not playing in this event' using errcode = '42501'; end if;
    if e.status <> 'in_progress' then
      raise exception '%', case when e.status = 'paused' then 'The crawl is paused — hang tight' else 'Scores open when the crawl starts' end using errcode = '55000';
    end if;
    if not (v.status = 'active' or (e.allow_any_venue and v.status = 'completed')) then
      raise exception 'This hole is closed — ask the organiser to fix your score' using errcode = '55000';
    end if;
    if exists (select 1 from public.venue_participation p where p.venue_id = v.id and p.member_id = m.id and p.status = 'skipped') then
      raise exception 'You skipped this hole. Rejoin it first.' using errcode = '55000';
    end if;
  elsif v.status = 'upcoming' and e.status not in ('completed', 'archived') then
    raise exception 'That hole hasn''t started yet' using errcode = '55000';
  end if;

  if p_strokes is null then
    delete from public.golf_scores where venue_id = v.id and member_id = m.id;
    perform private.audit(v.event_id, 'golf.cleared', jsonb_build_object('venue_id', v.id, 'member_id', m.id));
    return null;
  end if;
  if p_strokes < 1 or p_strokes > v_max then
    raise exception 'Strokes must be between 1 and % (par % + % max)', v_max, v_par, e.golf_max_over using errcode = '22023';
  end if;

  insert into public.golf_scores (event_id, venue_id, member_id, strokes, recorded_by)
  values (v.event_id, v.id, m.id, p_strokes, auth.uid())
  on conflict (venue_id, member_id) do update set strokes = excluded.strokes, recorded_by = excluded.recorded_by
  returning * into r;
  insert into public.venue_participation (event_id, venue_id, member_id, team_id, status)
  values (v.event_id, v.id, m.id, private.current_team(m.id), 'present')
  on conflict (venue_id, member_id) do nothing;
  if v_org and m.user_id <> auth.uid() then
    perform private.audit(v.event_id, 'golf.set_by_organiser', jsonb_build_object('venue_id', v.id, 'member_id', m.id, 'strokes', p_strokes));
  end if;
  return r;
end;
$$;

-- Per-member golf card (rows for every counted/upcoming hole). Internal.
create or replace function private.golf_card(p_event uuid)
returns table (member_id uuid, venue_id uuid, par integer, strokes integer, counted boolean, recorded boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, v.id, coalesce(v.par, e.golf_default_par),
    case when gs.id is not null then gs.strokes
         when v.status = 'completed' and not (m.joined_late and m.joined_venue_position is not null and v.position < m.joined_venue_position)
              and e.skip_policy <> 'none' then coalesce(v.par, e.golf_default_par) + e.golf_max_over
    end,
    gs.id is not null
      or (v.status = 'completed' and not (m.joined_late and m.joined_venue_position is not null and v.position < m.joined_venue_position)
          and e.skip_policy <> 'none'),
    gs.id is not null
  from public.events e
  join public.event_members m on m.event_id = e.id and m.status = 'active' and m.is_player
  join public.venues v on v.event_id = e.id and not v.disabled and v.status <> 'skipped'
  left join public.golf_scores gs on gs.venue_id = v.id and gs.member_id = m.id
  where e.id = p_event;
$$;


-- One row per active player with their golf totals. Internal.
create or replace function private.golf_people(p_event uuid)
returns table (member_id uuid, name text, avatar_color text, avatar_icon text, team_id uuid,
  strokes int, par int, thru int, adj int, pending int, to_par int, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.display_name, m.avatar_color, m.avatar_icon, private.current_team(m.id),
    coalesce(c.strokes, 0), coalesce(c.par, 0), coalesce(c.thru, 0),
    coalesce(l.confirmed, 0) + case when e.provisional_scoring then coalesce(l.pending, 0) else 0 end,
    coalesce(l.pending, 0),
    case when coalesce(c.thru, 0) = 0 and coalesce(l.confirmed, 0) = 0 then null
         else coalesce(c.strokes, 0) - coalesce(c.par, 0) - coalesce(l.confirmed, 0)
              - case when e.provisional_scoring then coalesce(l.pending, 0) else 0 end end,
    c.last_at
  from public.events e
  join public.event_members m on m.event_id = e.id and m.status = 'active' and m.is_player
  left join lateral (
    select sum(gc.strokes)::int as strokes, sum(gc.par)::int as par, count(*)::int as thru,
      (select max(gs.updated_at) from public.golf_scores gs where gs.member_id = m.id) as last_at
    from private.golf_card(p_event) gc where gc.member_id = m.id and gc.counted
  ) c on true
  left join lateral (
    select sum(points) filter (where not provisional)::int as confirmed, sum(points) filter (where provisional)::int as pending
    from public.score_ledger sl where sl.event_id = p_event and sl.member_id = m.id
  ) l on true
  where e.id = p_event;
$$;

create or replace function public.get_golf_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.events;
  v_org boolean;
  v_me uuid;
  v_my_team uuid;
  v_people jsonb;
  v_teams jsonb;
begin
  perform private.require_uid();
  if not (private.is_member(p_event_id) or private.is_organiser(p_event_id)) then
    raise exception 'Join the event to see its leaderboard' using errcode = '42501';
  end if;
  select * into e from public.events where id = p_event_id;
  v_org := private.is_organiser(p_event_id);
  v_me := private.my_member_id(p_event_id);
  v_my_team := private.current_team(v_me);
  if e.status in ('completed', 'archived') then e.leaderboard_visible := true; end if;

  with ranked as (
    select g.*, case when g.to_par is null then null else case e.tie_break
      when 'most_completed' then rank() over (partition by g.to_par is null order by g.to_par asc, g.thru desc)
      when 'earliest' then rank() over (partition by g.to_par is null order by g.to_par asc, g.last_at asc nulls last)
      else rank() over (partition by g.to_par is null order by g.to_par asc) end end as rank
    from private.golf_people(p_event_id) g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', r.member_id, 'name', r.name, 'avatar_color', r.avatar_color, 'avatar_icon', r.avatar_icon, 'team_id', r.team_id,
      'strokes', r.strokes, 'par', r.par, 'thru', r.thru, 'adjustment', r.adj, 'pending', r.pending, 'to_par', r.to_par, 'rank', r.rank,
      'tied', r.rank is not null and (select count(*) from ranked r2 where r2.rank = r.rank) > 1, 'is_me', r.member_id = v_me
    ) order by r.rank nulls last, r.name, r.member_id), '[]'::jsonb)
  into v_people
  from ranked r
  where v_org or e.leaderboard_visible or r.member_id = v_me;

  with t as (
    select tm.id, tm.name, tm.color, tm.icon,
      (select count(*) from public.team_members x join public.event_members em on em.id = x.member_id
         where x.team_id = tm.id and x.left_at is null and em.status = 'active')::int as size,
      (select round(avg(g.to_par)::numeric, 1) from private.golf_people(p_event_id) g where g.team_id = tm.id and g.to_par is not null) as avg_to_par,
      (select coalesce(sum(points), 0)::int from public.score_ledger sl
         where sl.team_id = tm.id and sl.member_id is null and (not sl.provisional or e.provisional_scoring)) as team_adj,
      (select coalesce(sum(g.thru), 0)::int from private.golf_people(p_event_id) g where g.team_id = tm.id) as thru
    from public.teams tm where tm.event_id = p_event_id
  ),
  s as (
    select t.*, case when t.avg_to_par is null and t.team_adj = 0 then null else coalesce(t.avg_to_par, 0) - t.team_adj end as to_par from t
  ),
  ranked as (
    select s.*, case when s.to_par is null then null else rank() over (partition by s.to_par is null order by s.to_par asc) end as rank from s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.id, 'name', r.name, 'color', r.color, 'icon', r.icon, 'size', r.size, 'thru', r.thru,
      'to_par', r.to_par, 'adjustment', r.team_adj, 'rank', r.rank,
      'tied', r.rank is not null and (select count(*) from ranked r2 where r2.rank = r.rank) > 1, 'is_mine', r.id = v_my_team
    ) order by r.rank nulls last, r.name, r.id), '[]'::jsonb)
  into v_teams
  from ranked r
  where e.play_mode <> 'individual' and (v_org or e.leaderboard_visible or r.id = v_my_team);

  return jsonb_build_object('visible', v_org or e.leaderboard_visible, 'provisional_scoring', e.provisional_scoring,
    'tie_break', e.tie_break, 'max_over', e.golf_max_over, 'individuals', v_people, 'teams', v_teams);
end;
$$;

revoke all on function public.record_golf_score(uuid, integer, uuid), public.get_golf_leaderboard(uuid), private.golf_card(uuid), private.golf_people(uuid) from public, anon;
grant execute on function public.record_golf_score(uuid, integer, uuid), public.get_golf_leaderboard(uuid) to authenticated;
