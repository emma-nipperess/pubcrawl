import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerShell } from '@/features/play/PlayerShell';
import { useEventCtx } from '@/app/EventRoutes';
import { useLeaderboard, useVenues } from '@/lib/supabase/queries';
import { Banner, EmptyState, ErrorState, LoadingBlock, Segmented, Select } from '@/components/ui';
import { LeaderboardList } from './LeaderboardList';
import { rankMovements } from './rank';

export default function BoardPage() {
  const { event, theme } = useEventCtx();
  const [venue, setVenue] = useState<string>('');
  const board = useLeaderboard(event.id, venue || null);
  const venues = useVenues(event.id);
  const hasTeams = event.play_mode !== 'individual';
  const [tab, setTab] = useState<'teams' | 'people'>(hasTeams ? 'teams' : 'people');

  // remember the previous ranks on this device to show movement arrows
  const prev = useRef<{ teams: Map<string, number> | null; people: Map<string, number> | null }>({ teams: null, people: null });
  const [moves, setMoves] = useState<{ teams: ReturnType<typeof rankMovements>; people: ReturnType<typeof rankMovements> }>({ teams: new Map(), people: new Map() });
  useEffect(() => {
    if (!board.data || venue) return;
    const t = board.data.teams.map((r) => ({ id: r.team_id, rank: r.rank }));
    const p = board.data.individuals.map((r) => ({ id: r.member_id, rank: r.rank }));
    const key = `roundhouse-ranks-${event.id}`;
    if (!prev.current.teams) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (saved) prev.current = { teams: new Map(saved.teams), people: new Map(saved.people) };
      } catch {
        /* ignore */
      }
    }
    setMoves({ teams: rankMovements(prev.current.teams, t), people: rankMovements(prev.current.people, p) });
    const next = { teams: new Map(t.map((x) => [x.id, x.rank])), people: new Map(p.map((x) => [x.id, x.rank])) };
    // only advance the baseline when something actually changed
    const changed = [...next.teams].some(([k, v]) => prev.current.teams?.get(k) !== v) || [...next.people].some(([k, v]) => prev.current.people?.get(k) !== v);
    if (changed) {
      const old = prev.current;
      prev.current = next;
      if (old.teams) sessionStorage.setItem(key, JSON.stringify({ teams: [...next.teams], people: [...next.people] }));
      else sessionStorage.setItem(key, JSON.stringify({ teams: [...next.teams], people: [...next.people] }));
    }
  }, [board.data, venue, event.id]);

  const tieNote = useMemo(
    () => ({ shared: 'Equal scores share a position.', most_completed: 'Ties go to whoever completed more.', earliest: 'Ties go to whoever got there first.' })[event.tie_break],
    [event.tie_break],
  );

  return (
    <PlayerShell title={theme.vocab.leaderboard}>
      <h1 className="deco-title">{theme.vocab.leaderboard}</h1>
      {hasTeams && event.play_mode === 'both' && (
        <Segmented
          legend="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'teams', label: `${theme.vocab.team}s`, icon: 'users' },
            { value: 'people', label: 'Players', icon: 'pint' },
          ]}
        />
      )}
      {(venues.data?.length ?? 0) > 1 && (
        <Select label={`By ${theme.vocab.venue.toLowerCase()}`} value={venue} onChange={(e) => setVenue(e.target.value)}>
          <option value="">Whole crawl</option>
          {venues.data!.filter((v) => !v.disabled).map((v) => (
            <option key={v.id} value={v.id}>
              {v.position + 1}. {v.name}
            </option>
          ))}
        </Select>
      )}
      {board.isLoading ? (
        <LoadingBlock />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : board.data ? (
        <>
          {!board.data.visible && <Banner tone="info" icon="eye-off">The full board is hidden until the end. Here’s where you stand.</Banner>}
          {(tab === 'teams' && hasTeams ? board.data.teams : board.data.individuals).length === 0 ? (
            <EmptyState icon="trophy" title="No scores yet">Complete a {theme.vocab.challenge.toLowerCase()} to get on the board.</EmptyState>
          ) : tab === 'teams' && hasTeams ? (
            <LeaderboardList
              rows={board.data.teams.map((t) => ({ id: t.team_id, name: t.name, color: t.color, icon: t.icon, score: t.score, confirmed: t.confirmed, pending: t.pending, rank: t.rank, tied: t.tied, mine: t.is_mine, sub: `${t.size} ${t.size === 1 ? 'player' : 'players'} · ${t.completed} done` }))}
              moves={venue ? undefined : moves.teams}
              unit={theme.vocab.points}
              provisional={board.data.provisional_scoring}
            />
          ) : (
            <LeaderboardList
              rows={board.data.individuals.map((p) => ({ id: p.member_id, name: p.name, color: p.avatar_color, icon: p.avatar_icon, score: p.score, confirmed: p.confirmed, pending: p.pending, rank: p.rank, tied: p.tied, mine: p.is_me, sub: `${p.completed} done` }))}
              moves={venue ? undefined : moves.people}
              unit={theme.vocab.points}
              provisional={board.data.provisional_scoring}
            />
          )}
          <p className="xsmall muted">
            {tieNote} {board.data.provisional_scoring ? 'Pending proof counts provisionally (marked).' : 'Only approved proof counts.'} Updates live.
          </p>
        </>
      ) : null}
    </PlayerShell>
  );
}
