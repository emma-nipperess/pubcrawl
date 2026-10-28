import { Link } from 'react-router-dom';
import { PlayerShell } from './PlayerShell';
import { useEventCtx } from '@/app/EventRoutes';
import { useAchievements, useFeed, useLeaderboard, useMembers } from '@/lib/supabase/queries';
import { Card, EmptyState, ErrorState, LoadingBlock } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ThemeMotif } from '@/features/themes/ThemeScope';
import { LeaderboardList } from '@/features/leaderboard/LeaderboardList';
import { ProofMedia } from '@/features/media/ProofMedia';
import { rankLabel } from '@/features/leaderboard/rank';

export default function ResultsPage() {
  const { event, theme } = useEventCtx();
  const board = useLeaderboard(event.id);
  const ach = useAchievements(event.id);
  const members = useMembers(event.id);
  const feed = useFeed(event.id);
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';

  if (board.isLoading)
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
  const winners = (b.teams.length ? b.teams : b.individuals).filter((r) => r.rank === 1);
  const me = b.individuals.find((r) => r.is_me);
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
        {b.visible && winners.length > 0 ? (
          <div className="stack-sm">
            <span className="mat" style={{ width: 120, margin: '0 auto', background: 'var(--c-accent-2)', color: 'var(--c-accent-2-ink)' }}>
              <Icon name="trophy" size={48} />
            </span>
            <p className="small">{winners.length > 1 ? 'Joint winners' : 'Winner'}</p>
            <h2 className="deco-title">{winners.map((w) => w.name).join(' & ')}</h2>
            <p className="score-big">
              {winners[0].score} {theme.vocab.points}
            </p>
          </div>
        ) : (
          <p>Thanks for playing!</p>
        )}
        {me && (
          <p className="small">
            You finished <strong>{rankLabel(me.rank, me.tied)}</strong> with <strong>{me.score}</strong> {theme.vocab.points}.
          </p>
        )}
      </section>

      {b.teams.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">{theme.vocab.team} rankings</h2>
          <LeaderboardList rows={b.teams.map((t) => ({ id: t.team_id, name: t.name, color: t.color, icon: t.icon, score: t.score, confirmed: t.confirmed, pending: t.pending, rank: t.rank, tied: t.tied, mine: t.is_mine }))} unit={theme.vocab.points} provisional={b.provisional_scoring} />
        </section>
      )}
      <section className="stack-sm">
        <h2 className="section-title">Players</h2>
        {b.individuals.length === 0 ? (
          <EmptyState title="No players">No individual scores.</EmptyState>
        ) : (
          <LeaderboardList rows={b.individuals.map((p) => ({ id: p.member_id, name: p.name, color: p.avatar_color, icon: p.avatar_icon, score: p.score, confirmed: p.confirmed, pending: p.pending, rank: p.rank, tied: p.tied, mine: p.is_me }))} unit={theme.vocab.points} provisional={b.provisional_scoring} />
        )}
      </section>

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
