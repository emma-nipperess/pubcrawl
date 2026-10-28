-- =============================================================================
-- Roundhouse — core relational schema
-- =============================================================================
-- Conventions
--   * uuid primary keys, database-generated timestamps
--   * text + CHECK constraints instead of enums so new values (e.g. challenge
--     types) can be added with a simple constraint change
--   * every table is event-scoped (event_id) so RLS can be expressed cheaply
--   * scores live in an append/sync ledger (score_ledger) that is written only
--     by trusted database functions
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user (anonymous or email-linked)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  avatar_color  text check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  avatar_icon   text check (avatar_icon is null or avatar_icon ~ '^[a-z0-9_-]{1,24}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
create table public.events (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references auth.users (id) on delete cascade,
  name                      text not null check (char_length(btrim(name)) between 2 and 80),
  description               text check (description is null or char_length(description) <= 2000),
  event_date                date,
  start_time                time,
  end_time                  time,
  timezone                  text not null default 'Europe/London' check (char_length(timezone) <= 64),
  start_location            text check (start_location is null or char_length(start_location) <= 200),
  meeting_instructions      text check (meeting_instructions is null or char_length(meeting_instructions) <= 1000),
  theme_key                 text not null default 'classic' check (theme_key ~ '^[a-z0-9_-]{1,32}$'),
  theme_custom              jsonb not null default '{}'::jsonb
                              check (jsonb_typeof(theme_custom) = 'object' and pg_column_size(theme_custom) < 4096),
  cover_path                text check (cover_path is null or char_length(cover_path) <= 300),
  organiser_name            text not null check (char_length(btrim(organiser_name)) between 1 and 40),
  capacity                  integer check (capacity is null or capacity between 2 and 1000),
  visibility                text not null default 'private' check (visibility in ('public', 'private')),
  require_code              boolean not null default true,
  allow_late_join           boolean not null default true,
  join_open                 boolean not null default true,
  play_mode                 text not null default 'team' check (play_mode in ('individual', 'team', 'both')),
  team_selection            text not null default 'organiser' check (team_selection in ('organiser', 'self', 'auto')),
  allow_self_teams          boolean not null default false,
  team_max_size             integer check (team_max_size is null or team_max_size between 1 and 100),
  teams_locked              boolean not null default false,
  allow_skip                boolean not null default true,
  skip_policy               text not null default 'none' check (skip_policy in ('none', 'zero', 'penalty')),
  skip_penalty              integer not null default 0 check (skip_penalty between 0 and 1000),
  allow_any_venue           boolean not null default false,
  challenges_visible_early  boolean not null default false,
  default_requires_approval boolean not null default false,
  show_others_submissions   boolean not null default true,
  leaderboard_visible       boolean not null default true,
  provisional_scoring       boolean not null default false,
  allow_partial_points      boolean not null default false,
  tie_break                 text not null default 'shared' check (tie_break in ('shared', 'most_completed', 'earliest')),
  media_retention_days      integer not null default 30 check (media_retention_days between 1 and 365),
  status                    text not null default 'draft'
                              check (status in ('draft', 'published', 'in_progress', 'paused', 'completed', 'archived', 'cancelled')),
  current_venue_id          uuid,
  published_at              timestamptz,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index events_owner_idx on public.events (owner_id);
create index events_public_idx on public.events (visibility, status) where visibility = 'public';
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- Invitation code lives in its own table so it can be hidden from the public
-- discovery listing and rotated without touching the event row.
create table public.event_invites (
  event_id    uuid primary key references public.events (id) on delete cascade,
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  rotated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- event_members
-- -----------------------------------------------------------------------------
create table public.event_members (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  role                  text not null default 'participant' check (role in ('organiser', 'co_organiser', 'participant')),
  display_name          text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_color          text not null default '#F2A93B' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  avatar_icon           text not null default 'pint' check (avatar_icon ~ '^[a-z0-9_-]{1,24}$'),
  status                text not null default 'active' check (status in ('active', 'left', 'removed')),
  is_player             boolean not null default true,
  joined_late           boolean not null default false,
  joined_venue_position integer,
  joined_at             timestamptz not null default now(),
  left_at               timestamptz,
  removed_by            uuid references auth.users (id) on delete set null,
  removed_reason        text check (removed_reason is null or char_length(removed_reason) <= 200),
  updated_at            timestamptz not null default now(),
  unique (event_id, user_id)
);
create index event_members_user_idx on public.event_members (user_id);
create index event_members_event_idx on public.event_members (event_id, status);
create trigger event_members_updated_at before update on public.event_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- venues (holes / stops)
-- -----------------------------------------------------------------------------
create table public.venues (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events (id) on delete cascade,
  position             integer not null check (position >= 0),
  name                 text not null check (char_length(btrim(name)) between 1 and 80),
  address              text check (address is null or char_length(address) <= 200),
  maps_url             text check (maps_url is null or (maps_url ~* '^https://' and char_length(maps_url) <= 500)),
  latitude             numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude            numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  description          text check (description is null or char_length(description) <= 1000),
  meeting_instructions text check (meeting_instructions is null or char_length(meeting_instructions) <= 500),
  arrive_at            time,
  depart_at            time,
  duration_minutes     integer check (duration_minutes is null or duration_minutes between 1 and 720),
  accent_color         text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  image_path           text check (image_path is null or char_length(image_path) <= 300),
  par                  integer check (par is null or par between 0 and 10000),
  bonus_points         integer not null default 0 check (bonus_points between 0 and 1000),
  time_limit_minutes   integer check (time_limit_minutes is null or time_limit_minutes between 1 and 720),
  disabled             boolean not null default false,
  status               text not null default 'upcoming' check (status in ('upcoming', 'active', 'completed', 'skipped')),
  activated_at         timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint venues_event_position_key unique (event_id, position) deferrable initially deferred
);
create index venues_event_idx on public.venues (event_id, position);
create unique index venues_one_active_idx on public.venues (event_id) where status = 'active';
create trigger venues_updated_at before update on public.venues
  for each row execute function public.set_updated_at();

alter table public.events
  add constraint events_current_venue_fk foreign key (current_venue_id)
  references public.venues (id) on delete set null;

create table public.venue_organiser_notes (
  venue_id   uuid primary key references public.venues (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  notes      text not null default '' check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);
create index venue_notes_event_idx on public.venue_organiser_notes (event_id);
create trigger venue_notes_updated_at before update on public.venue_organiser_notes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- teams + membership history
-- -----------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  color       text not null default '#2F6F5E' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon        text not null default 'flag' check (icon ~ '^[a-z0-9_-]{1,24}$'),
  max_size    integer check (max_size is null or max_size between 1 and 100),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index teams_event_name_key on public.teams (event_id, lower(btrim(name)));
create index teams_event_idx on public.teams (event_id);
create trigger teams_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_members (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  member_id    uuid not null references public.event_members (id) on delete cascade,
  assigned_by  uuid references auth.users (id) on delete set null,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  check (left_at is null or left_at >= joined_at)
);
-- a member can be on at most one team at a time; history rows have left_at set
create unique index team_members_one_current_idx on public.team_members (member_id) where left_at is null;
create index team_members_team_idx on public.team_members (team_id) where left_at is null;
create index team_members_event_idx on public.team_members (event_id);

-- -----------------------------------------------------------------------------
-- challenges
-- -----------------------------------------------------------------------------
create table public.challenges (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events (id) on delete cascade,
  venue_id              uuid references public.venues (id) on delete cascade,
  position              integer not null default 0 check (position >= 0),
  title                 text not null check (char_length(btrim(title)) between 1 and 100),
  description           text check (description is null or char_length(description) <= 1500),
  type                  text not null default 'checkbox'
                          check (type in ('photo', 'video', 'photo_or_video', 'text', 'multiple_choice',
                                          'checkbox', 'team', 'bonus', 'verified', 'custom')),
  scope                 text not null default 'individual' check (scope in ('individual', 'team')),
  required              boolean not null default true,
  points                integer not null default 10 check (points between 0 and 1000),
  bonus_points          integer not null default 0 check (bonus_points between 0 and 1000),
  time_limit_minutes    integer check (time_limit_minutes is null or time_limit_minutes between 1 and 720),
  proof_media           text not null default 'none' check (proof_media in ('none', 'photo', 'video', 'either')),
  media_required        boolean not null default false,
  text_prompt           text check (text_prompt is null or char_length(text_prompt) <= 300),
  text_required         boolean not null default false,
  choices               jsonb check (choices is null or (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 8)),
  requires_approval     boolean not null default false,
  max_attempts          integer not null default 1 check (max_attempts between 1 and 20),
  repeatable            boolean not null default false,
  all_members_required  boolean not null default false,
  reveal                text not null default 'with_venue' check (reveal in ('always', 'with_venue', 'at_time')),
  reveal_at             timestamptz,
  penalty_points        integer not null default 0 check (penalty_points between 0 and 1000),
  team_award_mode       text not null default 'team_only' check (team_award_mode in ('team_only', 'team_and_members')),
  rules                 text check (rules is null or char_length(rules) <= 1000),
  safety_notes          text check (safety_notes is null or char_length(safety_notes) <= 500),
  archived              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (reveal <> 'at_time' or reveal_at is not null),
  check (type <> 'multiple_choice' or choices is not null)
);
create index challenges_event_idx on public.challenges (event_id, venue_id, position);
create trigger challenges_updated_at before update on public.challenges
  for each row execute function public.set_updated_at();

-- Answer keys are organiser-only, so they live in a separate table.
create table public.challenge_answers (
  challenge_id      uuid primary key references public.challenges (id) on delete cascade,
  event_id          uuid not null references public.events (id) on delete cascade,
  correct_choice    integer check (correct_choice is null or correct_choice between 0 and 7),
  accepted_answers  text[] check (accepted_answers is null or cardinality(accepted_answers) <= 20),
  updated_at        timestamptz not null default now()
);
create index challenge_answers_event_idx on public.challenge_answers (event_id);

-- -----------------------------------------------------------------------------
-- submissions + media metadata (binaries live in Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.challenge_submissions (
  id               uuid primary key,                      -- generated by the client for idempotent retries
  event_id         uuid not null references public.events (id) on delete cascade,
  challenge_id     uuid not null references public.challenges (id) on delete no action,
  venue_id         uuid references public.venues (id) on delete set null,
  member_id        uuid not null references public.event_members (id) on delete cascade,
  team_id          uuid references public.teams (id) on delete no action,
  scope            text not null check (scope in ('individual', 'team')),
  attempt_no       integer not null check (attempt_no >= 1),
  dedupe_key       text,
  text_response    text check (text_response is null or char_length(text_response) <= 1000),
  choice_index     integer check (choice_index is null or choice_index between 0 and 7),
  caption          text check (caption is null or char_length(caption) <= 280),
  status           text not null check (status in ('pending', 'approved', 'rejected', 'resubmit', 'withdrawn')),
  is_correct       boolean,
  points_snapshot  integer not null default 0,
  bonus_snapshot   integer not null default 0,
  penalty_snapshot integer not null default 0,
  award_mode       text not null default 'team_only' check (award_mode in ('team_only', 'team_and_members')),
  points_awarded   integer not null default 0,
  bonus_awarded    integer not null default 0,
  penalty_awarded  integer not null default 0,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  review_note      text check (review_note is null or char_length(review_note) <= 300),
  hidden           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- One live (pending/approved) completion per participant or per team for non-repeatable challenges.
create unique index submissions_live_dedupe_idx on public.challenge_submissions (dedupe_key)
  where dedupe_key is not null and status in ('pending', 'approved');
create index submissions_event_idx on public.challenge_submissions (event_id, created_at desc);
create index submissions_event_status_idx on public.challenge_submissions (event_id, status);
create index submissions_member_idx on public.challenge_submissions (member_id, challenge_id);
create index submissions_team_idx on public.challenge_submissions (team_id, challenge_id);
create trigger submissions_updated_at before update on public.challenge_submissions
  for each row execute function public.set_updated_at();

create table public.submission_media (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.challenge_submissions (id) on delete cascade,
  event_id       uuid not null references public.events (id) on delete cascade,
  uploader_id    uuid not null references auth.users (id) on delete cascade,
  bucket         text not null default 'proof' check (bucket = 'proof'),
  object_path    text not null unique check (char_length(object_path) <= 400),
  thumb_path     text unique check (thumb_path is null or char_length(thumb_path) <= 400),
  kind           text not null check (kind in ('image', 'video')),
  mime_type      text not null check (char_length(mime_type) <= 100),
  size_bytes     bigint not null check (size_bytes > 0),
  width          integer check (width is null or width > 0),
  height         integer check (height is null or height > 0),
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),
  created_at     timestamptz not null default now()
);
create index submission_media_submission_idx on public.submission_media (submission_id);
create index submission_media_event_idx on public.submission_media (event_id);

-- -----------------------------------------------------------------------------
-- venue participation (check-in / skip)
-- -----------------------------------------------------------------------------
create table public.venue_participation (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  venue_id       uuid not null references public.venues (id) on delete cascade,
  member_id      uuid not null references public.event_members (id) on delete cascade,
  team_id        uuid references public.teams (id) on delete set null,
  status         text not null check (status in ('present', 'skipped')),
  skip_reason    text check (skip_reason is null or char_length(skip_reason) <= 200),
  overridden_by  uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (venue_id, member_id)
);
create index venue_participation_event_idx on public.venue_participation (event_id, member_id);
create trigger venue_participation_updated_at before update on public.venue_participation
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- score ledger (trusted writes only) + audited adjustments
-- -----------------------------------------------------------------------------
-- A row credits points to a member (member_id), a team (team_id) or both.
-- Every row has a deterministic ledger_key, so re-running a sync can never
-- double-award points.
create table public.score_ledger (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  ledger_key    text not null unique,
  source        text not null check (source in ('submission', 'venue_bonus', 'skip_penalty', 'adjustment')),
  source_id     uuid not null,
  kind          text not null check (kind in ('points', 'bonus', 'penalty', 'adjustment')),
  member_id     uuid references public.event_members (id) on delete cascade,
  team_id       uuid references public.teams (id) on delete cascade,
  venue_id      uuid references public.venues (id) on delete set null,
  challenge_id  uuid references public.challenges (id) on delete set null,
  points        integer not null,
  provisional   boolean not null default false,
  created_at    timestamptz not null default now(),
  check (member_id is not null or team_id is not null)
);
create index score_ledger_event_idx on public.score_ledger (event_id);
create index score_ledger_member_idx on public.score_ledger (member_id) where member_id is not null;
create index score_ledger_team_idx on public.score_ledger (team_id) where team_id is not null;
create index score_ledger_source_idx on public.score_ledger (source, source_id);

create table public.score_adjustments (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  member_id       uuid references public.event_members (id) on delete cascade,
  team_id         uuid references public.teams (id) on delete cascade,
  delta           integer not null check (delta between -10000 and 10000 and delta <> 0),
  original_value  integer not null,
  new_value       integer not null,
  reason          text not null check (char_length(btrim(reason)) between 3 and 300),
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((member_id is null) <> (team_id is null))
);
create index score_adjustments_event_idx on public.score_adjustments (event_id, created_at desc);

-- -----------------------------------------------------------------------------
-- announcements, achievements, templates, audit
-- -----------------------------------------------------------------------------
create table public.event_announcements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  kind        text not null default 'info' check (kind in ('info', 'venue_change', 'urgent', 'celebration')),
  pinned      boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index announcements_event_idx on public.event_announcements (event_id, created_at desc);

create table public.achievement_definitions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  title        text not null check (char_length(btrim(title)) between 1 and 60),
  description  text check (description is null or char_length(description) <= 200),
  icon         text not null default 'star' check (icon ~ '^[a-z0-9_-]{1,24}$'),
  rule         text not null check (rule in ('first_challenge', 'perfect_venue', 'all_required', 'team_player', 'manual')),
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (event_id, key)
);

create table public.member_achievements (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  achievement_id  uuid not null references public.achievement_definitions (id) on delete cascade,
  member_id       uuid not null references public.event_members (id) on delete cascade,
  submission_id   uuid references public.challenge_submissions (id) on delete set null,
  awarded_by      uuid references auth.users (id) on delete set null,
  note            text check (note is null or char_length(note) <= 200),
  created_at      timestamptz not null default now(),
  unique (achievement_id, member_id)
);
create index member_achievements_event_idx on public.member_achievements (event_id, created_at desc);

create table public.event_templates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  description  text check (description is null or char_length(description) <= 500),
  theme_key    text not null default 'classic' check (theme_key ~ '^[a-z0-9_-]{1,32}$'),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 262144),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index event_templates_owner_idx on public.event_templates (owner_id, created_at desc);
create trigger event_templates_updated_at before update on public.event_templates
  for each row execute function public.set_updated_at();

create table public.event_audit_log (
  id          bigint generated always as identity primary key,
  event_id    uuid not null references public.events (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (char_length(action) <= 60),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index event_audit_event_idx on public.event_audit_log (event_id, created_at desc);
