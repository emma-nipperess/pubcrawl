import { Link } from 'react-router-dom';
import { PlayerShell } from './PlayerShell';
import { useEventCtx } from '@/app/EventRoutes';
import { useAchievements, useFeed, useGolfBoard, useLeaderboard, useMembers } from '@/lib/supabase/queries';
import { formatToPar } from '@/features/golf/golf';
import { golfPersonRow, golfTeamRow } from '@/features/golf/golfRows';
import { Card, EmptyState, ErrorState, LoadingBlock } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ThemeMotif } from '@/features/themes/ThemeScope';
import { LeaderboardList } from '@/features/leaderboard/LeaderboardList';
import { ProofMedia } from '@/features/media/ProofMedia';
import { rankLabel } from '@/features/leaderboard/rank';

export default function ResultsPage() {
  const { event, theme } = useEventCtx();
  const golf = event.game_mode === 'golf';
  const board = useLeaderboard(event.id);
  const golfBoard = useGolfBoard(event.id, golf);
  const ach = useAchievements(event.id);
  const members = useMembers(event.id);
  const feed = useFeed(event.id);
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';

  if (board.isLoading || (golf && golfBoard.isLoading))
    return (
      <PlayerShell>
        <LoadingBlock />
      </PlayerShell>
    );
  if (board.isError || !board.data)
    return (
      <PlayerShell>
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      </PlayerShell>
    );

  const b = board.data;
  const gb = golf ? golfBoard.data : undefined;
  const golfWinners = gb ? (gb.teams.some((t) => t.rank === 1) ? gb.teams.map(golfTeamRow) : gb.individuals.map(golfPersonRow)).filter((r) => r.rank === 1) : [];
  const winners = golf
    ? golfWinners.map((w) => ({ name: w.name, score: w.display ?? '' }))
    : (b.teams.length ? b.teams : b.individuals).filter((r) => r.rank === 1).map((w) => ({ name: w.name, score: `${w.score} ${theme.vocab.points}` }));
  const meCrawl = b.individuals.find((r) => r.is_me);
  const meGolf = gb?.individuals.find((r) => r.is_me);
  const highlights = (feed.data?.pages[0]?.rows ?? []).filter((s) => s.submission_media.length).slice(0, 6);
  const defs = new Map((ach.data?.defs ?? []).map((d) => [d.id, d]));

  return (
    <PlayerShell title="Final results">
      <section className="hero-band center stack" style={{ padding: 'var(--s-8) var(--s-5)' }}>
        <ThemeMotif motif={theme.motif} />
        <span className="eyebrow">{event.status === 'cancelled' ? 'Cancelled' : 'That’s a wrap'}</span>
        <h1 className="deco-title" style={{ fontSize: 'var(--fs-3xl)' }}>
          {event.name}
        </h1>
        {(golf ? gb?.visible : b.visible) && winners.length > 0 ? (
          <div className="stack-sm">
            <span className="mat" style={{ width: 120, margin: '0 auto', background: 'var(--c-accent-2)', color: 'var(--c-accent-2-ink)' }}>
              <Icon name="trophy" size={48} />
            </span>
            <p className="small">{winners.length > 1 ? 'Joint winners' : 'Winner'}</p>
            <h2 className="deco-title">{winners.map((w) => w.name).join(' & ')}</h2>
            <p className="score-big">{winners[0].score}</p>
          </div>
        ) : (
          <p>Thanks for playing!</p>
        )}
        {!golf && meCrawl && (
          <p className="small">
            You finished <strong>{rankLabel(meCrawl.rank, meCrawl.tied)}</strong> with <strong>{meCrawl.score}</strong> {theme.vocab.points}.
          </p>
        )}
        {golf && meGolf?.rank && (
          <p className="small">
            You finished <strong>{rankLabel(meGolf.rank, meGolf.tied)}</strong> at <strong>{formatToPar(meGolf.to_par)}</strong> ({meGolf.strokes} strokes over {meGolf.thru} holes).
          </p>
        )}
      </section>

      {gb && gb.teams.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">{theme.vocab.team} rankings</h2>
          <LeaderboardList rows={gb.teams.map(golfTeamRow)} unit="to par" provisional={false} />
        </section>
      )}
      {gb && (
        <section className="stack-sm">
          <h2 className="section-title">Players</h2>
          <LeaderboardList rows={gb.individuals.map(golfPersonRow)} unit="to par" provisional={false} />
        </section>
      )}
      {!golf && b.teams.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">{theme.vocab.team} rankings</h2>
          <LeaderboardList rows={b.teams.map((t) => ({ id: t.team_id, name: t.name, color: t.color, icon: t.icon, score: t.score, confirmed: t.confirmed, pending: t.pending, rank: t.rank, tied: t.tied, mine: t.is_mine }))} unit={theme.vocab.points} provisional={b.provisional_scoring} />
        </section>
      )}
      {!golf && (
      <section className="stack-sm">
        <h2 className="section-title">Players</h2>
        {b.individuals.length === 0 ? (
          <EmptyState title="No players">No individual scores.</EmptyState>
        ) : (
          <LeaderboardList rows={b.individuals.map((p) => ({ id: p.member_id, name: p.name, color: p.avatar_color, icon: p.avatar_icon, score: p.score, confirmed: p.confirmed, pending: p.pending, rank: p.rank, tied: p.tied, mine: p.is_me }))} unit={theme.vocab.points} provisional={b.provisional_scoring} />
        )}
      </section>
      )}

      {(ach.data?.awards.length ?? 0) > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">Badges</h2>
          <div className="grid-2">
            {ach.data!.awards.slice(0, 8).map((a) => (
              <Card key={a.id} className="card--tight stack-sm center">
                <Icon name={defs.get(a.achievement_id)?.icon ?? 'star'} size={28} />
                <strong>{defs.get(a.achievement_id)?.title}</strong>
                <span className="small muted">{nameOf(a.member_id)}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {highlights.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">
            Highlights <Link to="../feed" relative="path" className="small">All moments</Link>
          </h2>
          <div className="media-grid">
            {highlights.flatMap((s) => s.submission_media.slice(0, 1).map((m) => <ProofMedia key={m.id} media={m} alt={`Highlight from ${nameOf(s.member_id)}`} />))}
          </div>
        </section>
      )}
      <p className="xsmall muted center">
        Photos and videos are kept for {event.media_retention_days} days after the event, then the organiser deletes them.
      </p>
    </PlayerShell>
  );
}
