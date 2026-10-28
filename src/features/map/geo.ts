/**
 * Free, key-less geography helpers. Distances are straight-line ("as the
 * crow flies"); no routing service is used.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Pull coordinates out of a pasted Google / Apple / OpenStreetMap link, so
 * organisers don't need to type them. Short links (maps.app.goo.gl) can't be
 * expanded from the browser — the address search fallback covers those.
 */
export function coordsFromMapsUrl(url: string | null | undefined): LatLng | null {
  if (!url) return null;
  let s: string;
  try {
    s = decodeURIComponent(url);
  } catch {
    s = url;
  }
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`), // Google place data (most precise)
    new RegExp(`@${num},${num}`), // Google viewport
    new RegExp(`[?&](?:q|ll|daddr|destination|query|center|sll)=${num},\\s*${num}`), // Google / Apple query params
    new RegExp(`#map=\\d+/${num}/${num}`), // openstreetmap.org
    new RegExp(`[?&]mlat=${num}&mlon=${num}`), // openstreetmap.org marker
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

export function venueLatLng(v: { latitude?: number | string | null; longitude?: number | string | null }): LatLng | null {
  if (v.latitude == null || v.longitude == null || v.latitude === '' || v.longitude === '') return null;
  const lat = Number(v.latitude);
  const lng = Number(v.longitude);
  return valid(lat, lng) ? { lat, lng } : null;
}

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Leg distances between consecutive points (null where either end is unknown). */
export function legs(points: (LatLng | null)[]): (number | null)[] {
  return points.slice(1).map((p, i) => (p && points[i] ? haversine(points[i]!, p) : null));
}

/** Walking estimate: straight-line distance × 1.3 detour factor at ~4.8 km/h. */
export function walkingMinutes(metres: number): number {
  return Math.max(1, Math.round(((metres * 1.3) / 4800) * 60));
}

export function formatDistance(metres: number): string {
  if (metres < 950) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/**
 * Address → coordinates via OpenStreetMap Nominatim (free, no key). Only
 * called when an organiser presses a button; their usage policy allows light
 * use (max 1 request/second), so batch lookups are spaced out.
 */
export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<(LatLng & { label: string }) | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json', 'Accept-Language': navigator.language || 'en' } });
  if (res.status === 429) throw new Error('The free address search is busy — wait a few seconds and try again.');
  if (!res.ok) throw new Error('Address search failed. You can place the pin on the map instead.');
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const r = rows[0];
  if (!r) return null;
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  return valid(lat, lng) ? { lat, lng, label: r.display_name } : null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
