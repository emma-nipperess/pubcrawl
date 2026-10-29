import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PlayerShell } from './PlayerShell';
import { useGame } from './useGame';
import { Avatar, Badge, Banner, Button, Card, ErrorState, LoadingBlock, Segmented, TextInput } from '@/components/ui';
import { Icon, TEAM_ICONS } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import type { Scorecard } from '@/features/challenges/scorecard';
import { stateLabel } from './RouteStrip';
import { db, rpc, useAchievements, useGolfBoard, useGolfScores } from '@/lib/supabase/queries';
import { GolfCard } from '@/features/golf/GolfCard';
import { forgetEvent } from '@/lib/recent';
import { TEAM_COLORS } from '@/features/templates/content';
import type { ThemeDef } from '@/features/themes/themes';

export default function ScorecardPage() {
  const g = useGame();
  const { event, theme, member, myTeam, teamCard, myCard } = g;
  const [view, setView] = useState<'me' | 'team'>('me');
  const ach = useAchievements(event.id);
  const golf = event.game_mode === 'golf';
  const golfScores = useGolfScores(event.id, golf);
  const golfBoard = useGolfBoard(event.id, golf);

  useEffect(() => {
    if (window.location.hash === '#leave') document.getElementById('leave')?.scrollIntoView();
  }, []);

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

  const card = view === 'team' && teamCard ? teamCard : myCard;
  const myBadges = (ach.data?.awards ?? []).filter((a) => a.member_id === member?.id);
  const defs = new Map((ach.data?.defs ?? []).map((d) => [d.id, d]));

  return (
    <PlayerShell title="Scorecard">
      {member && (
        <div className="row">
          <Avatar name={member.display_name} color={member.avatar_color} icon={member.avatar_icon} size="lg" />
          <div className="grow">
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>{member.display_name}</h1>
            <p className="small muted">{myTeam ? myTeam.name : event.play_mode === 'individual' ? 'Solo' : `No ${theme.vocab.team.toLowerCase()} yet`}</p>
          </div>
        </div>
      )}
      <TeamPicker />
      {golf && member && (
        <GolfCard event={event} progress={g.progress} scores={golfScores.data ?? []} memberId={member.id} row={golfBoard.data?.individuals.find((r) => r.member_id === member.id)} />
      )}
      {!golf && myTeam && (
        <Segmented
          legend="Scorecard"
          value={view}
          onChange={setView}
          options={[
            { value: 'me', label: 'Mine' },
            { value: 'team', label: myTeam.name },
          ]}
        />
      )}
      {!golf && <ScorecardView card={card} theme={theme} />}
      {!golf && view === 'team' && <p className="xsmall muted">Team totals include challenges completed by anyone while they were on the team. Moving teams never moves points already earned.</p>}

      {myBadges.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">Badges</h2>
          <div className="row-wrap">
            {myBadges.map((a) => (
              <Badge key={a.id} tone="brass" icon={defs.get(a.achievement_id)?.icon ?? 'star'}>
                {defs.get(a.achievement_id)?.title}
              </Badge>
            ))}
          </div>
        </section>
      )}
      <ProfileAndLeave />
    </PlayerShell>
  );
}

export function ScorecardView({ card, theme }: { card: Scorecard; theme: ThemeDef }) {
  return (
    <>
      <div className="grid-2">
        <Card className="center">
          <span className="eyebrow">Total</span>
          <div className="score-big" style={{ fontSize: 'var(--fs-3xl)' }}>
            {card.total}
          </div>
          <span className="small muted">{theme.vocab.points} confirmed</span>
          {card.provisional !== 0 && <p className="xsmall">+{card.provisional} provisional</p>}
        </Card>
        <Card className="stack-sm">
          <Stat label="Completed" value={card.completed} />
          <Stat label="Pending review" value={card.pending} />
          <Stat label="Not accepted" value={card.rejected} />
          <Stat label="Missed" value={card.missed} />
        </Card>
      </div>
      <div>
        <div className="row-between small">
          <strong>Required challenges done</strong>
          <span>{card.completionPercent}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={card.completionPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Completion">
          <span style={{ width: `${card.completionPercent}%` }} />
        </div>
      </div>
      <div className="row-wrap small">
        <Badge tone="brass">Bonus {card.bonus}</Badge>
        {card.penalties !== 0 && <Badge tone="danger">Penalties {card.penalties}</Badge>}
        {card.adjustments !== 0 && <Badge tone="info">Organiser adjustments {card.adjustments > 0 ? '+' : ''}{card.adjustments}</Badge>}
      </div>


      <ol className="list">
        {card.rows.map((r, i) => (
          <li key={r.venue.id} className="list-row">
            <span className="rank" style={{ fontSize: 'var(--fs-md)' }}>
              {i + 1}
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong className="truncate" style={{ display: 'block' }}>
                {r.venue.name}
              </strong>
              <span className="xsmall muted">
                {stateLabel(r.state)}
                {r.requiredTotal > 0 && !['upcoming', 'before_join', 'group_skipped'].includes(r.state) ? ` · ${r.completed}/${r.requiredTotal + (r.completed > r.requiredTotal ? r.completed - r.requiredTotal : 0)} done` : ''}
                {r.pending ? ` · ${r.pending} pending` : ''}
                {r.missed ? ` · ${r.missed} missed` : ''}
              </span>
            </span>
            <span className="num" style={{ fontWeight: 800 }}>
              {r.state === 'upcoming' ? '' : r.earned}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="row-between small">
      <span className="muted">{label}</span>
      <strong className="num">{value}</strong>
    </div>
  );
}

function TeamPicker() {
  const g = useGame();
  const { event, theme, teamId, member } = g;
  const qc = useQueryClient();
  const fb = useFeedback();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!member || event.play_mode === 'individual' || event.teams_locked) return null;
  const canChoose = event.team_selection === 'self' || event.allow_self_teams;
  if (!canChoose) return null;
  const teams = g.teams.data?.teams ?? [];
  const counts = new Map<string, number>();
  g.teams.data?.links.forEach((l) => counts.set(l.team_id, (counts.get(l.team_id) ?? 0) + 1));

  const refresh = () => ['me', 'teams', 'leaderboard', 'submissions'].forEach((k) => qc.invalidateQueries({ queryKey: [k, event.id] }));
  const choose = async (id: string | null) => {
    if (teamId && id !== teamId) {
      const ok = await fb.confirm({ title: 'Switch teams?', body: 'Points you’ve already earned stay with your old team. Team challenges your new team already did won’t be repeatable.', confirmLabel: 'Switch' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await rpc('choose_team', { p_event_id: event.id, p_team_id: id });
      refresh();
    } catch (e) {
      fb.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-sm">
      <h2 style={{ fontSize: 'var(--fs-lg)' }}>{teamId ? `Your ${theme.vocab.team.toLowerCase()}` : `Pick a ${theme.vocab.team.toLowerCase()}`}</h2>
      {canChoose && (
        <div className="stack-sm">
          {teams.map((t) => {
            const full = (t.max_size ?? event.team_max_size) != null && (counts.get(t.id) ?? 0) >= (t.max_size ?? event.team_max_size)!;
            return (
              <button key={t.id} type="button" className={`list-row ${t.id === teamId ? 'list-row--me' : ''}`} onClick={() => t.id !== teamId && choose(t.id)} disabled={busy || (full && t.id !== teamId)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                <span className="avatar avatar--sm" style={{ background: t.color }}>
                  <Icon name={t.icon} size={15} />
                </span>
                <strong className="grow">{t.name}</strong>
                <span className="xsmall muted">
                  {counts.get(t.id) ?? 0}
                  {full ? ' · full' : ''}
                </span>
                {t.id === teamId && <Icon name="check" />}
              </button>
            );
          })}
        </div>
      )}
      {event.allow_self_teams && (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              await rpc('create_team', { p_event_id: event.id, p_name: name.trim(), p_color: TEAM_COLORS[teams.length % TEAM_COLORS.length], p_icon: TEAM_ICONS[teams.length % TEAM_ICONS.length] });
              setName('');
              refresh();
              fb.toast('Team created — you’re in it', 'success');
            } catch (ex) {
              fb.error(ex);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grow">
            <TextInput label={`Start a new ${theme.vocab.team.toLowerCase()}`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" icon="plus" loading={busy} style={{ alignSelf: 'flex-end' }}>
            Create
          </Button>
        </form>
      )}
    </Card>
  );
}

function ProfileAndLeave() {
  const { event, member, isOwner } = useGame();
  const fb = useFeedback();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState(member?.display_name ?? '');
  if (!member) return null;
  return (
    <section id="leave" className="stack-sm">
      <h2 className="section-title">You in this crawl</h2>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || name.trim() === member.display_name) return;
          try {
            await db.update('event_members', member.id, { display_name: name.trim() });
            qc.invalidateQueries({ queryKey: ['me', event.id] });
            qc.invalidateQueries({ queryKey: ['members', event.id] });
            fb.toast('Name updated', 'success');
          } catch (ex) {
            fb.error(ex);
          }
        }}
      >
        <div className="grow">
          <TextInput label="Display name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" style={{ alignSelf: 'flex-end' }}>
          Save
        </Button>
      </form>
      {!isOwner && (
        <Banner
          tone="warn"
          icon="log-out"
          title="Leave this crawl"
          action={
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await fb.confirm({
                  title: `Leave ${event.name}?`,
                  body: 'You’ll disappear from the leaderboard. Points already earned for your team stay with the team. You can rejoin with the invite link. To delete your photos too, use “My events” → Delete my data.',
                  confirmLabel: 'Leave',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await rpc('leave_event', { p_event_id: event.id });
                  forgetEvent(event.id);
                  await qc.invalidateQueries();
                  nav('/', { replace: true });
                } catch (ex) {
                  fb.error(ex);
                }
              }}
            >
              Leave
            </Button>
          }
        >
          <span className="small">You can come back later with the same link.</span>
        </Banner>
      )}
    </section>
  );
}
