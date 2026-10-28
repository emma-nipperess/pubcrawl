import type { ChallengeRow, LedgerRow, SubmissionRow, VenueRow } from '@/lib/supabase/types';
import type { VenueProgressItem } from '@/features/venues/progress';

export interface ScorecardVenueRow {
  venue: VenueRow;
  state: VenueProgressItem['state'];
  available: number; // points on offer (incl. bonus)
  earned: number; // confirmed points from the ledger for this venue
  bonus: number;
  penalties: number;
  completed: number;
  pending: number;
  rejected: number;
  missed: number; // required challenges not done at a venue that is over
  requiredTotal: number;
}

export interface Scorecard {
  rows: ScorecardVenueRow[];
  eventWide: { earned: number; completed: number };
  total: number; // confirmed (authoritative ledger sum)
  provisional: number;
  bonus: number;
  penalties: number;
  adjustments: number;
  completed: number;
  pending: number;
  rejected: number;
  missed: number;
  completionPercent: number;
}

/**
 * Builds a scorecard from rows the user is allowed to read. Totals come from
 * the trusted score ledger; submissions are only used for status counts.
 *
 * @param subject which ledger rows belong to this card (a member or a team)
 */
export function buildScorecard(args: {
  progress: readonly VenueProgressItem[];
  challenges: readonly ChallengeRow[];
  submissions: readonly SubmissionRow[]; // already filtered to this member/team
  ledger: readonly LedgerRow[]; // already filtered to this member/team
}): Scorecard {
  const { progress, challenges, submissions, ledger } = args;
  const live = challenges.filter((c) => !c.archived);
  const byChallenge = new Map<string, SubmissionRow[]>();
  for (const s of submissions) {
    if (s.status === 'withdrawn') continue;
    byChallenge.set(s.challenge_id, [...(byChallenge.get(s.challenge_id) ?? []), s]);
  }
  const statusOf = (c: ChallengeRow): 'done' | 'pending' | 'rejected' | 'none' => {
    const list = byChallenge.get(c.id) ?? [];
    if (list.some((s) => s.status === 'approved')) return 'done';
    if (list.some((s) => s.status === 'pending')) return 'pending';
    if (list.some((s) => s.status === 'rejected')) return 'rejected';
    return 'none';
  };
  const confirmed = ledger.filter((l) => !l.provisional);
  const sum = (rows: readonly LedgerRow[]) => rows.reduce((a, l) => a + l.points, 0);

  const rows: ScorecardVenueRow[] = progress
    .filter((p) => p.state !== 'disabled')
    .map((p) => {
      const cs = live.filter((c) => c.venue_id === p.venue.id);
      const statuses = cs.map((c) => ({ c, s: statusOf(c) }));
      const over = ['done', 'skipped', 'missed', 'group_skipped'].includes(p.state);
      const vLedger = confirmed.filter((l) => l.venue_id === p.venue.id);
      return {
        venue: p.venue,
        state: p.state,
        available: cs.reduce((a, c) => a + c.points + c.bonus_points, 0) + (p.venue.bonus_points ?? 0),
        earned: sum(vLedger),
        bonus: sum(vLedger.filter((l) => l.kind === 'bonus')),
        penalties: sum(vLedger.filter((l) => l.kind === 'penalty')),
        completed: statuses.filter((x) => x.s === 'done').length,
        pending: statuses.filter((x) => x.s === 'pending').length,
        rejected: statuses.filter((x) => x.s === 'rejected').length,
        missed: over ? statuses.filter((x) => x.c.required && x.s !== 'done' && x.s !== 'pending').length : 0,
        requiredTotal: cs.filter((c) => c.required).length,
      };
    });

  const eventWideChallenges = live.filter((c) => c.venue_id == null);
  const eventWideLedger = confirmed.filter((l) => l.venue_id == null && l.kind !== 'adjustment');
  const completed = rows.reduce((a, r) => a + r.completed, 0) + eventWideChallenges.filter((c) => statusOf(c) === 'done').length;
  const countable = rows.filter((r) => r.state !== 'before_join' && r.state !== 'group_skipped');
  const requiredCountable =
    countable.reduce((a, r) => a + r.requiredTotal, 0) + eventWideChallenges.filter((c) => c.required).length;
  const requiredDone =
    live.filter(
      (c) =>
        c.required &&
        statusOf(c) === 'done' &&
        (c.venue_id == null || countable.some((r) => r.venue.id === c.venue_id)),
    ).length;

  return {
    rows,
    eventWide: { earned: sum(eventWideLedger), completed: eventWideChallenges.filter((c) => statusOf(c) === 'done').length },
    total: sum(confirmed),
    provisional: sum(ledger.filter((l) => l.provisional)),
    bonus: sum(confirmed.filter((l) => l.kind === 'bonus')),
    penalties: sum(confirmed.filter((l) => l.kind === 'penalty')),
    adjustments: sum(confirmed.filter((l) => l.kind === 'adjustment')),
    completed,
    pending: rows.reduce((a, r) => a + r.pending, 0) + eventWideChallenges.filter((c) => statusOf(c) === 'pending').length,
    rejected: rows.reduce((a, r) => a + r.rejected, 0),
    missed: rows.reduce((a, r) => a + r.missed, 0),
    completionPercent: requiredCountable === 0 ? 0 : Math.round((requiredDone / requiredCountable) * 100),
  };
}
