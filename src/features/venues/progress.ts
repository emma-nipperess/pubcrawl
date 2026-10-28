import type { MemberRow, ParticipationRow, VenueRow } from '@/lib/supabase/types';

export type MyVenueState =
  | 'upcoming' // not started yet
  | 'active' // current venue, playing
  | 'active_skipped' // current venue, but I skipped it
  | 'done' // finished and I was there / submitted
  | 'skipped' // I skipped it
  | 'missed' // finished without me (no check-in, no skip)
  | 'before_join' // finished before I joined (late joiner) — no penalty
  | 'group_skipped' // organiser skipped it for everyone
  | 'disabled';

export interface VenueProgressItem {
  venue: VenueRow;
  state: MyVenueState;
  participation?: ParticipationRow;
}

/**
 * Per-participant view of the route. Late joiners are never treated as having
 * missed venues that closed before they arrived.
 */
export function venueProgress(
  venues: readonly VenueRow[],
  participation: readonly ParticipationRow[],
  member: Pick<MemberRow, 'id' | 'joined_late' | 'joined_venue_position'> | null,
): VenueProgressItem[] {
  const mine = new Map(participation.filter((p) => member && p.member_id === member.id).map((p) => [p.venue_id, p]));
  return [...venues]
    .sort((a, b) => a.position - b.position)
    .map((venue) => {
      const p = mine.get(venue.id);
      let state: MyVenueState;
      if (venue.disabled) state = 'disabled';
      else if (venue.status === 'skipped') state = 'group_skipped';
      else if (venue.status === 'active') state = p?.status === 'skipped' ? 'active_skipped' : 'active';
      else if (venue.status === 'upcoming') state = p?.status === 'skipped' ? 'skipped' : 'upcoming';
      else if (p?.status === 'skipped') state = 'skipped';
      else if (p?.status === 'present') state = 'done';
      else if (
        member?.joined_late &&
        member.joined_venue_position != null &&
        venue.position < member.joined_venue_position
      )
        state = 'before_join';
      else state = 'missed';
      return { venue, state, participation: p };
    });
}

export function routeSummary(items: readonly VenueProgressItem[]) {
  const playable = items.filter((i) => i.state !== 'disabled');
  const finished = playable.filter((i) => ['done', 'skipped', 'missed', 'before_join', 'group_skipped'].includes(i.state)).length;
  const current = playable.find((i) => i.state === 'active' || i.state === 'active_skipped') ?? null;
  const next = playable.find((i) => i.state === 'upcoming' || (i.state === 'skipped' && i.venue.status === 'upcoming')) ?? null;
  const total = playable.length;
  return {
    total,
    finished,
    current,
    next,
    percent: total === 0 ? 0 : Math.round(((finished + (current ? 0.5 : 0)) / total) * 100),
  };
}

/** Directions link that needs no maps API: the organiser's link, coordinates, or an address search. */
export function directionsUrl(v: Pick<VenueRow, 'maps_url' | 'latitude' | 'longitude' | 'address' | 'name'>): string | null {
  if (v.maps_url && /^https:\/\//i.test(v.maps_url)) return v.maps_url;
  if (v.latitude != null && v.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${v.latitude},${v.longitude}`;
  }
  if (v.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${v.name}, ${v.address}`)}`;
  }
  return null;
}

/** Apple Maps alternative for iOS users. */
export function appleMapsUrl(v: Pick<VenueRow, 'latitude' | 'longitude' | 'address' | 'name'>): string | null {
  if (v.latitude != null && v.longitude != null) return `https://maps.apple.com/?daddr=${v.latitude},${v.longitude}`;
  if (v.address) return `https://maps.apple.com/?daddr=${encodeURIComponent(`${v.name}, ${v.address}`)}`;
  return null;
}
