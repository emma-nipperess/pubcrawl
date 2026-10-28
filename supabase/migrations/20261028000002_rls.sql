-- =============================================================================
-- Authorisation helpers + Row Level Security
-- =============================================================================
-- Helpers live in a schema that is NOT exposed through the Data API, so they
-- can only be used from policies and trusted functions. They are
-- SECURITY DEFINER (so policies on event_members don't recurse) with an empty
-- search_path, and every object is schema-qualified.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

create or replace function private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.is_member(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_members m
    where m.event_id = p_event and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function private.is_owner(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.events e where e.id = p_event and e.owner_id = auth.uid());
$$;

create or replace function private.is_organiser(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner(p_event) or exists (
    select 1 from public.event_members m
    where m.event_id = p_event and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('organiser', 'co_organiser')
  );
$$;

create or replace function private.my_member_id(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.event_members m
  where m.event_id = p_event and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function private.current_team(p_member uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id from public.team_members tm where tm.member_id = p_member and tm.left_at is null;
$$;

-- Is a challenge's content currently visible to participants?
create or replace function private.challenge_visible(p_event uuid, p_venue uuid, p_reveal text, p_reveal_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_reveal = 'always' then true
    when exists (select 1 from public.events e where e.id = p_event and e.challenges_visible_early) then true
    when p_reveal = 'at_time' then now() >= p_reveal_at
         or exists (select 1 from public.venues v where v.id = p_venue and v.status = 'completed')
    else (
      p_venue is null and exists (select 1 from public.events e where e.id = p_event and e.status in ('in_progress', 'paused', 'completed'))
    ) or exists (select 1 from public.venues v where v.id = p_venue and v.status in ('active', 'completed'))
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
      or (p_status = 'approved' and not p_hidden and exists (
            select 1 from public.events e where e.id = p_event and e.show_others_submissions))
    )
  );
$$;

-- Leaderboard ledger rows: organisers see all; participants see their own and
-- their team's rows, plus everything when leaderboards are public.
create or replace function private.can_view_ledger(p_event uuid, p_member uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organiser(p_event) or (
    private.is_member(p_event) and (
      exists (select 1 from public.events e where e.id = p_event and (e.leaderboard_visible or e.status in ('completed', 'archived')))
      or p_member = private.my_member_id(p_event)
      or (p_team is not null and p_team = private.current_team(private.my_member_id(p_event)))
    )
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;
grant execute on function private.try_uuid(text) to anon;

-- -----------------------------------------------------------------------------
-- Table privileges: start from nothing, grant only what the policies need.
-- Mutations that need multi-step validation go through RPCs (next migration).
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (display_name, avatar_color, avatar_icon) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

grant select, delete on public.events to authenticated;
grant update (
  name, description, event_date, start_time, end_time, timezone, start_location, meeting_instructions,
  theme_key, theme_custom, cover_path, organiser_name, capacity, visibility, require_code, allow_late_join,
  join_open, play_mode, team_selection, allow_self_teams, team_max_size, teams_locked, allow_skip,
  skip_policy, skip_penalty, allow_any_venue, challenges_visible_early, default_requires_approval,
  show_others_submissions, leaderboard_visible, provisional_scoring, allow_partial_points, tie_break,
  media_retention_days
) on public.events to authenticated;

grant select on public.event_invites to authenticated;

grant select on public.event_members to authenticated;
grant update (display_name, avatar_color, avatar_icon, is_player) on public.event_members to authenticated;

grant select, delete on public.venues to authenticated;
grant update (
  name, address, maps_url, latitude, longitude, description, meeting_instructions, arrive_at, depart_at,
  duration_minutes, accent_color, image_path, par, bonus_points, time_limit_minutes, disabled
) on public.venues to authenticated;

grant select, insert, update, delete on public.venue_organiser_notes to authenticated;

grant select, delete on public.teams to authenticated;
grant update (name, color, icon, max_size) on public.teams to authenticated;
grant select on public.team_members to authenticated;

grant select, delete on public.challenges to authenticated;
grant select on public.challenge_answers to authenticated;

grant select on public.challenge_submissions to authenticated;
grant select on public.submission_media to authenticated;
grant select on public.venue_participation to authenticated;
grant select on public.score_ledger to authenticated;
grant select on public.score_adjustments to authenticated;

grant select, insert on public.event_announcements to authenticated;
grant update (pinned, deleted_at) on public.event_announcements to authenticated;

grant select, insert, delete on public.achievement_definitions to authenticated;
grant update (title, description, icon, enabled) on public.achievement_definitions to authenticated;
grant select on public.member_achievements to authenticated;

grant select, insert, delete on public.event_templates to authenticated;
grant update (name, description, theme_key, payload) on public.event_templates to authenticated;

grant select on public.event_audit_log to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_invites enable row level security;
alter table public.event_members enable row level security;
alter table public.venues enable row level security;
alter table public.venue_organiser_notes enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_answers enable row level security;
alter table public.challenge_submissions enable row level security;
alter table public.submission_media enable row level security;
alter table public.venue_participation enable row level security;
alter table public.score_ledger enable row level security;
alter table public.score_adjustments enable row level security;
alter table public.event_announcements enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.member_achievements enable row level security;
alter table public.event_templates enable row level security;
alter table public.event_audit_log enable row level security;

-- profiles: strictly self
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_delete_self on public.profiles for delete to authenticated using (id = auth.uid());

-- events: members/organisers; public events are discoverable once published.
-- Creation happens only through create_event() (no INSERT grant).
create policy events_select on public.events for select to authenticated using (
  owner_id = auth.uid()
  or private.is_member(id)
  or (visibility = 'public' and status in ('published', 'in_progress', 'paused', 'completed'))
);
create policy events_update_organiser on public.events for update to authenticated
  using (private.is_organiser(id) and status <> 'archived')
  with check (private.is_organiser(id));
create policy events_delete_owner on public.events for delete to authenticated using (owner_id = auth.uid());

-- invitation codes: organisers only (participants never need to read them back)
create policy invites_select_organiser on public.event_invites for select to authenticated
  using (private.is_organiser(event_id));

-- members: visible to fellow active members; you can always see your own row
create policy members_select on public.event_members for select to authenticated using (
  user_id = auth.uid() or private.is_member(event_id) or private.is_organiser(event_id)
);
-- participants may edit their own presentation fields only (column grants);
-- they cannot touch role/status, which are not granted.
create policy members_update_self on public.event_members for update to authenticated
  using (user_id = auth.uid() and status = 'active')
  with check (user_id = auth.uid());

-- venues
create policy venues_select on public.venues for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);
create policy venues_update_organiser on public.venues for update to authenticated
  using (private.is_organiser(event_id)) with check (private.is_organiser(event_id));
create policy venues_delete_organiser on public.venues for delete to authenticated
  using (private.is_organiser(event_id) and status <> 'active');

create policy venue_notes_all_organiser on public.venue_organiser_notes for all to authenticated
  using (private.is_organiser(event_id))
  with check (
    private.is_organiser(event_id)
    and exists (select 1 from public.venues v where v.id = venue_id and v.event_id = venue_organiser_notes.event_id)
  );

-- teams
create policy teams_select on public.teams for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);
create policy teams_update_organiser on public.teams for update to authenticated
  using (private.is_organiser(event_id)) with check (private.is_organiser(event_id));
create policy teams_delete_organiser on public.teams for delete to authenticated
  using (private.is_organiser(event_id));

create policy team_members_select on public.team_members for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);

-- challenges: content is hidden until revealed, unless you organise the event
create policy challenges_select on public.challenges for select to authenticated using (
  private.is_organiser(event_id)
  or (private.is_member(event_id) and not archived and private.challenge_visible(event_id, venue_id, reveal, reveal_at))
);
create policy challenges_delete_organiser on public.challenges for delete to authenticated
  using (private.is_organiser(event_id));

create policy challenge_answers_select_organiser on public.challenge_answers for select to authenticated
  using (private.is_organiser(event_id));

-- submissions + media
create policy submissions_select on public.challenge_submissions for select to authenticated
  using (private.can_view_submission(event_id, member_id, team_id, status, hidden));

create policy submission_media_select on public.submission_media for select to authenticated using (
  exists (
    select 1 from public.challenge_submissions s
    where s.id = submission_id
      and private.can_view_submission(s.event_id, s.member_id, s.team_id, s.status, s.hidden)
  )
);

-- participation
create policy participation_select on public.venue_participation for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);

-- scores
create policy ledger_select on public.score_ledger for select to authenticated
  using (private.can_view_ledger(event_id, member_id, team_id));

create policy adjustments_select on public.score_adjustments for select to authenticated using (
  private.is_organiser(event_id)
  or (member_id is not null and member_id = private.my_member_id(event_id))
);

-- announcements
create policy announcements_select on public.event_announcements for select to authenticated using (
  (private.is_member(event_id) and deleted_at is null) or private.is_organiser(event_id)
);
create policy announcements_insert_organiser on public.event_announcements for insert to authenticated
  with check (private.is_organiser(event_id) and author_id = auth.uid());
create policy announcements_update_organiser on public.event_announcements for update to authenticated
  using (private.is_organiser(event_id)) with check (private.is_organiser(event_id));

-- achievements
create policy achievement_defs_select on public.achievement_definitions for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);
create policy achievement_defs_insert on public.achievement_definitions for insert to authenticated
  with check (private.is_organiser(event_id));
create policy achievement_defs_update on public.achievement_definitions for update to authenticated
  using (private.is_organiser(event_id)) with check (private.is_organiser(event_id));
create policy achievement_defs_delete on public.achievement_definitions for delete to authenticated
  using (private.is_organiser(event_id));

create policy member_achievements_select on public.member_achievements for select to authenticated using (
  private.is_member(event_id) or private.is_organiser(event_id)
);

-- templates: private to their owner
create policy templates_select_own on public.event_templates for select to authenticated using (owner_id = auth.uid());
create policy templates_insert_own on public.event_templates for insert to authenticated with check (owner_id = auth.uid());
create policy templates_update_own on public.event_templates for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy templates_delete_own on public.event_templates for delete to authenticated using (owner_id = auth.uid());

-- audit log: organisers only, written by trusted functions
create policy audit_select_organiser on public.event_audit_log for select to authenticated
  using (private.is_organiser(event_id));
