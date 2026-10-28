/** Display formatting. Dates are stored as local date + local time + IANA zone. */

export function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  if (!d) return '';
  const [y, mo, da] = d.split('-').map(Number);
  if (!y) return '';
  return new Date(y, (mo || 1) - 1, da || 1).toLocaleDateString(undefined, opts);
}

export function formatEventWhen(e: { event_date: string | null; start_time: string | null; end_time?: string | null }): string {
  const parts = [formatDate(e.event_date), e.start_time ? `${formatTime(e.start_time)}${e.end_time ? `–${formatTime(e.end_time)}` : ''}` : ''];
  return parts.filter(Boolean).join(' · ');
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function pts(n: number, unit = 'pts'): string {
  return `${n > 0 ? '' : ''}${n} ${unit}`;
}
