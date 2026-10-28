import type { ChallengeDraft, EventRow, VenueDraft } from '@/lib/supabase/types';

export type Errors<K extends string = string> = Partial<Record<K, string>>;

const trimmed = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

export function validateDisplayName(name: string): string | undefined {
  const n = name.trim();
  if (n.length < 1) return 'Pick a name so your crew knows who you are.';
  if (n.length > 40) return 'Keep it under 40 characters.';
  return undefined;
}

export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  const c = normaliseCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Extracts an invite code from a pasted link or a typed code. */
export function parseInvite(input: string): string | null {
  const s = input.trim();
  const fromUrl = /\/j\/([A-Za-z0-9-]{8,9})/.exec(s);
  const code = normaliseCode(fromUrl ? fromUrl[1] : s);
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}

export function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateEvent(e: Partial<EventRow>): Errors<'name' | 'organiser_name' | 'capacity' | 'end_time' | 'team_max_size' | 'skip_penalty' | 'description'> {
  const errs: Errors<'name' | 'organiser_name' | 'capacity' | 'end_time' | 'team_max_size' | 'skip_penalty' | 'description'> = {};
  const name = trimmed(e.name);
  if (name.length < 2) errs.name = 'Give your crawl a name (at least 2 characters).';
  else if (name.length > 80) errs.name = 'Keep the name under 80 characters.';
  if (!trimmed(e.organiser_name)) errs.organiser_name = 'Who is organising? A first name is fine.';
  else if (trimmed(e.organiser_name).length > 40) errs.organiser_name = 'Keep it under 40 characters.';
  if (e.description && e.description.length > 2000) errs.description = 'Keep the description under 2000 characters.';
  if (e.capacity != null && (e.capacity < 2 || e.capacity > 1000)) errs.capacity = 'Capacity must be between 2 and 1000.';
  if (e.team_max_size != null && (e.team_max_size < 1 || e.team_max_size > 100)) errs.team_max_size = 'Team size must be between 1 and 100.';
  if (e.skip_penalty != null && (e.skip_penalty < 0 || e.skip_penalty > 1000)) errs.skip_penalty = 'Penalty must be between 0 and 1000.';
  if (e.start_time && e.end_time && e.end_time <= e.start_time && e.end_time > '06:00') {
    errs.end_time = 'End time should be after the start time.';
  }
  return errs;
}

export function validateVenue(v: Partial<VenueDraft>): Errors<'name' | 'maps_url' | 'latitude' | 'longitude' | 'duration_minutes' | 'bonus_points'> {
  const errs: Errors<'name' | 'maps_url' | 'latitude' | 'longitude' | 'duration_minutes' | 'bonus_points'> = {};
  if (!trimmed(v.name)) errs.name = 'Every venue needs a name.';
  else if (trimmed(v.name).length > 80) errs.name = 'Keep the name under 80 characters.';
  if (v.maps_url && !isHttpsUrl(v.maps_url)) errs.maps_url = 'Paste a full https:// link from Google or Apple Maps.';
  if (v.latitude != null && (Number.isNaN(v.latitude) || v.latitude < -90 || v.latitude > 90)) errs.latitude = 'Latitude must be between -90 and 90.';
  if (v.longitude != null && (Number.isNaN(v.longitude) || v.longitude < -180 || v.longitude > 180)) errs.longitude = 'Longitude must be between -180 and 180.';
  if ((v.latitude == null) !== (v.longitude == null)) errs.longitude = 'Add both latitude and longitude, or neither.';
  if (v.duration_minutes != null && (v.duration_minutes < 1 || v.duration_minutes > 720)) errs.duration_minutes = 'Between 1 and 720 minutes.';
  if (v.bonus_points != null && (v.bonus_points < 0 || v.bonus_points > 1000)) errs.bonus_points = 'Between 0 and 1000.';
  return errs;
}

export function validateChallenge(c: Partial<ChallengeDraft>): Errors<'title' | 'points' | 'choices' | 'correct_choice' | 'max_attempts' | 'reveal_at'> {
  const errs: Errors<'title' | 'points' | 'choices' | 'correct_choice' | 'max_attempts' | 'reveal_at'> = {};
  if (!trimmed(c.title)) errs.title = 'Give the challenge a title.';
  else if (trimmed(c.title).length > 100) errs.title = 'Keep the title under 100 characters.';
  if (c.points == null || Number.isNaN(c.points) || c.points < 0 || c.points > 1000) errs.points = 'Points must be between 0 and 1000.';
  if (c.type === 'multiple_choice') {
    const opts = (c.choices ?? []).map((x) => x.trim()).filter(Boolean);
    if (opts.length < 2) errs.choices = 'Add at least two options.';
    else if (opts.length > 8) errs.choices = 'Up to eight options.';
    if (c.correct_choice != null && (c.correct_choice < 0 || c.correct_choice >= opts.length)) errs.correct_choice = 'Pick which option is correct.';
  }
  if (c.max_attempts != null && (c.max_attempts < 1 || c.max_attempts > 20)) errs.max_attempts = 'Between 1 and 20 attempts.';
  if (c.reveal === 'at_time' && !c.reveal_at) errs.reveal_at = 'Choose when to reveal it.';
  return errs;
}

export const hasErrors = (e: object) => Object.values(e).some(Boolean);

/** Parse quick-add text: one venue per line, optional "Name | address". */
export function parseQuickVenues(text: string): VenueDraft[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const [name, ...rest] = line.split('|');
      const address = rest.join('|').trim();
      return { name: name.trim().slice(0, 80), address: address ? address.slice(0, 200) : null, challenges: [] };
    })
    .filter((v) => v.name.length > 0);
}
