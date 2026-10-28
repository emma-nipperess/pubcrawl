import type { VenueProgressItem } from '@/features/venues/progress';
import type { VenueRow } from '@/lib/supabase/types';
import { venueLatLng } from './geo';
import type { MapStop, StopState } from './RouteMap';

export function stateForMap(s: VenueProgressItem['state']): StopState {
  if (s === 'active' || s === 'active_skipped') return 'active';
  if (s === 'done') return 'done';
  if (s === 'upcoming') return 'upcoming';
  if (s === 'disabled') return 'off';
  return 'skipped';
}

/** Participant view: numbered by route order, coloured by *my* progress. */
export function stopsFromProgress(items: VenueProgressItem[]): MapStop[] {
  const live = items.filter((i) => i.state !== 'disabled');
  return live.map((i, idx) => ({ id: i.venue.id, n: idx + 1, name: i.venue.name, at: venueLatLng(i.venue), state: stateForMap(i.state), sub: i.venue.address ?? undefined }));
}

/** Organiser view: coloured by the venue's own status. */
export function stopsFromVenues(venues: VenueRow[]): MapStop[] {
  let n = 0;
  return [...venues]
    .sort((a, b) => a.position - b.position)
    .map((v) => ({
      id: v.id,
      n: v.disabled ? 0 : ++n,
      name: v.name,
      at: venueLatLng(v),
      state: v.disabled ? 'off' : v.status === 'active' ? 'active' : v.status === 'completed' ? 'done' : v.status === 'skipped' ? 'skipped' : 'upcoming',
      sub: v.address ?? undefined,
    }));
}
