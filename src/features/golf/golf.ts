/** Pub golf helpers. Scoring itself happens in the database (get_golf_leaderboard). */

/** "E" for even, "−2", "+3". Uses a real minus sign so it reads well. */
export function formatToPar(n: number | null | undefined): string {
  if (n == null) return '–';
  const r = Math.round(Number(n) * 10) / 10;
  if (r === 0) return 'E';
  const s = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return r < 0 ? `−${s}` : `+${s}`;
}

export function holeResult(strokes: number, par: number): { label: string; tone: 'success' | 'info' | 'neutral' | 'warn' | 'danger' } {
  const d = strokes - par;
  if (strokes === 1) return { label: 'Hole in one!', tone: 'success' };
  if (d <= -3) return { label: 'Albatross', tone: 'success' };
  if (d === -2) return { label: 'Eagle', tone: 'success' };
  if (d === -1) return { label: 'Birdie', tone: 'success' };
  if (d === 0) return { label: 'Par', tone: 'info' };
  if (d === 1) return { label: 'Bogey', tone: 'neutral' };
  if (d === 2) return { label: 'Double bogey', tone: 'warn' };
  return { label: `+${d}`, tone: 'danger' };
}

export function holePar(venuePar: number | null | undefined, defaultPar: number | null | undefined): number {
  return venuePar ?? defaultPar ?? 3;
}

/**
 * Starter course for pub golf. Every hole works with a soft drink or water at
 * the same par; strokes are sips, never speed. Used to fill holes that don't
 * have a drink yet when an organiser switches to pub golf.
 */
export const GOLF_HOLES: { drink: string; par: number }[] = [
  { drink: 'Pint of anything — beer, cider or soft drink', par: 4 },
  { drink: 'Half pint or small soft drink', par: 2 },
  { drink: 'Glass of wine, juice or kombucha', par: 3 },
  { drink: 'Water — the hydration hole', par: 2 },
  { drink: 'Mocktail or cocktail', par: 3 },
  { drink: 'Bottle of beer or soft drink', par: 3 },
  { drink: 'Lemonade, cola or tonic', par: 3 },
  { drink: 'Hot drink or another water', par: 3 },
  { drink: 'Your choice — anything you fancy', par: 4 },
];

export const GOLF_SAFETY =
  'Any drink counts — swap for a soft drink or water at the same par whenever you like. Strokes are sips, not speed. Never pressure anyone, and get home safely.';
