import { useMemo } from 'react';
import { useEventCtx } from '@/app/EventRoutes';
import { useChallenges, useLedger, useMySubmissions, useParticipation, useTeams, useVenues } from '@/lib/supabase/queries';
import { routeSummary, venueProgress } from '@/features/venues/progress';
import { buildScorecard } from '@/features/challenges/scorecard';

/** Everything a participant screen needs, derived from authoritative rows. */
export function useGame() {
  const ctx = useEventCtx();
  const { event, member, teamId } = ctx;
  const venues = useVenues(event.id);
  const challenges = useChallenges(event.id);
  const participation = useParticipation(event.id);
  const subs = useMySubmissions(event.id, member?.id, teamId);
  const ledger = useLedger(event.id, member?.id, teamId);
  const teams = useTeams(event.id);

  const progress = useMemo(() => venueProgress(venues.data ?? [], participation.data ?? [], member), [venues.data, participation.data, member]);
  const summary = useMemo(() => routeSummary(progress), [progress]);
  const mySubs = useMemo(() => (subs.data ?? []).filter((s) => s.member_id === member?.id), [subs.data, member?.id]);
  const teamSubs = useMemo(() => (subs.data ?? []).filter((s) => teamId && s.team_id === teamId && s.scope === 'team'), [subs.data, teamId]);
  const myLedger = useMemo(() => (ledger.data ?? []).filter((l) => l.member_id === member?.id), [ledger.data, member?.id]);
  const teamLedger = useMemo(() => (ledger.data ?? []).filter((l) => teamId && l.team_id === teamId), [ledger.data, teamId]);
  const myCard = useMemo(
    () =>
      buildScorecard({
        progress,
        challenges: (challenges.data ?? []).filter((c) => c.scope === 'individual' || (c.team_award_mode === 'team_and_members' && c.scope === 'team')),
        submissions: [...mySubs, ...(teamSubs.filter((s) => s.award_mode === 'team_and_members'))],
        ledger: myLedger,
      }),
    [progress, challenges.data, mySubs, teamSubs, myLedger],
  );
  const teamCard = useMemo(
    () => (teamId ? buildScorecard({ progress, challenges: challenges.data ?? [], submissions: (subs.data ?? []).filter((s) => s.team_id === teamId), ledger: teamLedger }) : null),
    [teamId, progress, challenges.data, subs.data, teamLedger],
  );
  const myTeam = teams.data?.teams.find((t) => t.id === teamId) ?? null;

  const loading = venues.isLoading || challenges.isLoading || participation.isLoading;
  const error = venues.error || challenges.error || participation.error;
  const refetch = () => {
    venues.refetch();
    challenges.refetch();
    participation.refetch();
    subs.refetch();
    ledger.refetch();
  };

  return { ...ctx, venues, challenges, participation, subs, teams, progress, summary, mySubs, teamSubs, myCard, teamCard, myTeam, loading, error, refetch };
}
