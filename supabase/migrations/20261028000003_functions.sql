-- =============================================================================
-- Trusted game logic (RPCs)
-- =============================================================================
-- Every public function below is SECURITY DEFINER with search_path = '' and
-- performs its own authorisation check against auth.uid(). Clients can only
-- mutate scores, statuses, memberships and submissions through these.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- small internal helpers
-- -----------------------------------------------------------------------------
create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  return v;
end;
$$;

create or replace function private.require_organiser(p_event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not private.is_organiser(p_event) then
    raise exception 'Only organisers can do that' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.audit(p_event uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_audit_log (event_id, actor_id, action, detail) values (p_event, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;

-- 8 characters from a 32-symbol alphabet (no 0/O/1/I), taken from the random
-- bytes of gen_random_uuid() (bytes 6 and 8 carry version/variant bits).
create or replace function private.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  idx int[] := array[0, 1, 2, 3, 4, 5, 7, 9];
  v_code text;
  i int;
begin
  loop
    b := uuid_send(gen_random_uuid());
    v_code := '';
    foreach i in array idx loop
      v_code := v_code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.event_invites ei where ei.code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function private.normalise_code(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.event_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'published'), ('draft', 'cancelled'),
    ('published', 'draft'), ('published', 'in_progress'), ('published', 'cancelled'),
    ('in_progress', 'paused'), ('in_progress', 'completed'), ('in_progress', 'cancelled'),
    ('paused', 'in_progress'), ('paused', 'completed'), ('paused', 'cancelled'),
    ('completed', 'archived'), ('cancelled', 'archived')
  );
$$;

-- -----------------------------------------------------------------------------
-- challenge upsert (shared by create_event, save_challenge, duplication)
-- -----------------------------------------------------------------------------
create or replace function private.upsert_challenge(p_event uuid, p_venue uuid, c jsonb, p_position int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(c ->> 'id');
  v_type text := coalesce(nullif(c ->> 'type', ''), 'checkbox');
  v_existing public.challenges;
  v_has_subs boolean := false;
  v_default_approval boolean;
  v_proof text;
  v_scope text;
  v_choices jsonb := case when jsonb_typeof(c -> 'choices') = 'array' then c -> 'choices' else null end;
  v_correct int := nullif(c ->> 'correct_choice', '')::int;
  v_accepted text[];
begin
  if v_type not in ('photo', 'video', 'photo_or_video', 'text', 'multiple_choice', 'checkbox', 'team', 'bonus', 'verified', 'custom') then
    raise exception 'Unknown challenge type %', v_type using errcode = '22023';
  end if;
  select e.default_requires_approval into v_default_approval from public.events e where e.id = p_event;

  v_proof := case v_type
    when 'photo' then 'photo'
    when 'video' then 'video'
    when 'photo_or_video' then 'either'
    else coalesce(nullif(c ->> 'proof_media', ''), 'none') end;
  v_scope := case when v_type = 'team' then 'team' else coalesce(nullif(c ->> 'scope', ''), 'individual') end;

  if v_type = 'multiple_choice' then
    if v_choices is null or jsonb_array_length(v_choices) < 2 then
      raise exception 'Multiple-choice questions need at least two options' using errcode = '22023';
    end if;
    if v_correct is not null and (v_correct < 0 or v_correct >= jsonb_array_length(v_choices)) then
      raise exception 'The correct answer must be one of the options' using errcode = '22023';
    end if;
  else
    v_choices := null;
    v_correct := null;
  end if;

  if jsonb_typeof(c -> 'accepted_answers') = 'array' then
    select array_agg(lower(btrim(x))) filter (where btrim(x) <> '')
      into v_accepted from jsonb_array_elements_text(c -> 'accepted_answers') x;
  end if;

  if v_id is not null then
    select * into v_existing from public.challenges where id = v_id and event_id = p_event for update;
  end if;

  if v_existing.id is not null then
    select exists (select 1 from public.challenge_submissions s where s.challenge_id = v_existing.id) into v_has_subs;
    if v_has_subs and (v_existing.scope <> v_scope or v_existing.type <> v_type) then
      raise exception 'This challenge already has submissions, so its type and team/individual setting are locked. Archive it and create a new one instead.'
        using errcode = '55000';
    end if;
    update public.challenges set
      venue_id = p_venue,
      position = coalesce(p_position, nullif(c ->> 'position', '')::int, position),
      title = btrim(c ->> 'title'),
      description = nullif(btrim(coalesce(c ->> 'description', '')), ''),
      type = v_type,
      scope = v_scope,
      required = case when v_type = 'bonus' then false else coalesce((c ->> 'required')::boolean, true) end,
      points = coalesce((c ->> 'points')::int, 10),
      bonus_points = coalesce((c ->> 'bonus_points')::int, 0),
      time_limit_minutes = nullif(c ->> 'time_limit_minutes', '')::int,
      proof_media = v_proof,
      media_required = v_proof <> 'none' and (v_type in ('photo', 'video', 'photo_or_video') or coalesce((c ->> 'media_required')::boolean, false)),
      text_prompt = nullif(btrim(coalesce(c ->> 'text_prompt', '')), ''),
      text_required = v_type = 'text' or coalesce((c ->> 'text_required')::boolean, false),
      choices = v_choices,
      requires_approval = v_type = 'verified' or coalesce((c ->> 'requires_approval')::boolean, v_default_approval),
      max_attempts = coalesce((c ->> 'max_attempts')::int, 1),
      repeatable = coalesce((c ->> 'repeatable')::boolean, false),
      all_members_required = coalesce((c ->> 'all_members_required')::boolean, false),
      reveal = coalesce(nullif(c ->> 'reveal', ''), 'with_venue'),
      reveal_at = nullif(c ->> 'reveal_at', '')::timestamptz,
      penalty_points = coalesce((c ->> 'penalty_points')::int, 0),
      team_award_mode = coalesce(nullif(c ->> 'team_award_mode', ''), 'team_only'),
      rules = nullif(btrim(coalesce(c ->> 'rules', '')), ''),
      safety_notes = nullif(btrim(coalesce(c ->> 'safety_notes', '')), ''),
      archived = coalesce((c ->> 'archived')::boolean, archived)
    where id = v_existing.id;
    v_id := v_existing.id;
  else
    insert into public.challenges (
      event_id, venue_id, position, title, description, type, scope, required, points, bonus_points,
      time_limit_minutes, proof_media, media_required, text_prompt, text_required, choices, requires_approval,
      max_attempts, repeatable, all_members_required, reveal, reveal_at, penalty_points, team_award_mode,
      rules, safety_notes
    ) values (
      p_event, p_venue,
      coalesce(p_position, nullif(c ->> 'position', '')::int,
        (select coalesce(max(position) + 1, 0) from public.challenges where event_id = p_event and venue_id is not distinct from p_venue)),
      btrim(c ->> 'title'),
      nullif(btrim(coalesce(c ->> 'description', '')), ''),
      v_type, v_scope,
      case when v_type = 'bonus' then false else coalesce((c ->> 'required')::boolean, true) end,
      coalesce((c ->> 'points')::int, 10),
      coalesce((c ->> 'bonus_points')::int, 0),
      nullif(c ->> 'time_limit_minutes', '')::int,
      v_proof,
      v_proof <> 'none' and (v_type in ('photo', 'video', 'photo_or_video') or coalesce((c ->> 'media_required')::boolean, false)),
      nullif(btrim(coalesce(c ->> 'text_prompt', '')), ''),
      v_type = 'text' or coalesce((c ->> 'text_required')::boolean, false),
      v_choices,
      v_type = 'verified' or coalesce((c ->> 'requires_approval')::boolean, v_default_approval),
      coalesce((c ->> 'max_attempts')::int, 1),
      coalesce((c ->> 'repeatable')::boolean, false),
      coalesce((c ->> 'all_members_required')::boolean, false),
      coalesce(nullif(c ->> 'reveal', ''), 'with_venue'),
      nullif(c ->> 'reveal_at', '')::timestamptz,
      coalesce((c ->> 'penalty_points')::int, 0),
      coalesce(nullif(c ->> 'team_award_mode', ''), 'team_only'),
      nullif(btrim(coalesce(c ->> 'rules', '')), ''),
      nullif(btrim(coalesce(c ->> 'safety_notes', '')), '')
    ) returning id into v_id;
  end if;

  if v_correct is not null or v_accepted is not null then
    insert into public.challenge_answers (challenge_id, event_id, correct_choice, accepted_answers)
    values (v_id, p_event, v_correct, v_accepted)
    on conflict (challenge_id) do update
      set correct_choice = excluded.correct_choice, accepted_answers = excluded.accepted_answers, updated_at = now();
  else
    delete from public.challenge_answers where challenge_id = v_id;
  end if;
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
      arrive_at, depart_at, duration_minutes, accent_color, par, bonus_points, time_limit_minutes
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
      nullif(v ->> 'time_limit_minutes', '')::int
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

create or replace function private.seed_achievements(p_event uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.achievement_definitions (event_id, key, title, description, icon, rule) values
    (p_event, 'first_blood', 'Off the Tee', 'Completed a first challenge', 'flag', 'first_challenge'),
    (p_event, 'perfect_round', 'Perfect Round', 'Finished every required challenge at a venue', 'star', 'perfect_venue'),
    (p_event, 'full_card', 'Full Scorecard', 'Completed every required challenge of the crawl', 'trophy', 'all_required'),
    (p_event, 'team_player', 'Team Player', 'Helped land a team challenge', 'people', 'team_player'),
    (p_event, 'most_creative', 'Most Creative', 'Awarded by the organiser for a standout submission', 'spark', 'manual')
  on conflict (event_id, key) do nothing;
$$;

-- -----------------------------------------------------------------------------
-- Event creation, editing helpers, duplication
-- -----------------------------------------------------------------------------
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
    coalesce(r.allow_self_teams, false), r.team_max_size, coalesce(r.allow_skip, true), coalesce(r.skip_policy, 'none'),
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

create or replace function public.add_venues(p_event_id uuid, p_venues jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_organiser(p_event_id);
  perform 1 from public.events where id = p_event_id for update;
  if (select count(*) from public.venues where event_id = p_event_id) + jsonb_array_length(p_venues) > 40 then
    raise exception 'Up to 40 venues per event' using errcode = '22023';
  end if;
  return query select * from private.insert_venues(p_event_id, p_venues);
end;
$$;

create or replace function public.save_challenge(p_event_id uuid, p_venue_id uuid, p_challenge jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.require_organiser(p_event_id);
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and event_id = p_event_id) then
    raise exception 'Venue not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.challenges where event_id = p_event_id) >= 300 and private.try_uuid(p_challenge ->> 'id') is null then
    raise exception 'Too many challenges in this event' using errcode = '54000';
  end if;
  v_id := private.upsert_challenge(p_event_id, p_venue_id, p_challenge);
  perform private.audit(p_event_id, 'challenge.saved', jsonb_build_object('challenge_id', v_id));
  return v_id;
end;
$$;

create or replace function public.reorder_venues(p_event_id uuid, p_venue_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_organiser(p_event_id);
  perform 1 from public.events where id = p_event_id for update;
  if (select count(*) from public.venues where event_id = p_event_id) <> cardinality(p_venue_ids)
     or exists (select 1 from unnest(p_venue_ids) x(id) left join public.venues v on v.id = x.id and v.event_id = p_event_id where v.id is null) then
    raise exception 'The venue list changed — refresh and try again' using errcode = '40001';
  end if;
  update public.venues v set position = x.ord - 1
  from unnest(p_venue_ids) with ordinality as x(id, ord)
  where v.id = x.id and v.event_id = p_event_id and v.position <> x.ord - 1;
end;
$$;

create or replace function public.reorder_challenges(p_event_id uuid, p_challenge_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_organiser(p_event_id);
  update public.challenges c set position = x.ord - 1
  from unnest(p_challenge_ids) with ordinality as x(id, ord)
  where c.id = x.id and c.event_id = p_event_id;
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
    meeting_instructions, arrive_at, depart_at, duration_minutes, accent_color, image_path, par, bonus_points, time_limit_minutes)
  select v.event_id, (select max(position) + 1 from public.venues where event_id = v.event_id), left(v.name || ' (copy)', 80),
    v.address, v.maps_url, v.latitude, v.longitude, v.description, v.meeting_instructions, v.arrive_at, v.depart_at,
    v.duration_minutes, v.accent_color, v.image_path, v.par, v.bonus_points, v.time_limit_minutes
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
    leaderboard_visible, provisional_scoring, allow_partial_points, tie_break, media_retention_days)
  values (v_uid, left(coalesce(nullif(btrim(p_name), ''), e.name || ' (copy)'), 80), e.description, null, e.start_time,
    e.end_time, e.timezone, e.start_location, e.meeting_instructions, e.theme_key, e.theme_custom, null,
    e.organiser_name, e.capacity, e.visibility, e.require_code, e.allow_late_join, true, e.play_mode, e.team_selection,
    e.allow_self_teams, e.team_max_size, e.allow_skip, e.skip_policy, e.skip_penalty, e.allow_any_venue,
    e.challenges_visible_early, e.default_requires_approval, e.show_others_submissions, e.leaderboard_visible,
    e.provisional_scoring, e.allow_partial_points, e.tie_break, e.media_retention_days)
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
      time_limit_minutes, disabled)
    values (v_new, v.position, v.name, v.address, v.maps_url, v.latitude, v.longitude, v.description,
      v.meeting_instructions, v.arrive_at, v.depart_at, v.duration_minutes, v.accent_color, null, v.par,
      v.bonus_points, v.time_limit_minutes, v.disabled)
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

-- -----------------------------------------------------------------------------
-- Event lifecycle
-- -----------------------------------------------------------------------------
create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  v_first uuid;
begin
  perform private.require_organiser(p_event_id);
  select * into e from public.events where id = p_event_id for update;
  if e.status = p_status then
    return e;
  end if;
  if not public.event_status_transition_allowed(e.status, p_status) then
    raise exception 'An event that is % cannot be changed to %', replace(e.status, '_', ' '), replace(p_status, '_', ' ')
      using errcode = '55000';
  end if;
  if p_status in ('published', 'in_progress') and not exists (select 1 from public.venues where event_id = p_event_id and not disabled) then
    raise exception 'Add at least one venue first' using errcode = '55000';
  end if;
  if e.status = 'published' and p_status = 'draft'
     and exists (select 1 from public.event_members where event_id = p_event_id and role = 'participant' and status = 'active') then
    raise exception 'People have already joined, so the event cannot go back to draft. Close joining instead.' using errcode = '55000';
  end if;

  update public.events set
    status = p_status,
    published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
    started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_event_id;

  if p_status = 'in_progress' and e.current_venue_id is null then
    select id into v_first from public.venues where event_id = p_event_id and not disabled and status = 'upcoming'
      order by position limit 1;
    if v_first is not null then
      update public.venues set status = 'active', activated_at = now() where id = v_first;
      update public.events set current_venue_id = v_first where id = p_event_id;
    end if;
  end if;
  if p_status in ('completed', 'cancelled') then
    update public.venues set status = 'completed', closed_at = now() where event_id = p_event_id and status = 'active';
  end if;

  perform private.audit(p_event_id, 'event.status', jsonb_build_object('from', e.status, 'to', p_status));
  select * into e from public.events where id = p_event_id;
  return e;
end;
$$;

create or replace function public.activate_venue(p_venue_id uuid)
returns public.venues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  e public.events;
begin
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(v.event_id);
  select * into e from public.events where id = v.event_id for update;
  if e.status not in ('in_progress', 'paused') then
    raise exception 'Start the event before moving between venues' using errcode = '55000';
  end if;
  if v.disabled then
    raise exception 'This venue is disabled — enable it first' using errcode = '55000';
  end if;
  update public.venues set status = 'completed', closed_at = now()
    where event_id = v.event_id and status = 'active' and id <> p_venue_id;
  -- moving forward past venues nobody visited marks them as skipped by the group
  update public.venues set status = 'skipped'
    where event_id = v.event_id and status = 'upcoming' and position < v.position;
  update public.venues set status = 'active', activated_at = now(), closed_at = null where id = p_venue_id
    returning * into v;
  update public.events set current_venue_id = p_venue_id where id = v.event_id;
  perform private.audit(v.event_id, 'venue.activated', jsonb_build_object('venue_id', p_venue_id, 'name', v.name));
  return v;
end;
$$;

create or replace function public.advance_venue(p_event_id uuid)
returns public.venues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur_pos int;
  v_next uuid;
begin
  perform private.require_organiser(p_event_id);
  select v.position into v_cur_pos from public.events e join public.venues v on v.id = e.current_venue_id where e.id = p_event_id;
  select id into v_next from public.venues
    where event_id = p_event_id and not disabled and status = 'upcoming' and position > coalesce(v_cur_pos, -1)
    order by position limit 1;
  if v_next is null then
    raise exception 'That was the last venue — finish the event when you are ready' using errcode = '55000';
  end if;
  return public.activate_venue(v_next);
end;
$$;

-- organiser marks a not-yet-active venue as skipped for everyone, or restores it
create or replace function public.set_venue_state(p_venue_id uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.venues;
begin
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(v.event_id);
  if p_state not in ('upcoming', 'skipped', 'completed') then
    raise exception 'Use activate_venue to open a venue' using errcode = '22023';
  end if;
  update public.venues set status = p_state,
    closed_at = case when p_state = 'completed' then now() else closed_at end
  where id = p_venue_id;
  if v.status = 'active' then
    update public.events set current_venue_id = null where id = v.event_id and current_venue_id = p_venue_id;
  end if;
  perform private.audit(v.event_id, 'venue.state', jsonb_build_object('venue_id', p_venue_id, 'state', p_state));
end;
$$;

create or replace function public.rotate_invite_code(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  perform private.require_organiser(p_event_id);
  v_code := private.new_invite_code();
  update public.event_invites set code = v_code, rotated_at = now() where event_id = p_event_id;
  perform private.audit(p_event_id, 'invite.rotated');
  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- Discovery + joining
-- -----------------------------------------------------------------------------
create or replace function private.preview_json(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description, 'event_date', e.event_date,
    'start_time', e.start_time, 'end_time', e.end_time, 'timezone', e.timezone,
    'start_location', e.start_location, 'organiser_name', e.organiser_name,
    'theme_key', e.theme_key, 'theme_custom', e.theme_custom, 'cover_path', e.cover_path,
    'status', e.status, 'visibility', e.visibility, 'play_mode', e.play_mode,
    'team_selection', e.team_selection, 'allow_self_teams', e.allow_self_teams, 'teams_locked', e.teams_locked,
    'join_open', e.join_open, 'allow_late_join', e.allow_late_join, 'capacity', e.capacity,
    'require_code', e.require_code, 'team_max_size', e.team_max_size,
    'member_count', (select count(*) from public.event_members m where m.event_id = e.id and m.status = 'active' and m.role = 'participant'),
    'venue_count', (select count(*) from public.venues v where v.event_id = e.id and not v.disabled),
    'current_venue', (select v.name from public.venues v where v.id = e.current_venue_id),
    'my_status', (select m.status from public.event_members m where m.event_id = e.id and m.user_id = auth.uid()),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'color', t.color, 'icon', t.icon, 'max_size', coalesce(t.max_size, e.team_max_size),
        'size', (select count(*) from public.team_members tm join public.event_members m on m.id = tm.member_id
                 where tm.team_id = t.id and tm.left_at is null and m.status = 'active')
      ) order by t.created_at)
      from public.teams t where t.event_id = e.id), '[]'::jsonb)
  )
  from public.events e where e.id = p_event;
$$;

create or replace function public.get_event_preview(p_code text default null, p_event_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_event uuid;
begin
  if p_code is not null then
    select i.event_id into v_event from public.event_invites i join public.events e on e.id = i.event_id
      where i.code = private.normalise_code(p_code) and (e.status <> 'draft' or e.owner_id = auth.uid());
  elsif p_event_id is not null then
    select e.id into v_event from public.events e
      where e.id = p_event_id and (
        (e.visibility = 'public' and e.status in ('published', 'in_progress', 'paused', 'completed'))
        or private.is_member(e.id) or e.owner_id = auth.uid());
  end if;
  if v_event is null then
    return null;
  end if;
  return private.preview_json(v_event);
end;
$$;

create or replace function public.list_public_events()
returns table (id uuid, name text, event_date date, start_time time, theme_key text, status text, organiser_name text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.event_date, e.start_time, e.theme_key, e.status, e.organiser_name,
    (select count(*) from public.event_members m where m.event_id = e.id and m.status = 'active' and m.role = 'participant')
  from public.events e
  where e.visibility = 'public' and e.status in ('published', 'in_progress', 'paused')
    and (e.event_date is null or e.event_date >= current_date - 1)
  order by e.event_date nulls last, e.created_at desc
  limit 24;
$$;

create or replace function private.assign_team(p_member uuid, p_team uuid, p_enforce_size boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.event_members;
  t public.teams;
  v_max int;
  v_size int;
  v_current uuid;
begin
  select * into m from public.event_members where id = p_member for update;
  v_current := private.current_team(p_member);
  if v_current is not distinct from p_team then
    return;
  end if;
  if p_team is not null then
    select * into t from public.teams where id = p_team for update;
    if t.id is null or t.event_id <> m.event_id then
      raise exception 'Team not found' using errcode = 'P0002';
    end if;
    if p_enforce_size then
      select coalesce(t.max_size, e.team_max_size) into v_max from public.events e where e.id = m.event_id;
      select count(*) into v_size from public.team_members tm join public.event_members em on em.id = tm.member_id
        where tm.team_id = p_team and tm.left_at is null and em.status = 'active';
      if v_max is not null and v_size >= v_max then
        raise exception '% is full', t.name using errcode = '54000';
      end if;
    end if;
  end if;
  update public.team_members set left_at = now() where member_id = p_member and left_at is null;
  if p_team is not null then
    insert into public.team_members (event_id, team_id, member_id, assigned_by) values (m.event_id, p_team, p_member, auth.uid());
  end if;
end;
$$;

create or replace function private.auto_assign_team(p_member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_team uuid;
begin
  select event_id into v_event from public.event_members where id = p_member;
  select t.id into v_team
  from public.teams t
  join public.events e on e.id = t.event_id
  left join lateral (
    select count(*) as n from public.team_members tm join public.event_members em on em.id = tm.member_id
    where tm.team_id = t.id and tm.left_at is null and em.status = 'active'
  ) s on true
  where t.event_id = v_event and (coalesce(t.max_size, e.team_max_size) is null or s.n < coalesce(t.max_size, e.team_max_size))
  order by s.n, random()
  limit 1;
  if v_team is not null then
    perform private.assign_team(p_member, v_team, true);
  end if;
  return v_team;
end;
$$;

create or replace function public.join_event(
  p_code text default null,
  p_event_id uuid default null,
  p_display_name text default null,
  p_avatar_color text default null,
  p_avatar_icon text default null,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_event uuid;
  e public.events;
  m public.event_members;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_count int;
  v_pos int;
begin
  if p_code is not null then
    select event_id into v_event from public.event_invites where code = private.normalise_code(p_code);
  elsif p_event_id is not null then
    select id into v_event from public.events where id = p_event_id and visibility = 'public' and not require_code;
  end if;
  if v_event is null then
    raise exception 'That invitation is not valid. Ask the organiser for a fresh link.' using errcode = 'P0002';
  end if;

  -- serialise joins per event: capacity checks and auto team balancing stay correct under concurrency
  select * into e from public.events where id = v_event for update;

  select * into m from public.event_members where event_id = v_event and user_id = v_uid;
  if m.id is not null and m.status = 'active' then
    return m.id;  -- idempotent: repeated taps, refreshes and reconnects
  end if;
  if m.status = 'removed' then
    raise exception 'The organiser removed you from this event' using errcode = '42501';
  end if;

  if e.status not in ('published', 'in_progress', 'paused') then
    raise exception '%', case when e.status = 'draft' then 'This crawl has not opened yet' else 'This crawl is no longer taking players' end
      using errcode = '55000';
  end if;
  if not e.join_open then
    raise exception 'The organiser has closed joining for this crawl' using errcode = '55000';
  end if;
  if e.status in ('in_progress', 'paused') and not e.allow_late_join then
    raise exception 'This crawl has started and is not accepting late arrivals' using errcode = '55000';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Pick a name between 1 and 40 characters' using errcode = '22023';
  end if;
  if e.capacity is not null then
    select count(*) into v_count from public.event_members where event_id = v_event and status = 'active' and role = 'participant';
    if v_count >= e.capacity then
      raise exception 'This crawl is full' using errcode = '54000';
    end if;
  end if;

  select v.position into v_pos from public.venues v where v.id = e.current_venue_id;

  if m.id is not null then
    update public.event_members set status = 'active', left_at = null, display_name = v_name,
      avatar_color = coalesce(p_avatar_color, avatar_color), avatar_icon = coalesce(p_avatar_icon, avatar_icon)
    where id = m.id returning * into m;
  else
    insert into public.event_members (event_id, user_id, role, display_name, avatar_color, avatar_icon, joined_late, joined_venue_position)
    values (v_event, v_uid, 'participant', v_name, coalesce(p_avatar_color, '#F2A93B'), coalesce(p_avatar_icon, 'pint'),
            e.status in ('in_progress', 'paused'), v_pos)
    returning * into m;
  end if;

  insert into public.profiles (id, display_name, avatar_color, avatar_icon)
  values (v_uid, v_name, p_avatar_color, p_avatar_icon)
  on conflict (id) do update set display_name = excluded.display_name,
    avatar_color = coalesce(excluded.avatar_color, public.profiles.avatar_color),
    avatar_icon = coalesce(excluded.avatar_icon, public.profiles.avatar_icon);

  if e.play_mode <> 'individual' and private.current_team(m.id) is null then
    if p_team_id is not null and e.team_selection = 'self' and not e.teams_locked then
      perform private.assign_team(m.id, p_team_id, true);
    elsif e.team_selection = 'auto' then
      perform private.auto_assign_team(m.id);
    end if;
  end if;

  perform private.audit(v_event, 'member.joined', jsonb_build_object('member_id', m.id, 'late', m.joined_late));
  return m.id;
end;
$$;

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare m public.event_members;
begin
  perform private.require_uid();
  select * into m from public.event_members where event_id = p_event_id and user_id = auth.uid() and status = 'active' for update;
  if m.id is null then return; end if;
  if private.is_owner(p_event_id) then
    raise exception 'You own this event. Cancel or delete it instead of leaving.' using errcode = '55000';
  end if;
  update public.team_members set left_at = now() where member_id = m.id and left_at is null;
  update public.event_members set status = 'left', left_at = now() where id = m.id;
  perform private.audit(p_event_id, 'member.left', jsonb_build_object('member_id', m.id));
end;
$$;

create or replace function public.remove_member(p_member_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare m public.event_members;
begin
  select * into m from public.event_members where id = p_member_id for update;
  if m.id is null then raise exception 'Participant not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(m.event_id);
  if exists (select 1 from public.events where id = m.event_id and owner_id = m.user_id) then
    raise exception 'The event owner cannot be removed' using errcode = '42501';
  end if;
  if m.role = 'co_organiser' and not private.is_owner(m.event_id) then
    raise exception 'Only the owner can remove a co-organiser' using errcode = '42501';
  end if;
  update public.team_members set left_at = now() where member_id = m.id and left_at is null;
  update public.event_members set status = 'removed', left_at = now(), removed_by = auth.uid(),
    removed_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
  where id = m.id;
  perform private.audit(m.event_id, 'member.removed', jsonb_build_object('member_id', m.id, 'reason', p_reason));
end;
$$;

-- Owners can let a removed person back in.
create or replace function public.restore_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare m public.event_members;
begin
  select * into m from public.event_members where id = p_member_id for update;
  if m.id is null then raise exception 'Participant not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(m.event_id);
  update public.event_members set status = 'active', left_at = null, removed_by = null, removed_reason = null where id = m.id;
  perform private.audit(m.event_id, 'member.restored', jsonb_build_object('member_id', m.id));
end;
$$;

create or replace function public.set_member_role(p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare m public.event_members;
begin
  select * into m from public.event_members where id = p_member_id for update;
  if m.id is null then raise exception 'Participant not found' using errcode = 'P0002'; end if;
  perform private.require_uid();
  if not private.is_owner(m.event_id) then
    raise exception 'Only the event owner can change roles' using errcode = '42501';
  end if;
  if p_role not in ('co_organiser', 'participant') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  update public.event_members set role = p_role where id = m.id;
  perform private.audit(m.event_id, 'member.role', jsonb_build_object('member_id', m.id, 'role', p_role));
end;
$$;

-- -----------------------------------------------------------------------------
-- Teams
-- -----------------------------------------------------------------------------
create or replace function public.create_team(p_event_id uuid, p_name text, p_color text default null, p_icon text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  v_id uuid;
  v_org boolean;
  v_member uuid;
begin
  perform private.require_uid();
  select * into e from public.events where id = p_event_id for update;
  v_org := private.is_organiser(p_event_id);
  v_member := private.my_member_id(p_event_id);
  if not v_org then
    if v_member is null or not e.allow_self_teams or e.teams_locked or e.status in ('completed', 'archived', 'cancelled') then
      raise exception 'Team creation is not open for this event' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.teams where event_id = p_event_id) >= 50 then
    raise exception 'Up to 50 teams per event' using errcode = '54000';
  end if;
  begin
    insert into public.teams (event_id, name, color, icon, created_by)
    values (p_event_id, btrim(p_name), coalesce(p_color, '#2F6F5E'), coalesce(p_icon, 'flag'), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already a team called %', btrim(p_name) using errcode = '23505';
  end;
  if not v_org then
    perform private.assign_team(v_member, v_id, false);
  end if;
  perform private.audit(p_event_id, 'team.created', jsonb_build_object('team_id', v_id));
  return v_id;
end;
$$;

-- participant picks (or leaves) a team themselves
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
  if e.team_selection <> 'self' or e.teams_locked or e.play_mode = 'individual' then
    raise exception 'Teams are assigned by the organiser for this event' using errcode = '42501';
  end if;
  perform private.assign_team(v_member, p_team_id, true);
  perform private.audit(p_event_id, 'team.chosen', jsonb_build_object('member_id', v_member, 'team_id', p_team_id));
end;
$$;

create or replace function public.assign_member_team(p_member_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_event uuid;
begin
  select event_id into v_event from public.event_members where id = p_member_id;
  if v_event is null then raise exception 'Participant not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(v_event);
  perform 1 from public.events where id = v_event for update;
  perform private.assign_team(p_member_id, p_team_id, false);
  perform private.audit(v_event, 'team.assigned', jsonb_build_object('member_id', p_member_id, 'team_id', p_team_id));
end;
$$;

-- Apply a whole team plan (e.g. a previewed random shuffle) atomically.
-- p_plan = {"teams": [{"id": uuid|null, "name": text, "color": text, "icon": text, "member_ids": [uuid]}],
--           "unassign_others": bool}
create or replace function public.apply_team_plan(p_event_id uuid, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb;
  v_team uuid;
  v_member uuid;
  v_listed uuid[] := '{}';
begin
  perform private.require_organiser(p_event_id);
  perform 1 from public.events where id = p_event_id for update;
  if jsonb_typeof(p_plan -> 'teams') <> 'array' or jsonb_array_length(p_plan -> 'teams') > 50 then
    raise exception 'Invalid team plan' using errcode = '22023';
  end if;
  for t in select * from jsonb_array_elements(p_plan -> 'teams') loop
    v_team := private.try_uuid(t ->> 'id');
    if v_team is not null then
      if not exists (select 1 from public.teams where id = v_team and event_id = p_event_id) then
        raise exception 'Team not found' using errcode = 'P0002';
      end if;
      update public.teams set name = coalesce(nullif(btrim(t ->> 'name'), ''), name),
        color = coalesce(t ->> 'color', color), icon = coalesce(t ->> 'icon', icon)
      where id = v_team;
    else
      insert into public.teams (event_id, name, color, icon, created_by)
      values (p_event_id, btrim(t ->> 'name'), coalesce(t ->> 'color', '#2F6F5E'), coalesce(t ->> 'icon', 'flag'), auth.uid())
      returning id into v_team;
    end if;
    for v_member in select private.try_uuid(x) from jsonb_array_elements_text(coalesce(t -> 'member_ids', '[]'::jsonb)) x loop
      if not exists (select 1 from public.event_members where id = v_member and event_id = p_event_id and status = 'active') then
        raise exception 'A participant in the plan is no longer in the event — reshuffle and try again' using errcode = '40001';
      end if;
      if v_member = any (v_listed) then
        raise exception 'A participant appears in two teams' using errcode = '22023';
      end if;
      v_listed := v_listed || v_member;
      perform private.assign_team(v_member, v_team, false);
    end loop;
  end loop;
  if coalesce((p_plan ->> 'unassign_others')::boolean, false) then
    update public.team_members set left_at = now()
      where event_id = p_event_id and left_at is null and not (member_id = any (v_listed));
  end if;
  perform private.audit(p_event_id, 'team.plan_applied', jsonb_build_object('members', cardinality(v_listed)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Scoring
-- -----------------------------------------------------------------------------
-- Challenges a member has "done": their own approved individual submissions,
-- plus approved team submissions of any team they were on when it was submitted.
create or replace function private.member_done_challenges(p_member uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.challenge_id from public.challenge_submissions s
    where s.member_id = p_member and s.scope = 'individual' and s.status = 'approved'
  union
  select s.challenge_id from public.challenge_submissions s
    join public.team_members tm on tm.team_id = s.team_id and tm.member_id = p_member
      and tm.joined_at <= s.created_at and (tm.left_at is null or tm.left_at > s.created_at)
    where s.scope = 'team' and s.status = 'approved';
$$;

create or replace function private.sync_venue_bonus(p_venue uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  v_key text := 'vb:' || p_venue || ':' || p_member;
  v_done boolean;
begin
  select * into v from public.venues where id = p_venue;
  if v.id is null or v.bonus_points <= 0 then
    delete from public.score_ledger where ledger_key = v_key;
    return;
  end if;
  select exists (select 1 from public.challenges c where c.venue_id = p_venue and c.required and not c.archived)
     and not exists (
       select 1 from public.challenges c where c.venue_id = p_venue and c.required and not c.archived
         and c.id not in (select private.member_done_challenges(p_member)))
    into v_done;
  if v_done then
    insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, points)
    values (v.event_id, v_key, 'venue_bonus', p_venue, 'bonus', p_member, private.current_team(p_member), p_venue, v.bonus_points)
    on conflict (ledger_key) do nothing;
  else
    delete from public.score_ledger where ledger_key = v_key;
  end if;
end;
$$;

create or replace function private.check_achievements(p_member uuid, p_submission uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  d public.achievement_definitions;
  v_ok boolean;
begin
  select event_id into v_event from public.event_members where id = p_member;
  for d in select * from public.achievement_definitions where event_id = v_event and enabled and rule <> 'manual' loop
    v_ok := case d.rule
      when 'first_challenge' then exists (select private.member_done_challenges(p_member))
      when 'team_player' then exists (select 1 from public.challenge_submissions s
                                      where s.member_id = p_member and s.scope = 'team' and s.status = 'approved')
      when 'perfect_venue' then exists (
        select 1 from public.venues v where v.event_id = v_event and not v.disabled
          and exists (select 1 from public.challenges c where c.venue_id = v.id and c.required and not c.archived)
          and not exists (select 1 from public.challenges c where c.venue_id = v.id and c.required and not c.archived
                          and c.id not in (select private.member_done_challenges(p_member))))
      when 'all_required' then exists (select 1 from public.challenges c where c.event_id = v_event and c.required and not c.archived)
        and not exists (
          select 1 from public.challenges c left join public.venues v on v.id = c.venue_id
          where c.event_id = v_event and c.required and not c.archived and (v.id is null or not v.disabled)
            and c.id not in (select private.member_done_challenges(p_member)))
      else false end;
    if v_ok then
      insert into public.member_achievements (event_id, achievement_id, member_id, submission_id)
      values (v_event, d.id, p_member, p_submission)
      on conflict (achievement_id, member_id) do nothing;
    end if;
  end loop;
end;
$$;

-- Rebuild the ledger rows for one submission. Idempotent: deterministic keys,
-- delete + insert in the caller's transaction.
create or replace function private.sync_submission_score(p_submission uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.challenge_submissions;
  e public.events;
  v_prov boolean;
  v_points int;
  v_bonus int;
  v_member uuid;
  v_affected uuid[];
begin
  select * into s from public.challenge_submissions where id = p_submission;
  select * into e from public.events where id = s.event_id;
  delete from public.score_ledger where source = 'submission' and source_id = p_submission;

  v_prov := s.status = 'pending' and e.provisional_scoring;
  if s.status = 'approved' then
    v_points := s.points_awarded; v_bonus := s.bonus_awarded;
  elsif v_prov then
    v_points := s.points_snapshot; v_bonus := s.bonus_snapshot;
  else
    v_points := 0; v_bonus := 0;
  end if;

  if s.scope = 'individual' then
    -- one row credits the participant and (once) the team they were on
    if v_points <> 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points, provisional)
      values (s.event_id, 'sub:' || s.id || ':points', 'submission', s.id, 'points', s.member_id, s.team_id, s.venue_id, s.challenge_id, v_points, v_prov);
    end if;
    if v_bonus <> 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points, provisional)
      values (s.event_id, 'sub:' || s.id || ':bonus', 'submission', s.id, 'bonus', s.member_id, s.team_id, s.venue_id, s.challenge_id, v_bonus, v_prov);
    end if;
    if s.status = 'rejected' and s.penalty_awarded > 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points)
      values (s.event_id, 'sub:' || s.id || ':penalty', 'submission', s.id, 'penalty', s.member_id, s.team_id, s.venue_id, s.challenge_id, -s.penalty_awarded);
    end if;
    v_affected := array[s.member_id];
  else
    -- team challenge: the team is credited exactly once (member_id null) ...
    if v_points <> 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points, provisional)
      values (s.event_id, 'sub:' || s.id || ':points:team', 'submission', s.id, 'points', null, s.team_id, s.venue_id, s.challenge_id, v_points, v_prov);
    end if;
    if v_bonus <> 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points, provisional)
      values (s.event_id, 'sub:' || s.id || ':bonus:team', 'submission', s.id, 'bonus', null, s.team_id, s.venue_id, s.challenge_id, v_bonus, v_prov);
    end if;
    if s.status = 'rejected' and s.penalty_awarded > 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points)
      values (s.event_id, 'sub:' || s.id || ':penalty:team', 'submission', s.id, 'penalty', null, s.team_id, s.venue_id, s.challenge_id, -s.penalty_awarded);
    end if;
    select array_agg(tm.member_id) into v_affected from public.team_members tm
      where tm.team_id = s.team_id and tm.joined_at <= s.created_at and (tm.left_at is null or tm.left_at > s.created_at);
    -- ... and optionally each member on the team at submission time gets
    -- individual credit. These rows have team_id = null so the team total is
    -- never multiplied by its head-count.
    if s.award_mode = 'team_and_members' and (v_points + v_bonus) <> 0 then
      insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, challenge_id, points, provisional)
      select s.event_id, 'sub:' || s.id || ':member:' || x, 'submission', s.id, 'points', x, null, s.venue_id, s.challenge_id, v_points + v_bonus, v_prov
      from unnest(coalesce(v_affected, '{}')) x;
    end if;
  end if;

  if s.venue_id is not null then
    foreach v_member in array coalesce(v_affected, '{}') loop
      perform private.sync_venue_bonus(s.venue_id, v_member);
    end loop;
  end if;
  if s.status = 'approved' then
    foreach v_member in array coalesce(v_affected, '{}') loop
      perform private.check_achievements(v_member, s.id);
    end loop;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submissions
-- -----------------------------------------------------------------------------
-- p_media: [{"path": text, "thumb_path": text|null, "kind": "image"|"video", "width": int, "height": int, "duration_ms": int}]
create or replace function public.submit_challenge(
  p_submission_id uuid,
  p_challenge_id uuid,
  p_text text default null,
  p_choice integer default null,
  p_caption text default null,
  p_media jsonb default '[]'::jsonb
)
returns public.challenge_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges;
  e public.events;
  v public.venues;
  m public.event_members;
  s public.challenge_submissions;
  a public.challenge_answers;
  v_team uuid;
  v_key text;
  v_attempts int;
  v_status text;
  v_correct boolean;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_item jsonb;
  v_obj record;
  v_thumb text;
  v_kind text;
  v_prefix text;
  v_media_count int := 0;
begin
  -- replay of an earlier request (double tap, retry after timeout): return the original
  select * into s from public.challenge_submissions where id = p_submission_id;
  if s.id is not null then
    if not exists (select 1 from public.event_members em where em.id = s.member_id and em.user_id = v_uid) then
      raise exception 'Submission id already used' using errcode = '23505';
    end if;
    return s;
  end if;

  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.archived then raise exception 'Challenge not found' using errcode = 'P0002'; end if;
  select * into e from public.events where id = c.event_id;
  select * into m from public.event_members where event_id = c.event_id and user_id = v_uid and status = 'active';
  if m.id is null then raise exception 'Join the event first' using errcode = '42501'; end if;
  if not m.is_player then raise exception 'You are not playing in this event' using errcode = '42501'; end if;
  if e.status <> 'in_progress' then
    raise exception '%', case when e.status = 'paused' then 'The crawl is paused — hang tight' else 'Submissions open when the crawl starts' end
      using errcode = '55000';
  end if;
  if not private.challenge_visible(c.event_id, c.venue_id, c.reveal, c.reveal_at) then
    raise exception 'This challenge has not been revealed yet' using errcode = '55000';
  end if;

  if c.venue_id is not null then
    select * into v from public.venues where id = c.venue_id;
    if v.disabled then raise exception 'This venue is not part of the crawl right now' using errcode = '55000'; end if;
    if not (v.status = 'active' or (e.allow_any_venue and v.status = 'completed')) then
      raise exception 'This venue is not open for submissions' using errcode = '55000';
    end if;
    if exists (select 1 from public.venue_participation p where p.venue_id = v.id and p.member_id = m.id and p.status = 'skipped') then
      raise exception 'You skipped this venue. Rejoin it first to take on its challenges.' using errcode = '55000';
    end if;
    if coalesce(c.time_limit_minutes, v.time_limit_minutes) is not null and v.status = 'active'
       and now() > v.activated_at + make_interval(mins => coalesce(c.time_limit_minutes, v.time_limit_minutes)) then
      raise exception 'Time is up for this challenge' using errcode = '55000';
    end if;
  end if;

  v_team := private.current_team(m.id);
  if c.scope = 'team' and v_team is null then
    raise exception 'You need to be on a team for team challenges' using errcode = '55000';
  end if;

  -- serialise attempts for this participant/team + challenge
  v_key := case when c.scope = 'team' then 't:' || v_team else 'm:' || m.id end || ':' || c.id;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  if exists (select 1 from public.challenge_submissions x where x.dedupe_key = v_key and x.status in ('pending', 'approved'))
     and not c.repeatable then
    raise exception '%', case when c.scope = 'team' then 'Your team has already completed this one' else 'You have already completed this one' end
      using errcode = '23505';
  end if;
  select count(*) into v_attempts from public.challenge_submissions x
    where x.challenge_id = c.id and x.status not in ('withdrawn', 'resubmit')
      and (case when c.scope = 'team' then x.team_id = v_team and x.scope = 'team' else x.member_id = m.id end);
  if v_attempts >= c.max_attempts then
    raise exception 'No attempts left for this challenge' using errcode = '54000';
  end if;

  -- answer validation
  if c.text_required and v_text is null then
    raise exception 'Add your answer before submitting' using errcode = '22023';
  end if;
  if c.type = 'multiple_choice' then
    if p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(c.choices) then
      raise exception 'Pick one of the options' using errcode = '22023';
    end if;
  end if;
  select * into a from public.challenge_answers where challenge_id = c.id;
  if c.type = 'multiple_choice' and a.correct_choice is not null then
    v_correct := p_choice = a.correct_choice;
  elsif c.type = 'text' and a.accepted_answers is not null and cardinality(a.accepted_answers) > 0 then
    v_correct := lower(v_text) = any (a.accepted_answers);
  end if;

  if jsonb_typeof(coalesce(p_media, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_media, '[]'::jsonb)) > 4 then
    raise exception 'Up to 4 files per submission' using errcode = '22023';
  end if;
  v_media_count := jsonb_array_length(coalesce(p_media, '[]'::jsonb));
  if c.media_required and v_media_count = 0 then
    raise exception 'This challenge needs a % as proof', case c.proof_media when 'video' then 'video' when 'photo' then 'photo' else 'photo or video' end
      using errcode = '22023';
  end if;
  if c.proof_media = 'none' and v_media_count > 0 then
    raise exception 'This challenge does not take photos or videos' using errcode = '22023';
  end if;

  v_status := case
    when v_correct is not null then case when v_correct then 'approved' else 'rejected' end
    when c.requires_approval or c.all_members_required then 'pending'
    else 'approved' end;

  insert into public.challenge_submissions (
    id, event_id, challenge_id, venue_id, member_id, team_id, scope, attempt_no, dedupe_key, text_response, choice_index,
    caption, status, is_correct, points_snapshot, bonus_snapshot, penalty_snapshot, award_mode,
    points_awarded, bonus_awarded, penalty_awarded
  ) values (
    p_submission_id, c.event_id, c.id, c.venue_id, m.id, v_team, c.scope, v_attempts + 1,
    case when c.repeatable then null else v_key end,
    left(v_text, 1000), p_choice, left(nullif(btrim(coalesce(p_caption, '')), ''), 280), v_status, v_correct,
    case when c.type = 'bonus' then 0 else c.points end,
    case when c.type = 'bonus' then c.points + c.bonus_points else c.bonus_points end,
    c.penalty_points, c.team_award_mode,
    case when v_status = 'approved' and c.type <> 'bonus' then c.points else 0 end,
    case when v_status = 'approved' then case when c.type = 'bonus' then c.points + c.bonus_points else c.bonus_points end else 0 end,
    case when v_status = 'rejected' then c.penalty_points else 0 end
  ) returning * into s;

  -- attach media: objects must already be uploaded by this user under this
  -- submission's folder; size/type come from Storage's own metadata.
  v_prefix := c.event_id || '/' || v_uid || '/' || p_submission_id || '/';
  for v_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    if left(v_item ->> 'path', char_length(v_prefix)) <> v_prefix then
      raise exception 'Upload path does not belong to this submission' using errcode = '42501';
    end if;
    select o.name, o.metadata into v_obj from storage.objects o
      where o.bucket_id = 'proof' and o.name = v_item ->> 'path'
        and (o.owner_id = v_uid::text or o.owner = v_uid);
    if v_obj.name is null then
      raise exception 'Upload not found — please retry the upload' using errcode = 'P0002';
    end if;
    v_kind := case when coalesce(v_obj.metadata ->> 'mimetype', '') like 'image/%' then 'image'
                   when coalesce(v_obj.metadata ->> 'mimetype', '') like 'video/%' then 'video' end;
    if v_kind is null then
      raise exception 'Unsupported file type' using errcode = '22023';
    end if;
    if (c.proof_media = 'photo' and v_kind <> 'image') or (c.proof_media = 'video' and v_kind <> 'video') then
      raise exception 'This challenge needs a %', case c.proof_media when 'photo' then 'photo' else 'video' end using errcode = '22023';
    end if;
    if nullif(v_item ->> 'thumb_path', '') is not null then
      select o.name into v_thumb from storage.objects o
        where o.bucket_id = 'proof' and o.name = v_item ->> 'thumb_path'
          and left(o.name, char_length(v_prefix)) = v_prefix
          and (o.owner_id = v_uid::text or o.owner = v_uid);
    else
      v_thumb := null;
    end if;
    insert into public.submission_media (submission_id, event_id, uploader_id, object_path, thumb_path, kind, mime_type,
      size_bytes, width, height, duration_ms)
    values (s.id, c.event_id, v_uid, v_obj.name, v_thumb, v_kind, v_obj.metadata ->> 'mimetype',
      greatest(coalesce((v_obj.metadata ->> 'size')::bigint, 1), 1),
      nullif(v_item ->> 'width', '')::int, nullif(v_item ->> 'height', '')::int, nullif(v_item ->> 'duration_ms', '')::int);
  end loop;

  if c.venue_id is not null then
    insert into public.venue_participation (event_id, venue_id, member_id, team_id, status)
    values (c.event_id, c.venue_id, m.id, v_team, 'present')
    on conflict (venue_id, member_id) do nothing;
  end if;

  perform private.sync_submission_score(s.id);
  return s;
end;
$$;

create or replace function public.withdraw_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.challenge_submissions;
begin
  perform private.require_uid();
  select * into s from public.challenge_submissions where id = p_submission_id for update;
  if s.id is null or not exists (select 1 from public.event_members m where m.id = s.member_id and m.user_id = auth.uid()) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.status not in ('pending', 'resubmit') then
    raise exception 'Only submissions waiting for review can be withdrawn' using errcode = '55000';
  end if;
  update public.challenge_submissions set status = 'withdrawn' where id = s.id;
  perform private.sync_submission_score(s.id);
end;
$$;

create or replace function public.review_submission(
  p_submission_id uuid,
  p_decision text,
  p_note text default null,
  p_points integer default null
)
returns public.challenge_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.challenge_submissions;
  e public.events;
  v_points int;
begin
  select * into s from public.challenge_submissions where id = p_submission_id for update;
  if s.id is null then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(s.event_id);
  select * into e from public.events where id = s.event_id;
  if p_decision not in ('approved', 'rejected', 'resubmit') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if s.status = 'withdrawn' then
    raise exception 'This submission was withdrawn' using errcode = '55000';
  end if;
  if exists (select 1 from public.event_members m where m.id = s.member_id and m.user_id = auth.uid())
     and not private.is_owner(s.event_id) then
    raise exception 'Ask another organiser to review your own submission' using errcode = '42501';
  end if;

  v_points := s.points_snapshot;
  if p_points is not null and p_decision = 'approved' and p_points <> s.points_snapshot then
    if not e.allow_partial_points then
      raise exception 'Partial points are switched off for this event' using errcode = '55000';
    end if;
    v_points := greatest(0, least(p_points, s.points_snapshot));
  end if;

  begin
    update public.challenge_submissions set
      status = p_decision,
      points_awarded = case when p_decision = 'approved' then v_points else 0 end,
      bonus_awarded = case when p_decision = 'approved' then bonus_snapshot else 0 end,
      penalty_awarded = case when p_decision = 'rejected' then penalty_snapshot else 0 end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
    where id = s.id
    returning * into s;
  exception when unique_violation then
    raise exception 'Another submission for this challenge is already live — review that one instead' using errcode = '23505';
  end;
  perform private.sync_submission_score(s.id);
  perform private.audit(s.event_id, 'submission.reviewed',
    jsonb_build_object('submission_id', s.id, 'decision', p_decision, 'points', s.points_awarded));
  return s;
end;
$$;

create or replace function public.moderate_submission(p_submission_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_event uuid;
begin
  select event_id into v_event from public.challenge_submissions where id = p_submission_id;
  if v_event is null then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  perform private.require_organiser(v_event);
  update public.challenge_submissions set hidden = p_hidden where id = p_submission_id;
  perform private.audit(v_event, 'submission.moderated', jsonb_build_object('submission_id', p_submission_id, 'hidden', p_hidden));
end;
$$;

-- -----------------------------------------------------------------------------
-- Venue participation: check-in / skip / resume / organiser override
-- -----------------------------------------------------------------------------
create or replace function private.apply_skip_penalty(p_participation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.venue_participation;
  e public.events;
  v_key text := 'skip:' || p_participation;
begin
  select * into p from public.venue_participation where id = p_participation;
  select * into e from public.events where id = p.event_id;
  if p.status = 'skipped' and e.skip_policy = 'penalty' and e.skip_penalty > 0 and p.overridden_by is null then
    insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, venue_id, points)
    values (p.event_id, v_key, 'skip_penalty', p.id, 'penalty', p.member_id, p.team_id, p.venue_id, -e.skip_penalty)
    on conflict (ledger_key) do nothing;
  else
    delete from public.score_ledger where ledger_key = v_key;
  end if;
end;
$$;

create or replace function public.check_in_venue(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  e public.events;
  v_member uuid;
  v_pid uuid;
begin
  perform private.require_uid();
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  select * into e from public.events where id = v.event_id;
  v_member := private.my_member_id(v.event_id);
  if v_member is null then raise exception 'Join the event first' using errcode = '42501'; end if;
  if e.status not in ('in_progress', 'paused') then raise exception 'The crawl has not started' using errcode = '55000'; end if;
  if not (v.status = 'active' or (e.allow_any_venue and v.status = 'completed')) then
    raise exception 'You can only check in at the current venue' using errcode = '55000';
  end if;
  insert into public.venue_participation (event_id, venue_id, member_id, team_id, status)
  values (v.event_id, v.id, v_member, private.current_team(v_member), 'present')
  on conflict (venue_id, member_id) do update set status = 'present', skip_reason = null
  returning id into v_pid;
  perform private.apply_skip_penalty(v_pid);
end;
$$;

create or replace function public.skip_venue(p_venue_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  e public.events;
  v_member uuid;
  v_pid uuid;
begin
  perform private.require_uid();
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  select * into e from public.events where id = v.event_id;
  v_member := private.my_member_id(v.event_id);
  if v_member is null then raise exception 'Join the event first' using errcode = '42501'; end if;
  if not e.allow_skip then raise exception 'Skipping is switched off for this crawl — talk to the organiser' using errcode = '42501'; end if;
  if e.status not in ('published', 'in_progress', 'paused') then raise exception 'The crawl is not running' using errcode = '55000'; end if;
  if v.status not in ('upcoming', 'active') then raise exception 'That venue is already over' using errcode = '55000'; end if;
  insert into public.venue_participation (event_id, venue_id, member_id, team_id, status, skip_reason)
  values (v.event_id, v.id, v_member, private.current_team(v_member), 'skipped', left(nullif(btrim(coalesce(p_reason, '')), ''), 200))
  on conflict (venue_id, member_id) do update
    set status = 'skipped', skip_reason = excluded.skip_reason, team_id = excluded.team_id, overridden_by = null
  returning id into v_pid;
  perform private.apply_skip_penalty(v_pid);
end;
$$;

create or replace function public.resume_venue(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  v_member uuid;
  p public.venue_participation;
begin
  perform private.require_uid();
  select * into v from public.venues where id = p_venue_id;
  if v.id is null then raise exception 'Venue not found' using errcode = 'P0002'; end if;
  v_member := private.my_member_id(v.event_id);
  select * into p from public.venue_participation where venue_id = p_venue_id and member_id = v_member and status = 'skipped';
  if p.id is null then return; end if;
  if v.status in ('completed', 'skipped') then
    raise exception 'That venue is over, so the skip stands' using errcode = '55000';
  end if;
  delete from public.score_ledger where ledger_key = 'skip:' || p.id;
  delete from public.venue_participation where id = p.id;
end;
$$;

-- p_status: 'present' | 'skipped' | null (clear). Organiser overrides never carry a skip penalty.
create or replace function public.override_participation(p_member_id uuid, p_venue_id uuid, p_status text, p_waive_penalty boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.venues;
  v_pid uuid;
begin
  select * into v from public.venues where id = p_venue_id;
  if v.id is null or not exists (select 1 from public.event_members where id = p_member_id and event_id = v.event_id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  perform private.require_organiser(v.event_id);
  if p_status is null then
    delete from public.score_ledger where source = 'skip_penalty'
      and source_id in (select id from public.venue_participation where venue_id = p_venue_id and member_id = p_member_id);
    delete from public.venue_participation where venue_id = p_venue_id and member_id = p_member_id;
  else
    if p_status not in ('present', 'skipped') then raise exception 'Unknown status' using errcode = '22023'; end if;
    insert into public.venue_participation (event_id, venue_id, member_id, team_id, status, overridden_by)
    values (v.event_id, v.id, p_member_id, private.current_team(p_member_id), p_status,
            case when p_waive_penalty then auth.uid() end)
    on conflict (venue_id, member_id) do update
      set status = excluded.status, overridden_by = excluded.overridden_by
    returning id into v_pid;
    perform private.apply_skip_penalty(v_pid);
  end if;
  perform private.audit(v.event_id, 'participation.override',
    jsonb_build_object('member_id', p_member_id, 'venue_id', p_venue_id, 'status', p_status));
end;
$$;

-- -----------------------------------------------------------------------------
-- Score corrections (audited)
-- -----------------------------------------------------------------------------
create or replace function private.confirmed_total(p_member uuid, p_team uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::int from public.score_ledger
  where not provisional and ((p_member is not null and member_id = p_member) or (p_team is not null and team_id = p_team));
$$;

create or replace function public.adjust_score(
  p_event_id uuid,
  p_member_id uuid,
  p_team_id uuid,
  p_reason text,
  p_delta integer default null,
  p_new_total integer default null
)
returns public.score_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig int;
  v_delta int;
  r public.score_adjustments;
begin
  perform private.require_organiser(p_event_id);
  perform 1 from public.events where id = p_event_id for update;
  if (p_member_id is null) = (p_team_id is null) then
    raise exception 'Choose a participant or a team' using errcode = '22023';
  end if;
  if p_member_id is not null and not exists (select 1 from public.event_members where id = p_member_id and event_id = p_event_id) then
    raise exception 'Participant not found' using errcode = 'P0002';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and event_id = p_event_id) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Add a short reason for the correction' using errcode = '22023';
  end if;
  v_orig := private.confirmed_total(p_member_id, p_team_id);
  v_delta := coalesce(p_delta, p_new_total - v_orig);
  if v_delta is null or v_delta = 0 then
    raise exception 'The score is unchanged' using errcode = '22023';
  end if;
  insert into public.score_adjustments (event_id, member_id, team_id, delta, original_value, new_value, reason, actor_id)
  values (p_event_id, p_member_id, p_team_id, v_delta, v_orig, v_orig + v_delta, btrim(p_reason), auth.uid())
  returning * into r;
  insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, team_id, points)
  values (p_event_id, 'adj:' || r.id, 'adjustment', r.id, 'adjustment', p_member_id, p_team_id, v_delta);
  perform private.audit(p_event_id, 'score.adjusted', to_jsonb(r));
  return r;
end;
$$;

create or replace function public.award_achievement(p_member_id uuid, p_achievement_id uuid, p_note text default null, p_submission_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_event uuid;
begin
  select event_id into v_event from public.event_members where id = p_member_id;
  if v_event is null or not exists (select 1 from public.achievement_definitions where id = p_achievement_id and event_id = v_event) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  perform private.require_organiser(v_event);
  insert into public.member_achievements (event_id, achievement_id, member_id, submission_id, awarded_by, note)
  values (v_event, p_achievement_id, p_member_id, p_submission_id, auth.uid(), left(nullif(btrim(coalesce(p_note, '')), ''), 200))
  on conflict (achievement_id, member_id) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leaderboards
-- -----------------------------------------------------------------------------
-- Ranking: standard competition ranking (1, 1, 3). With tie_break =
-- 'most_completed' or 'earliest', equal scores are separated by completed
-- challenges / time the score was reached; anything still equal shares a rank.
create or replace function public.get_leaderboard(p_event_id uuid, p_venue_id uuid default null, p_challenge_id uuid default null)
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
  -- hidden leaderboards are revealed to everyone once the event is over
  if e.status in ('completed', 'archived') then
    e.leaderboard_visible := true;
  end if;

  with l as (
    select * from public.score_ledger
    where event_id = p_event_id
      and (p_venue_id is null or venue_id = p_venue_id)
      and (p_challenge_id is null or challenge_id = p_challenge_id)
  ),
  people as (
    select m.id, m.display_name, m.avatar_color, m.avatar_icon, private.current_team(m.id) as team_id,
      coalesce(sum(l.points) filter (where not l.provisional), 0)::int as confirmed,
      coalesce(sum(l.points) filter (where l.provisional), 0)::int as pending,
      count(distinct l.source_id) filter (where l.source = 'submission' and l.kind in ('points', 'bonus') and not l.provisional)::int as completed,
      max(l.created_at) filter (where not l.provisional and l.points > 0) as last_scored_at
    from public.event_members m
    left join l on l.member_id = m.id
    where m.event_id = p_event_id and m.status = 'active' and m.is_player
    group by m.id
  ),
  scored as (
    select p.*, p.confirmed + case when e.provisional_scoring then p.pending else 0 end as score from people p
  ),
  ranked as (
    select s.*, case e.tie_break
      when 'most_completed' then rank() over (order by s.score desc, s.completed desc)
      when 'earliest' then rank() over (order by s.score desc, s.last_scored_at asc nulls last)
      else rank() over (order by s.score desc) end as rank
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', r.id, 'name', r.display_name, 'avatar_color', r.avatar_color, 'avatar_icon', r.avatar_icon,
      'team_id', r.team_id, 'confirmed', r.confirmed, 'pending', r.pending, 'score', r.score,
      'completed', r.completed, 'rank', r.rank, 'tied', (select count(*) from ranked r2 where r2.rank = r.rank) > 1,
      'is_me', r.id = v_me
    ) order by r.rank, r.display_name, r.id), '[]'::jsonb)
  into v_people
  from ranked r
  where v_org or e.leaderboard_visible or r.id = v_me;

  with l as (
    select * from public.score_ledger
    where event_id = p_event_id
      and (p_venue_id is null or venue_id = p_venue_id)
      and (p_challenge_id is null or challenge_id = p_challenge_id)
  ),
  t as (
    select tm.id, tm.name, tm.color, tm.icon,
      coalesce(sum(l.points) filter (where not l.provisional), 0)::int as confirmed,
      coalesce(sum(l.points) filter (where l.provisional), 0)::int as pending,
      count(distinct l.source_id) filter (where l.source = 'submission' and l.kind in ('points', 'bonus') and not l.provisional)::int as completed,
      max(l.created_at) filter (where not l.provisional and l.points > 0) as last_scored_at,
      (select count(*) from public.team_members x join public.event_members em on em.id = x.member_id
        where x.team_id = tm.id and x.left_at is null and em.status = 'active')::int as size
    from public.teams tm
    left join l on l.team_id = tm.id
    where tm.event_id = p_event_id
    group by tm.id
  ),
  scored as (
    select t.*, t.confirmed + case when e.provisional_scoring then t.pending else 0 end as score from t
  ),
  ranked as (
    select s.*, case e.tie_break
      when 'most_completed' then rank() over (order by s.score desc, s.completed desc)
      when 'earliest' then rank() over (order by s.score desc, s.last_scored_at asc nulls last)
      else rank() over (order by s.score desc) end as rank
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.id, 'name', r.name, 'color', r.color, 'icon', r.icon, 'size', r.size,
      'confirmed', r.confirmed, 'pending', r.pending, 'score', r.score, 'completed', r.completed,
      'rank', r.rank, 'tied', (select count(*) from ranked r2 where r2.rank = r.rank) > 1,
      'is_mine', r.id = v_my_team
    ) order by r.rank, r.name, r.id), '[]'::jsonb)
  into v_teams
  from ranked r
  where e.play_mode <> 'individual' and (v_org or e.leaderboard_visible or r.id = v_my_team);

  return jsonb_build_object(
    'visible', v_org or e.leaderboard_visible,
    'provisional_scoring', e.provisional_scoring,
    'tie_break', e.tie_break,
    'individuals', v_people,
    'teams', v_teams
  );
end;
$$;

-- CSV-friendly export. No media paths, no user ids, no contact details.
create or replace function public.get_results_export(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board jsonb;
  v_rows jsonb;
begin
  perform private.require_organiser(p_event_id);
  v_board := public.get_leaderboard(p_event_id);
  select coalesce(jsonb_agg(row_data order by (row_data ->> 'rank')::int nulls last, row_data ->> 'name'), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'name', m.display_name,
      'role', m.role,
      'team', (select t.name from public.teams t where t.id = private.current_team(m.id)),
      'status', m.status,
      'joined_late', m.joined_late,
      'venues_present', (select count(*) from public.venue_participation p where p.member_id = m.id and p.status = 'present'),
      'venues_skipped', (select count(*) from public.venue_participation p where p.member_id = m.id and p.status = 'skipped'),
      'challenges_completed', (select count(*) from (select private.member_done_challenges(m.id)) d),
      'points', (select coalesce(sum(points), 0) from public.score_ledger l where l.member_id = m.id and not l.provisional and l.kind = 'points'),
      'bonus', (select coalesce(sum(points), 0) from public.score_ledger l where l.member_id = m.id and not l.provisional and l.kind = 'bonus'),
      'penalties', (select coalesce(sum(points), 0) from public.score_ledger l where l.member_id = m.id and l.kind = 'penalty'),
      'adjustments', (select coalesce(sum(points), 0) from public.score_ledger l where l.member_id = m.id and l.kind = 'adjustment'),
      'total', (select (x ->> 'confirmed')::int from jsonb_array_elements(v_board -> 'individuals') x where (x ->> 'member_id')::uuid = m.id),
      'rank', (select (x ->> 'rank')::int from jsonb_array_elements(v_board -> 'individuals') x where (x ->> 'member_id')::uuid = m.id)
    ) as row_data
    from public.event_members m
    where m.event_id = p_event_id and (m.is_player or m.role = 'participant')
  ) q;
  return jsonb_build_object('individuals', v_rows, 'teams', v_board -> 'teams');
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges for the API roles
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;
-- internal helpers are only reachable from SECURITY DEFINER code; policy
-- helpers (used inside RLS expressions) must be executable by the caller.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.try_uuid(text),
  private.is_member(uuid),
  private.is_owner(uuid),
  private.is_organiser(uuid),
  private.my_member_id(uuid),
  private.current_team(uuid),
  private.challenge_visible(uuid, uuid, text, timestamptz),
  private.can_view_submission(uuid, uuid, uuid, text, boolean),
  private.can_view_ledger(uuid, uuid, uuid)
to authenticated;

grant execute on function public.event_status_transition_allowed(text, text) to anon, authenticated;
grant execute on function public.get_event_preview(text, uuid) to anon, authenticated;
grant execute on function public.list_public_events() to anon, authenticated;
grant execute on function
  public.create_event(jsonb, jsonb),
  public.add_venues(uuid, jsonb),
  public.save_challenge(uuid, uuid, jsonb),
  public.reorder_venues(uuid, uuid[]),
  public.reorder_challenges(uuid, uuid[]),
  public.duplicate_venue(uuid),
  public.duplicate_event(uuid, text),
  public.set_event_status(uuid, text),
  public.activate_venue(uuid),
  public.advance_venue(uuid),
  public.set_venue_state(uuid, text),
  public.rotate_invite_code(uuid),
  public.join_event(text, uuid, text, text, text, uuid),
  public.leave_event(uuid),
  public.remove_member(uuid, text),
  public.restore_member(uuid),
  public.set_member_role(uuid, text),
  public.create_team(uuid, text, text, text),
  public.choose_team(uuid, uuid),
  public.assign_member_team(uuid, uuid),
  public.apply_team_plan(uuid, jsonb),
  public.submit_challenge(uuid, uuid, text, integer, text, jsonb),
  public.withdraw_submission(uuid),
  public.review_submission(uuid, text, text, integer),
  public.moderate_submission(uuid, boolean),
  public.check_in_venue(uuid),
  public.skip_venue(uuid, text),
  public.resume_venue(uuid),
  public.override_participation(uuid, uuid, text, boolean),
  public.adjust_score(uuid, uuid, uuid, text, integer, integer),
  public.award_achievement(uuid, uuid, text, uuid),
  public.get_leaderboard(uuid, uuid, uuid),
  public.get_results_export(uuid)
to authenticated;

-- trigger helper must stay callable by the table owner only
grant execute on function public.set_updated_at() to authenticated;
