/**
 * "Recently visited" list for the landing page. Stores only the event id,
 * name, theme and the viewer's role — never private event content. Access is
 * re-checked by RLS when an event is opened. Cleared on sign-out.
 */
export interface RecentEvent {
  id: string;
  name: string;
  theme_key: string;
  role: 'organiser' | 'co_organiser' | 'participant';
  at: number;
}

const KEY = 'roundhouse-recent';

export function getRecent(): RecentEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentEvent[]) : [];
    return Array.isArray(list) ? list.filter((r) => typeof r?.id === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberEvent(e: Omit<RecentEvent, 'at'>) {
  try {
    const list = getRecent().filter((r) => r.id !== e.id);
    list.unshift({ ...e, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export function forgetEvent(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecent().filter((r) => r.id !== id)));
  } catch {
    /* ignore */
  }
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
