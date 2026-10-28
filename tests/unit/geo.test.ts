import { describe, expect, it } from 'vitest';
import { coordsFromMapsUrl, formatDistance, haversine, legs, venueLatLng, walkingMinutes } from '@/features/map/geo';
import { stopsFromProgress, stopsFromVenues } from '@/features/map/stops';
import { venueProgress } from '@/features/venues/progress';
import type { VenueRow } from '@/lib/supabase/types';

describe('map geography', () => {
  it('reads coordinates from common maps links', () => {
    expect(coordsFromMapsUrl('https://www.google.com/maps/place/The+Crown/@51.5079,-0.0877,17z/data=!3m1!4b1!4m6!3m5!3d51.50812!4d-0.08765')).toEqual({ lat: 51.50812, lng: -0.08765 });
    expect(coordsFromMapsUrl('https://www.google.com/maps/@51.5079,-0.0877,17z')).toEqual({ lat: 51.5079, lng: -0.0877 });
    expect(coordsFromMapsUrl('https://maps.google.com/?q=53.3498,-6.2603')).toEqual({ lat: 53.3498, lng: -6.2603 });
    expect(coordsFromMapsUrl('https://maps.apple.com/?ll=-33.8688,151.2093&q=Pub')).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(coordsFromMapsUrl('https://www.openstreetmap.org/#map=18/55.9533/-3.1883')).toEqual({ lat: 55.9533, lng: -3.1883 });
    expect(coordsFromMapsUrl('https://www.google.com/maps/dir/?api=1&destination=51.1,-1.2')).toEqual({ lat: 51.1, lng: -1.2 });
    expect(coordsFromMapsUrl('https://maps.app.goo.gl/AbCdEf')).toBeNull();
    expect(coordsFromMapsUrl('https://x.test/?q=999,999')).toBeNull();
    expect(coordsFromMapsUrl(null)).toBeNull();
  });

  it('handles venue coordinates as strings (Postgres numeric) and rejects junk', () => {
    expect(venueLatLng({ latitude: '51.5', longitude: '-0.1' })).toEqual({ lat: 51.5, lng: -0.1 });
    expect(venueLatLng({ latitude: null, longitude: 1 })).toBeNull();
    expect(venueLatLng({ latitude: 0, longitude: 0 })).toBeNull();
  });

  it('measures distances and walking time', () => {
    const d = haversine({ lat: 51.5007, lng: -0.1246 }, { lat: 51.5014, lng: -0.1419 }); // Big Ben → Buckingham Palace ≈ 1.2 km
    expect(d).toBeGreaterThan(1150);
    expect(d).toBeLessThan(1250);
    expect(walkingMinutes(d)).toBeGreaterThanOrEqual(18);
    expect(walkingMinutes(d)).toBeLessThanOrEqual(21);
    expect(formatDistance(340)).toBe('340 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(legs([{ lat: 0.1, lng: 0.1 }, null, { lat: 0.2, lng: 0.2 }])).toEqual([null, null]);
  });

  it('builds map stops in route order with participant states', () => {
    const v = (id: string, position: number, status: VenueRow['status'], extra: Partial<VenueRow> = {}) =>
      ({ id, position, name: id, status, disabled: false, latitude: 51 + position / 100, longitude: -0.1, address: null, ...extra }) as VenueRow;
    const venues = [v('a', 0, 'completed'), v('b', 1, 'active'), v('c', 2, 'upcoming', { disabled: true }), v('d', 3, 'upcoming', { latitude: null })];
    const stops = stopsFromProgress(venueProgress(venues, [], { id: 'm', joined_late: false, joined_venue_position: null }));
    expect(stops.map((s) => [s.id, s.n, s.state, Boolean(s.at)])).toEqual([
      ['a', 1, 'skipped', true], // missed
      ['b', 2, 'active', true],
      ['d', 3, 'upcoming', false],
    ]);
    expect(stopsFromVenues(venues).map((s) => [s.id, s.n, s.state])).toEqual([
      ['a', 1, 'done'],
      ['b', 2, 'active'],
      ['c', 0, 'off'],
      ['d', 3, 'upcoming'],
    ]);
  });
});
