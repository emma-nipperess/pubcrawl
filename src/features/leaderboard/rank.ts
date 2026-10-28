/**
 * Display helpers for leaderboards. Ranks themselves are computed by the
 * database (get_leaderboard); these functions only format them and track
 * movement between refreshes on this device.
 */

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "=2" for shared ranks, "2" otherwise. */
export function rankLabel(rank: number, tied: boolean): string {
  return tied ? `=${rank}` : String(rank);
}

export type Movement = { kind: 'up' | 'down' | 'same' | 'new'; by: number };

/** Compare two ranked snapshots keyed by id. Lower rank number = better. */
export function rankMovements(prev: ReadonlyMap<string, number> | null, next: ReadonlyArray<{ id: string; rank: number }>): Map<string, Movement> {
  const out = new Map<string, Movement>();
  for (const row of next) {
    const before = prev?.get(row.id);
    if (prev == null) out.set(row.id, { kind: 'same', by: 0 });
    else if (before == null) out.set(row.id, { kind: 'new', by: 0 });
    else if (row.rank < before) out.set(row.id, { kind: 'up', by: before - row.rank });
    else if (row.rank > before) out.set(row.id, { kind: 'down', by: row.rank - before });
    else out.set(row.id, { kind: 'same', by: 0 });
  }
  return out;
}

/**
 * Reference implementation of the database's ranking rule (standard
 * competition ranking: 1, 1, 3) used in tests and for client-side subsets
 * such as a single team's members.
 */
export function competitionRank<T>(rows: readonly T[], score: (r: T) => number, tiebreak?: (a: T, b: T) => number): (T & { rank: number; tied: boolean })[] {
  const sorted = [...rows].sort((a, b) => score(b) - score(a) || (tiebreak ? tiebreak(a, b) : 0));
  const ranked = sorted.map((r) => ({ ...r, rank: 0, tied: false }));
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    const same = prev && score(prev) === score(r) && (!tiebreak || tiebreak(prev, r) === 0);
    r.rank = same ? prev.rank : i + 1;
  });
  const counts = new Map<number, number>();
  ranked.forEach((r) => counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1));
  ranked.forEach((r) => (r.tied = (counts.get(r.rank) ?? 0) > 1));
  return ranked;
}
