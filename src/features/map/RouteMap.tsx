import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from './geo';

/**
 * Free map: Leaflet + OpenStreetMap raster tiles (no API key). Tile server
 * and attribution can be swapped via VITE_MAP_TILE_URL / VITE_MAP_ATTRIBUTION
 * (e.g. a self-hosted or commercial-free provider) without code changes.
 */
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type StopState = 'done' | 'active' | 'upcoming' | 'skipped' | 'off';

export interface MapStop {
  id: string;
  n: number;
  name: string;
  at: LatLng | null;
  state: StopState;
  sub?: string;
}

function baseMap(el: HTMLElement, dark: boolean) {
  const map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
    zoomAnimation: !reduceMotion(),
    fadeAnimation: !reduceMotion(),
    markerZoomAnimation: !reduceMotion(),
    scrollWheelZoom: false, // don't hijack page scrolling; pinch / buttons still zoom
    tapHold: true,
  });
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, crossOrigin: true, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
  el.classList.toggle('map--dark', dark);
  return map;
}

function stopIcon(s: MapStop) {
  return L.divIcon({
    className: 'map-stop-wrap',
    html: `<span class="map-stop map-stop--${s.state}">${s.state === 'done' ? '✓' : String(s.n)}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -20],
  });
}

/** Read-only route map: numbered stops, path in order, current stop highlighted. */
export default function RouteMap({ stops, dark, onSelect, selectedId, height = 320, meLocation }: { stops: MapStop[]; dark?: boolean; onSelect?: (id: string) => void; selectedId?: string | null; height?: number; meLocation?: LatLng | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const meLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef('');

  useEffect(() => {
    if (!el.current) return;
    map.current = baseMap(el.current, Boolean(dark));
    layer.current = L.layerGroup().addTo(map.current);
    meLayer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [dark]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const placed = stops.filter((s) => s.at && s.state !== 'off');
    const css = getComputedStyle(el.current!);
    const accent = css.getPropertyValue('--c-accent').trim() || '#b8401b';
    const ink = css.getPropertyValue('--c-ink').trim() || '#1d2a26';

    // path: walked legs solid, the rest dashed
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1];
      const b = placed[i];
      const walked = a.state === 'done' || a.state === 'skipped' ? b.state !== 'upcoming' : false;
      L.polyline([a.at!, b.at!], { color: walked ? ink : accent, weight: walked ? 4 : 4, opacity: walked ? 0.55 : 0.9, dashArray: walked ? undefined : '8 10', interactive: false }).addTo(g);
    }
    for (const s of placed) {
      const marker = L.marker(s.at!, { icon: stopIcon(s), keyboard: true, title: `${s.n}. ${s.name}`, alt: `${s.n}. ${s.name}`, zIndexOffset: s.state === 'active' ? 1000 : 0, riseOnHover: true });
      // user text goes in via textContent, never as HTML
      const tip = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${s.n}. ${s.name}`;
      tip.appendChild(strong);
      if (s.sub) {
        const sub = document.createElement('div');
        sub.textContent = s.sub;
        tip.appendChild(sub);
      }
      marker.bindTooltip(tip, { direction: 'top', permanent: s.state === 'active' || s.id === selectedId, className: 'map-tip' });
      if (onSelect) marker.on('click keypress', () => onSelect(s.id));
      marker.addTo(g);
    }
    // re-fit only when the set of placed stops changes (not on every status update)
    const sig = placed.map((s) => `${s.id}:${s.at!.lat},${s.at!.lng}`).join('|');
    if (sig !== fitted.current) {
      fitted.current = sig;
      if (placed.length === 1) m.setView(placed[0].at!, 16);
      else if (placed.length > 1) m.fitBounds(L.latLngBounds(placed.map((s) => s.at!)), { padding: [36, 36], maxZoom: 17 });
      else m.setView([51.505, -0.09], 3);
    }
  }, [stops, onSelect, selectedId]);

  useEffect(() => {
    const m = map.current;
    const sel = stops.find((s) => s.id === selectedId && s.at);
    if (m && sel) m.panTo(sel.at!, { animate: !reduceMotion() });
  }, [selectedId, stops]);

  useEffect(() => {
    const g = meLayer.current;
    if (!g) return;
    g.clearLayers();
    if (meLocation) L.circleMarker(meLocation, { radius: 8, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1 }).bindTooltip('You').addTo(g);
  }, [meLocation]);

  return <div ref={el} className="route-map" style={{ height }} role="region" aria-label="Map of the crawl route" />;
}

/** Tap (or drag the pin) to set a venue's location. */
export function PinPicker({ value, onChange, dark, height = 240 }: { value: LatLng | null; onChange: (p: LatLng) => void; dark?: boolean; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const m = baseMap(el.current, Boolean(dark));
    map.current = m;
    m.setView(value ?? [51.505, -0.09], value ? 17 : 3);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }));
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker(value, { draggable: true, icon: L.divIcon({ className: 'map-stop-wrap', html: '<span class="map-stop map-stop--active">●</span>', iconSize: [36, 36], iconAnchor: [18, 18] }), title: 'Venue location — drag to adjust' }).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        cb.current({ lat: round(p.lat), lng: round(p.lng) });
      });
      m.setView(value, Math.max(m.getZoom(), 16));
    } else {
      marker.current.setLatLng(value);
    }
  }, [value]);

  return <div ref={el} className="route-map" style={{ height, cursor: 'crosshair' }} role="region" aria-label="Map: tap to place the venue" />;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
