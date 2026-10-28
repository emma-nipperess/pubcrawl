import { PlayerShell } from '@/features/play/PlayerShell';
import { useEventCtx } from '@/app/EventRoutes';
import { useChallenges, useFeed, useMembers, useTeams } from '@/lib/supabase/queries';
import { Button, Card, EmptyState, ErrorState, LoadingBlock } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ProofMedia } from './ProofMedia';
import { timeAgo } from '@/lib/format';

export default function FeedPage() {
  const { event, theme } = useEventCtx();
  const feed = useFeed(event.id);
  const members = useMembers(event.id);
  const challenges = useChallenges(event.id);
  const teams = useTeams(event.id);
  const rows = feed.data?.pages.flatMap((p) => p.rows) ?? [];
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';
  const titleOf = (id: string) => challenges.data?.find((c) => c.id === id)?.title ?? theme.vocab.challenge;
  const teamOf = (id: string | null) => teams.data?.teams.find((t) => t.id === id);

  return (
    <PlayerShell title="Moments">
      <h1 className="deco-title">Moments</h1>
      {!event.show_others_submissions && <p className="small muted">The organiser keeps other players’ photos private. You’ll see your own and your team’s.</p>}
      {feed.isLoading ? (
        <LoadingBlock />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="camera" title="Nothing yet">Completed {theme.vocab.challenges.toLowerCase()} show up here.</EmptyState>
      ) : (
        <ul className="list" style={{ gap: 'var(--s-4)' }}>
          {rows.map((s) => {
            const t = teamOf(s.team_id);
            return (
              <li key={s.id}>
                <Card className="stack-sm" style={{ padding: 'var(--s-3)' }}>
                  <div className="row-between">
                    <div style={{ minWidth: 0 }}>
                      <strong className="truncate" style={{ display: 'block' }}>
                        {s.scope === 'team' && t ? t.name : nameOf(s.member_id)}
                      </strong>
                      <span className="xsmall muted">
                        {titleOf(s.challenge_id)} · {timeAgo(s.created_at)}
                      </span>
                    </div>
                    <span className="badge badge--brass">
                      +{s.points_awarded + s.bonus_awarded}
                    </span>
                  </div>
                  {s.submission_media.length > 0 && (
                    <div className={s.submission_media.length > 1 ? 'media-grid' : ''}>
                      {s.submission_media.map((m) => (
                        <ProofMedia key={m.id} media={m} alt={`${titleOf(s.challenge_id)} by ${nameOf(s.member_id)}`} />
                      ))}
                    </div>
                  )}
                  {s.caption && <p className="prewrap">{s.caption}</p>}
                  {s.text_response && !s.submission_media.length && (
                    <p className="prewrap small">
                      <Icon name="message-square" size={14} /> {s.text_response}
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {feed.hasNextPage && (
        <Button block loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
          Load more
        </Button>
      )}
    </PlayerShell>
  );
}
