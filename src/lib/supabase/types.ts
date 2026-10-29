// Row types mirroring supabase/migrations. Kept by hand (small schema) so the
// app has no build-time dependency on the Supabase CLI.

export type EventStatus = 'draft' | 'published' | 'in_progress' | 'paused' | 'completed' | 'archived' | 'cancelled';
export type PlayMode = 'individual' | 'team' | 'both';
export type TeamSelection = 'organiser' | 'self' | 'auto';
export type SkipPolicy = 'none' | 'zero' | 'penalty';
export type TieBreak = 'shared' | 'most_completed' | 'earliest';
export type MemberRole = 'organiser' | 'co_organiser' | 'participant';
export type VenueStatus = 'upcoming' | 'active' | 'completed' | 'skipped';
export type ChallengeType =
  | 'photo'
  | 'video'
  | 'photo_or_video'
  | 'text'
  | 'multiple_choice'
  | 'checkbox'
  | 'team'
  | 'bonus'
  | 'verified'
  | 'custom';
export type ProofMedia = 'none' | 'photo' | 'video' | 'either';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'resubmit' | 'withdrawn';
export type Reveal = 'always' | 'with_venue' | 'at_time';
export type TeamAwardMode = 'team_only' | 'team_and_members';
export type GameMode = 'crawl' | 'golf';

export interface CustomTheme {
  accent?: string;
  base?: 'light' | 'dark';
  font?: string;
  tagline?: string;
}

export interface EventRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  start_location: string | null;
  meeting_instructions: string | null;
  theme_key: string;
  theme_custom: CustomTheme;
  cover_path: string | null;
  organiser_name: string;
  capacity: number | null;
  visibility: 'public' | 'private';
  require_code: boolean;
  allow_late_join: boolean;
  join_open: boolean;
  play_mode: PlayMode;
  team_selection: TeamSelection;
  allow_self_teams: boolean;
  team_max_size: number | null;
  teams_locked: boolean;
  allow_skip: boolean;
  skip_policy: SkipPolicy;
  skip_penalty: number;
  allow_any_venue: boolean;
  challenges_visible_early: boolean;
  default_requires_approval: boolean;
  show_others_submissions: boolean;
  leaderboard_visible: boolean;
  provisional_scoring: boolean;
  allow_partial_points: boolean;
  tie_break: TieBreak;
  media_retention_days: number;
  game_mode: GameMode;
  golf_default_par: number;
  golf_max_over: number;
  status: EventStatus;
  current_venue_id: string | null;
  published_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  event_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  avatar_color: string;
  avatar_icon: string;
  status: 'active' | 'left' | 'removed';
  is_player: boolean;
  joined_late: boolean;
  joined_venue_position: number | null;
  joined_at: string;
  left_at: string | null;
}

export interface VenueRow {
  id: string;
  event_id: string;
  position: number;
  name: string;
  address: string | null;
  maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  meeting_instructions: string | null;
  arrive_at: string | null;
  depart_at: string | null;
  duration_minutes: number | null;
  accent_color: string | null;
  image_path: string | null;
  par: number | null;
  drink: string | null;
  bonus_points: number;
  time_limit_minutes: number | null;
  disabled: boolean;
  status: VenueStatus;
  activated_at: string | null;
  closed_at: string | null;
}

export interface TeamRow {
  id: string;
  event_id: string;
  name: string;
  color: string;
  icon: string;
  max_size: number | null;
  created_at: string;
}

export interface TeamMemberRow {
  id: string;
  event_id: string;
  team_id: string;
  member_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface ChallengeRow {
  id: string;
  event_id: string;
  venue_id: string | null;
  position: number;
  title: string;
  description: string | null;
  type: ChallengeType;
  scope: 'individual' | 'team';
  required: boolean;
  points: number;
  bonus_points: number;
  time_limit_minutes: number | null;
  proof_media: ProofMedia;
  media_required: boolean;
  text_prompt: string | null;
  text_required: boolean;
  choices: string[] | null;
  requires_approval: boolean;
  max_attempts: number;
  repeatable: boolean;
  all_members_required: boolean;
  reveal: Reveal;
  reveal_at: string | null;
  penalty_points: number;
  team_award_mode: TeamAwardMode;
  rules: string | null;
  safety_notes: string | null;
  archived: boolean;
}

export interface SubmissionRow {
  id: string;
  event_id: string;
  challenge_id: string;
  venue_id: string | null;
  member_id: string;
  team_id: string | null;
  scope: 'individual' | 'team';
  attempt_no: number;
  text_response: string | null;
  choice_index: number | null;
  caption: string | null;
  status: SubmissionStatus;
  is_correct: boolean | null;
  points_snapshot: number;
  bonus_snapshot: number;
  penalty_snapshot: number;
  award_mode: TeamAwardMode;
  points_awarded: number;
  bonus_awarded: number;
  penalty_awarded: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  hidden: boolean;
  created_at: string;
}

export interface MediaRow {
  id: string;
  submission_id: string;
  event_id: string;
  uploader_id: string;
  object_path: string;
  thumb_path: string | null;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ParticipationRow {
  id: string;
  event_id: string;
  venue_id: string;
  member_id: string;
  team_id: string | null;
  status: 'present' | 'skipped';
  skip_reason: string | null;
  overridden_by: string | null;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  event_id: string;
  source: 'submission' | 'venue_bonus' | 'skip_penalty' | 'adjustment';
  source_id: string;
  kind: 'points' | 'bonus' | 'penalty' | 'adjustment';
  member_id: string | null;
  team_id: string | null;
  venue_id: string | null;
  challenge_id: string | null;
  points: number;
  provisional: boolean;
  created_at: string;
}

export interface AdjustmentRow {
  id: string;
  event_id: string;
  member_id: string | null;
  team_id: string | null;
  delta: number;
  original_value: number;
  new_value: number;
  reason: string;
  actor_id: string | null;
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  event_id: string;
  author_id: string | null;
  body: string;
  kind: 'info' | 'venue_change' | 'urgent' | 'celebration';
  pinned: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface AchievementDefRow {
  id: string;
  event_id: string;
  key: string;
  title: string;
  description: string | null;
  icon: string;
  rule: 'first_challenge' | 'perfect_venue' | 'all_required' | 'team_player' | 'manual';
  enabled: boolean;
}

export interface MemberAchievementRow {
  id: string;
  event_id: string;
  achievement_id: string;
  member_id: string;
  submission_id: string | null;
  note: string | null;
  created_at: string;
}

export interface TemplateRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  theme_key: string;
  payload: TemplatePayload;
  created_at: string;
}

export interface AuditRow {
  id: number;
  event_id: string;
  actor_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface EventPreview {
  id: string;
  name: string;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  start_location: string | null;
  organiser_name: string;
  theme_key: string;
  theme_custom: CustomTheme;
  cover_path: string | null;
  status: EventStatus;
  visibility: 'public' | 'private';
  play_mode: PlayMode;
  team_selection: TeamSelection;
  allow_self_teams: boolean;
  teams_locked: boolean;
  join_open: boolean;
  allow_late_join: boolean;
  capacity: number | null;
  require_code: boolean;
  team_max_size: number | null;
  member_count: number;
  venue_count: number;
  current_venue: string | null;
  my_status: 'active' | 'left' | 'removed' | null;
  teams: { id: string; name: string; color: string; icon: string; max_size: number | null; size: number }[];
}

export interface BoardPerson {
  member_id: string;
  name: string;
  avatar_color: string;
  avatar_icon: string;
  team_id: string | null;
  confirmed: number;
  pending: number;
  score: number;
  completed: number;
  rank: number;
  tied: boolean;
  is_me: boolean;
}

export interface BoardTeam {
  team_id: string;
  name: string;
  color: string;
  icon: string;
  size: number;
  confirmed: number;
  pending: number;
  score: number;
  completed: number;
  rank: number;
  tied: boolean;
  is_mine: boolean;
}

export interface Leaderboard {
  visible: boolean;
  provisional_scoring: boolean;
  tie_break: TieBreak;
  individuals: BoardPerson[];
  teams: BoardTeam[];
}

export interface GolfScoreRow {
  id: string;
  event_id: string;
  venue_id: string;
  member_id: string;
  strokes: number;
  recorded_by: string | null;
  updated_at: string;
}

export interface GolfPerson {
  member_id: string;
  name: string;
  avatar_color: string;
  avatar_icon: string;
  team_id: string | null;
  strokes: number;
  par: number;
  thru: number;
  adjustment: number;
  pending: number;
  to_par: number | null;
  rank: number | null;
  tied: boolean;
  is_me: boolean;
}

export interface GolfTeam {
  team_id: string;
  name: string;
  color: string;
  icon: string;
  size: number;
  thru: number;
  to_par: number | null;
  adjustment: number;
  rank: number | null;
  tied: boolean;
  is_mine: boolean;
}

export interface GolfBoard {
  visible: boolean;
  provisional_scoring: boolean;
  tie_break: TieBreak;
  max_over: number;
  individuals: GolfPerson[];
  teams: GolfTeam[];
}

/** Shape used by templates and create_event's p_venues. */
export interface ChallengeDraft {
  id?: string;
  title: string;
  description?: string | null;
  type: ChallengeType;
  scope?: 'individual' | 'team';
  required?: boolean;
  points: number;
  bonus_points?: number;
  time_limit_minutes?: number | null;
  proof_media?: ProofMedia;
  media_required?: boolean;
  text_prompt?: string | null;
  text_required?: boolean;
  choices?: string[] | null;
  correct_choice?: number | null;
  accepted_answers?: string[] | null;
  requires_approval?: boolean;
  max_attempts?: number;
  repeatable?: boolean;
  all_members_required?: boolean;
  reveal?: Reveal;
  reveal_at?: string | null;
  penalty_points?: number;
  team_award_mode?: TeamAwardMode;
  rules?: string | null;
  safety_notes?: string | null;
  archived?: boolean;
}

export interface VenueDraft {
  name: string;
  address?: string | null;
  maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  meeting_instructions?: string | null;
  arrive_at?: string | null;
  depart_at?: string | null;
  duration_minutes?: number | null;
  accent_color?: string | null;
  par?: number | null;
  drink?: string | null;
  bonus_points?: number;
  time_limit_minutes?: number | null;
  organiser_notes?: string | null;
  challenges: ChallengeDraft[];
}

export interface TemplatePayload {
  event: Partial<EventRow> & { team_names?: { name: string; color?: string; icon?: string }[] };
  venues: VenueDraft[];
}
