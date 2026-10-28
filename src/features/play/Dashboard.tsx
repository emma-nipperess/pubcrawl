import { Link, Navigate } from 'react-router-dom';
import { PlayerShell } from './PlayerShell';
import { useGame } from './useGame';
import { Avatar, Banner, Card, EmptyState, ErrorState, LinkButton, LoadingBlock } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ThemeMotif } from '@/features/themes/ThemeScope';
import { useAchievements, useAnnouncements, useLeaderboard, useMembers } from '@/lib/supabase/queries';
import { appleMapsUrl, directionsUrl, type VenueProgressItem } from '@/features/venues/progress';
import { formatEventWhen, formatTime, timeAgo } from '@/lib/format';
import { rankLabel } from '@/features/leaderboard/rank';
import { challengeState } from '@/features/challenges/meta';
import { RouteStrip } from './RouteStrip';
import { AnnouncementCard } from './AnnouncementCard';
import { isOver } from '@/features/events/status';

export default function Dashboard() {
  const g = useGame();
  const { event, theme, member, myTeam } = g;
  const board = useLeaderboard(event.id);
  const ann = useAnnouncements(event.id);
  const ach = useAchievements(event.id);
  const members = useMembers(event.id);

  if (isOver(event.status) && event.status !== 'cancelled') return <Navigate to="results" replace />;

  if (g.loading)
    return (
      <PlayerShell>
        <LoadingBlock />
      </PlayerShell>
    );
  if (g.error)
    return (
      <PlayerShell>
        <ErrorState error={g.error} onRetry={g.refetch} />
      </PlayerShell>
    );

  const current = g.summary.current;
  const me = board.data?.individuals.find((r) => r.is_me);
  const myTeamRow = board.data?.teams.find((t) => t.is_mine);
  const currentChallenges = current ? (g.challenges.data ?? []).filter((c) => c.venue_id === current.venue.id) : [];
  const remaining = currentChallenges.filter((c) => {
    const st = challengeState(c, g.mySubs, g.teamSubs).state;
    return st === 'open' || st === 'resubmit' || st === 'rejected';
  });
  const pinned = (ann.data ?? []).slice(0, 2);
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';
  const defs = new Map((ach.data?.defs ?? []).map((d) => [d.id, d]));

  return (
    <PlayerShell>
      {event.status === 'cancelled' && <Banner tone="danger" title="This crawl was cancelled">Check with {event.organiser_name} for details.</Banner>}
      {event.status === 'paused' && <Banner tone="warn" icon="pause" title="Paused">The organiser has paused the crawl. Submissions reopen when it resumes.</Banner>}

      <section className="hero-band" style={{ padding: 'var(--s-5)' }}>
        <ThemeMotif motif={theme.motif} />
        <div className="stack-sm" style={{ maxWidth: '78%' }}>
          <span className="eyebrow">{event.status === 'published' ? 'Starts soon' : event.status === 'in_progress' ? 'Live now' : ''}</span>
          <h1 className="deco-title" style={{ fontSize: 'var(--fs-2xl)' }}>
            {event.name}
          </h1>
          {event.theme_custom?.tagline && <p className="small">{event.theme_custom.tagline}</p>}
          <div className="row-wrap">
            {member && <Avatar name={member.display_name} color={member.avatar_color} icon={member.avatar_icon} size="sm" />}
            <strong className="small">{member?.display_name}</strong>
            {myTeam && (
              <span className="badge" style={{ background: myTeam.color, color: '#111', borderColor: 'transparent' }}>
                <Icon name={myTeam.icon} size={14} />
                {myTeam.name}
              </span>
            )}
          </div>
        </div>
      </section>

      {pinned.map((a) => (
        <AnnouncementCard key={a.id} a={a} />
      ))}

      {event.status === 'published' && (
        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>See you there</h2>
          {formatEventWhen(event) && (
            <p className="row" style={{ gap: 8 }}>
              <Icon name="calendar" /> {formatEventWhen(event)}
            </p>
          )}
          {event.start_location && (
            <p className="row" style={{ gap: 8 }}>
              <Icon name="map-pin" /> {event.start_location}
            </p>
          )}
          {event.meeting_instructions && <p className="small muted prewrap">{event.meeting_instructions}</p>}
          {event.play_mode !== 'individual' && !myTeam && (
            <p className="small">
              <Icon name="shuffle" size={14} /> {event.team_selection === 'self' || event.allow_self_teams ? `Pick or start a ${theme.vocab.team.toLowerCase()} on the Card tab.` : `${event.organiser_name} will put you in a ${theme.vocab.team.toLowerCase()} before the start.`}
            </p>
          )}
        </Card>
      )}

      {current && (
        <CurrentVenueCard item={current} remaining={remaining.length} total={currentChallenges.length} vocab={theme.vocab} eventId={event.id} paused={event.status === 'paused'} />
      )}
      {event.status === 'in_progress' && !current && (
        <Card className="card--muted">
          <p className="row">
            <Icon name="footprints" /> On the move — the next {theme.vocab.venue.toLowerCase()} opens when the organiser says go.
          </p>
        </Card>
      )}

      <RouteStrip progress={g.progress} vocab={theme.vocab} mapHref={`/e/${event.id}/route`} />

      <section className="grid-2" aria-label="Scores">
        <Link to="card" className="card-link">
          <Card className="stack-sm">
            <span className="eyebrow">You</span>
            <span className="score-big">
              {me?.score ?? g.myCard.total}
              <span className="small muted"> {theme.vocab.points}</span>
            </span>
            <span className="small muted">
              {me ? `${rankLabel(me.rank, me.tied)} of ${board.data?.individuals.length}` : `${g.myCard.completed} done`}
              {me && me.pending > 0 ? ` · +${me.pending} pending` : ''}
            </span>
          </Card>
        </Link>
        {myTeam ? (
          <Link to="board" className="card-link">
            <Card className="stack-sm" style={{ borderColor: myTeam.color }}>
              <span className="eyebrow">{myTeam.name}</span>
              <span className="score-big">
                {myTeamRow?.score ?? g.teamCard?.total ?? 0}
                <span className="small muted"> {theme.vocab.points}</span>
              </span>
              <span className="small muted">{myTeamRow ? `${rankLabel(myTeamRow.rank, myTeamRow.tied)} of ${board.data?.teams.length}` : ''}</span>
            </Card>
          </Link>
        ) : (
          <Link to="board" className="card-link">
            <Card className="stack-sm">
              <span className="eyebrow">Progress</span>
              <span className="score-big">{g.summary.percent}%</span>
              <span className="small muted">
                {g.summary.finished} of {g.summary.total} {theme.vocab.venues.toLowerCase()}
              </span>
            </Card>
          </Link>
        )}
      </section>

      {board.data && board.data.visible && (board.data.teams.length > 0 || board.data.individuals.length > 0) && (
        <section className="stack-sm" aria-labelledby="top-h">
          <h2 id="top-h" className="section-title">
            {theme.vocab.leaderboard}
            <Link to="board" className="small">
              See all
            </Link>
          </h2>
          <ol className="list">
            {(board.data.teams.length > 0 ? board.data.teams : board.data.individuals).slice(0, 3).map((r) => {
              const id = 'team_id' in r && 'size' in r ? r.team_id : (r as { member_id: string }).member_id;
              return (
                <li key={id} className={['list-row', ('is_mine' in r && r.is_mine) || ('is_me' in r && r.is_me) ? 'list-row--me' : ''].join(' ')}>
                  <span className={`rank ${r.rank === 1 ? 'rank--1' : ''}`}>{rankLabel(r.rank, r.tied)}</span>
                  <strong className="grow truncate">{r.name}</strong>
                  <span className="num" style={{ fontWeight: 800 }}>
                    {r.score}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {(ach.data?.awards.length ?? 0) > 0 && (
        <section className="stack-sm" aria-labelledby="ach-h">
          <h2 id="ach-h" className="section-title">
            Latest badges
          </h2>
          <ul className="list">
            {ach.data!.awards.slice(0, 4).map((a) => {
              const d = defs.get(a.achievement_id);
              return (
                <li key={a.id} className="list-row">
                  <span className="avatar" style={{ background: 'var(--c-accent-2)' }}>
                    <Icon name={d?.icon ?? 'star'} />
                  </span>
                  <span className="grow">
                    <strong>{nameOf(a.member_id)}</strong> earned <strong>{d?.title}</strong>
                    <span className="xsmall muted" style={{ display: 'block' }}>
                      {timeAgo(a.created_at)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(ann.data?.length ?? 0) > 2 && (
        <details>
          <summary className="btn btn--ghost btn--sm" style={{ display: 'inline-flex' }}>
            <Icon name="megaphone" /> Older announcements
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            {ann.data!.slice(2).map((a) => (
              <AnnouncementCard key={a.id} a={a} />
            ))}
          </div>
        </details>
      )}

      {g.progress.length === 0 && <EmptyState icon="route" title="No route yet">The organiser is still planning. Check back soon.</EmptyState>}
      <p className="xsmall muted center">
        <Icon name="heart" size={12} /> Look after each other. Water and soft drinks count for every challenge. Never drink and drive.
      </p>
      <LeaveLink />
    </PlayerShell>
  );
}

function CurrentVenueCard({ item, remaining, total, vocab, eventId, paused }: { item: VenueProgressItem; remaining: number; total: number; vocab: { venue: string; challenges: string }; eventId: string; paused: boolean }) {
  const v = item.venue;
  const dir = directionsUrl(v);
  const apple = appleMapsUrl(v);
  const skipped = item.state === 'active_skipped';
  return (
    <Card className="card--accent stack" aria-labelledby="cur-h">
      <span className="card__ribbon">Now</span>
      <div>
        <span className="eyebrow" style={{ color: 'inherit', opacity: 0.85 }}>
          {vocab.venue} {v.position + 1}
        </span>
        <h2 id="cur-h" className="deco-title" style={{ fontSize: 'var(--fs-xl)' }}>
          {v.name}
        </h2>
        {v.address && <p className="small">{v.address}</p>}
        {(v.arrive_at || v.depart_at) && (
          <p className="small">
            <Icon name="clock" size={14} /> {formatTime(v.arrive_at)}
            {v.depart_at ? ` – ${formatTime(v.depart_at)}` : ''}
          </p>
        )}
        {v.meeting_instructions && <p className="small prewrap">{v.meeting_instructions}</p>}
      </div>
      {skipped ? (
        <Banner tone="warn" title="You’re skipping this one">
          Changed your mind? Rejoin from the {vocab.challenges.toLowerCase()} screen.
        </Banner>
      ) : (
        <LinkButton to={`/e/${eventId}/play/${v.id}`} variant="secondary" size="lg" block icon="target" aria-disabled={paused}>
          {total === 0 ? `Open ${vocab.venue.toLowerCase()}` : remaining === 0 ? `All ${total} done — view` : `${remaining} of ${total} ${vocab.challenges.toLowerCase()} to go`}
        </LinkButton>
      )}
      <div className="row-wrap">
        {dir && (
          <a className="btn btn--sm" href={dir} target="_blank" rel="noopener noreferrer">
            <Icon name="navigation" /> Directions
          </a>
        )}
        <Link className="btn btn--sm btn--ghost" style={{ color: 'inherit' }} to={`/e/${eventId}/route`}>
          <Icon name="map-pin" /> Route map
        </Link>
        {apple && !v.maps_url && (
          <a className="btn btn--sm btn--ghost" style={{ color: 'inherit' }} href={apple} target="_blank" rel="noopener noreferrer">
            Apple Maps
          </a>
        )}
      </div>
    </Card>
  );
}

function LeaveLink() {
  const { event, isOwner } = useGame();
  if (isOwner) return null;
  return (
    <div className="center">
      <LinkButton to={`/e/${event.id}/card#leave`} variant="ghost" size="sm">
        Leave or manage my data
      </LinkButton>
    </div>
  );
}

