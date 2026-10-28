/**
 * Team generation. The organiser previews a plan on the device, can reshuffle
 * as often as they like, and only then applies it atomically through the
 * apply_team_plan RPC.
 */

export type Rng = () => number; // uniform in [0, 1)

/** Cryptographically strong RNG where available (falls back to Math.random). */
export const cryptoRng: Rng = () => {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  }
  return Math.random();
};

/** Unbiased Fisher–Yates shuffle (returns a new array). */
export function fisherYates<T>(items: readonly T[], rng: Rng = cryptoRng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ShuffleOptions {
  /** Exactly this many teams… */
  teamCount?: number;
  /** …or as many teams as needed so no team exceeds this size. */
  teamSize?: number;
  rng?: Rng;
}

export function resolveTeamCount(participants: number, opts: ShuffleOptions): number {
  if (participants <= 0) return Math.max(1, opts.teamCount ?? 1);
  if (opts.teamCount && opts.teamCount > 0) return Math.min(opts.teamCount, participants);
  if (opts.teamSize && opts.teamSize > 0) return Math.max(1, Math.ceil(participants / opts.teamSize));
  return Math.max(1, Math.min(participants, Math.round(Math.sqrt(participants))));
}

/**
 * Randomly split members into `n` teams whose sizes differ by at most one.
 * Members are shuffled, then dealt round-robin, and the order of teams that
 * receive the "extra" members is also randomised so team 1 isn't always biggest.
 */
export function shuffleIntoTeams<T>(members: readonly T[], opts: ShuffleOptions = {}): T[][] {
  const rng = opts.rng ?? cryptoRng;
  const n = resolveTeamCount(members.length, opts);
  const teams: T[][] = Array.from({ length: n }, () => []);
  const order = fisherYates(
    Array.from({ length: n }, (_, i) => i),
    rng,
  );
  fisherYates(members, rng).forEach((m, i) => teams[order[i % n]].push(m));
  return teams;
}

/**
 * Pick a team for a late joiner: the smallest team that still has room.
 * Ties are broken randomly so late arrivals spread out. Returns null if all
 * teams are full (organiser must create a new team or raise the limit).
 */
export function pickTeamForLateJoiner<T extends { id: string; size: number; maxSize?: number | null }>(
  teams: readonly T[],
  rng: Rng = cryptoRng,
): T | null {
  const open = teams.filter((t) => t.maxSize == null || t.size < t.maxSize);
  if (open.length === 0) return null;
  const min = Math.min(...open.map((t) => t.size));
  const smallest = open.filter((t) => t.size === min);
  return smallest[Math.floor(rng() * smallest.length)];
}

/** Largest minus smallest team size (0 or 1 means balanced). */
export function imbalance(teams: readonly unknown[][]): number {
  if (teams.length === 0) return 0;
  const sizes = teams.map((t) => t.length);
  return Math.max(...sizes) - Math.min(...sizes);
}
