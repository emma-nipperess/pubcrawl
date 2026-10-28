import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PlayerShell } from './PlayerShell';
import { useGame } from './useGame';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingBlock, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { challengeState, CHALLENGE_TYPES, SUBMISSION_STATUS } from '@/features/challenges/meta';
import { SubmitSheet } from '@/features/challenges/SubmitSheet';
import { directionsUrl } from '@/features/venues/progress';
import { rpc } from '@/lib/supabase/queries';
import type { ChallengeRow } from '@/lib/supabase/types';
import { stateLabel } from './RouteStrip';
import { formatTime } from '@/lib/format';

export default function PlayVenue() {
  const g = useGame();
  const { event, theme, member } = g;
  const { venueId } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const qc = useQueryClient();
  const [open, setOpen] = useState<ChallengeRow | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

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

  const items = g.progress.filter((p) => p.state !== 'disabled');
  const selected = (venueId && items.find((p) => p.venue.id === venueId)) || g.summary.current || g.summary.next || items[0];
  const all = g.challenges.data ?? [];
  const eventWide = all.filter((c) => c.venue_id == null);

  if (!selected && eventWide.length === 0)
    return (
      <PlayerShell title={theme.vocab.challenges}>
        <EmptyState icon="target" title={`No ${theme.vocab.challenges.toLowerCase()} yet`}>
          They appear here when each {theme.vocab.venue.toLowerCase()} opens.
        </EmptyState>
      </PlayerShell>
    );

  const v = selected?.venue;
  const challenges = v ? all.filter((c) => c.venue_id === v.id) : [];
  const playing = event.status === 'in_progress' && member?.is_player;
  const venueOpen = v && (v.status === 'active' || (event.allow_any_venue && v.status === 'completed'));
  const iSkipped = selected?.state === 'skipped' || selected?.state === 'active_skipped';
  const canSubmit = Boolean(playing && venueOpen && !iSkipped);
  const hasConsequence = event.skip_policy !== 'none' || challenges.some((c) => c.required);

  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await rpc(fn, args);
      await qc.invalidateQueries({ queryKey: ['participation', event.id] });
      qc.invalidateQueries({ queryKey: ['ledger', event.id] });
      qc.invalidateQueries({ queryKey: ['leaderboard', event.id] });
      fb.toast(ok, 'success');
    } catch (e) {
      fb.error(e);
    } finally {
      setBusy(false);
    }
  };

  const renderChallenge = (c: ChallengeRow, allowed: boolean = canSubmit) => {
    const st = challengeState(c, g.mySubs, g.teamSubs);
    const done = st.state === 'done';
    const tone = done ? 'success' : st.state === 'pending' ? 'warn' : st.state === 'rejected' || st.state === 'no_attempts' ? 'danger' : st.state === 'resubmit' ? 'info' : undefined;
    const actionable = allowed && (['open', 'rejected', 'resubmit'].includes(st.state) || (c.repeatable && st.state !== 'no_attempts' && st.state !== 'pending'));
    return (
      <li key={c.id}>
        <Card className="stack-sm" style={{ opacity: done ? 0.85 : 1 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="avatar" style={{ background: done ? 'var(--c-success-bg)' : 'var(--c-accent-2)', color: done ? 'var(--c-success)' : 'var(--c-accent-2-ink)' }}>
              <Icon name={done ? 'check' : CHALLENGE_TYPES[c.type].icon} />
            </span>
            <div className="grow">
              <h3 style={{ fontSize: 'var(--fs-md)' }}>{c.title}</h3>
              <div className="row-wrap" style={{ marginTop: 4 }}>
                <Badge tone="brass">
                  {c.points + c.bonus_points} {theme.vocab.points}
                </Badge>
                {c.scope === 'team' && <Badge icon="users">{theme.vocab.team}</Badge>}
                {!c.required && <Badge>Optional</Badge>}
                {c.requires_approval && <Badge icon="badge-check">Reviewed</Badge>}
                {tone && <Badge tone={tone}>{st.state === 'no_attempts' ? 'Out of attempts' : SUBMISSION_STATUS[st.latest?.status ?? 'approved'].label}</Badge>}
              </div>
            </div>
          </div>
          {c.description && <p className="small prewrap">{c.description}</p>}
          {st.latest?.review_note && st.state !== 'done' && <p className="small" style={{ color: 'var(--c-danger)' }}>Organiser: {st.latest.review_note}</p>}
          {actionable && (
            <Button variant={done ? 'default' : 'primary'} block onClick={() => setOpen(c)} icon={CHALLENGE_TYPES[c.type].icon}>
              {st.state === 'resubmit' || st.state === 'rejected' ? 'Try again' : done ? 'Go again' : 'Do it'}
            </Button>
          )}
        </Card>
      </li>
    );
  };

  const openState = open ? challengeState(open, g.mySubs, g.teamSubs) : null;
  const dir = v ? directionsUrl(v) : null;

  return (
    <PlayerShell title={theme.vocab.challenges}>
      {items.length > 1 && (
        <nav aria-label={theme.vocab.venues} className="route" style={{ gap: 8 }}>
          {items.map((p, i) => (
            <button
              key={p.venue.id}
              type="button"
              className={`btn btn--sm ${p.venue.id === v?.id ? 'btn--primary' : ''}`}
              aria-current={p.venue.id === v?.id ? 'page' : undefined}
              onClick={() => nav(`/e/${event.id}/play/${p.venue.id}`, { replace: true })}
              style={{ flex: '0 0 auto' }}
            >
              {i + 1}. {p.venue.name.length > 14 ? `${p.venue.name.slice(0, 13)}…` : p.venue.name}
              {(p.state === 'active' || p.state === 'active_skipped') && <span className="badge badge--live" style={{ minHeight: 18, padding: '0 6px' }}>Now</span>}
            </button>
          ))}
        </nav>
      )}

      {v && selected && (
        <section className="stack">
          <div>
            <span className="eyebrow">
              {theme.vocab.venue} {items.indexOf(selected) + 1} · {stateLabel(selected.state)}
            </span>
            <h1 className="deco-title">{v.name}</h1>
            {v.address && <p className="small muted">{v.address}</p>}
            {(v.arrive_at || v.depart_at) && (
              <p className="small muted">
                {formatTime(v.arrive_at)}
                {v.depart_at ? ` – ${formatTime(v.depart_at)}` : ''}
              </p>
            )}
            {v.description && <p className="small prewrap" style={{ marginTop: 6 }}>{v.description}</p>}
          </div>
          <div className="row-wrap">
            {dir && (
              <a className="btn btn--sm" href={dir} target="_blank" rel="noopener noreferrer">
                <Icon name="navigation" /> Directions
              </a>
            )}
            {theme.golfCard && v.par != null && <Badge icon="flag">Par {v.par}</Badge>}
            {v.bonus_points > 0 && <Badge tone="brass" icon="sparkles">Clean sweep +{v.bonus_points}</Badge>}
            {v.time_limit_minutes && v.activated_at && <Badge icon="clock">Closes {new Date(new Date(v.activated_at).getTime() + v.time_limit_minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Badge>}
          </div>

          {selected.state === 'before_join' && <Banner tone="info">This {theme.vocab.venue.toLowerCase()} finished before you joined, so it doesn’t count against you.</Banner>}
          {selected.state === 'group_skipped' && <Banner tone="info">The group skipped this one.</Banner>}
          {selected.state === 'upcoming' && <Banner tone="info" icon="clock">Opens when the organiser moves the crawl here.</Banner>}
          {v.status === 'completed' && !event.allow_any_venue && !iSkipped && <Banner tone="info">This {theme.vocab.venue.toLowerCase()} is closed.</Banner>}
          {event.status === 'paused' && <Banner tone="warn" icon="pause">Paused — submissions reopen soon.</Banner>}
          {event.status === 'published' && <Banner tone="info">The crawl hasn’t started yet.</Banner>}
          {iSkipped && (
            <Banner
              tone="warn"
              title="You’re skipping this one"
              action={
                v.status === 'upcoming' || v.status === 'active' ? (
                  <Button size="sm" loading={busy} onClick={() => act('resume_venue', { p_venue_id: v.id }, 'Welcome back!')}>
                    Rejoin
                  </Button>
                ) : undefined
              }
            >
              {selected.participation?.skip_reason ? `“${selected.participation.skip_reason}”` : 'No points here, and nothing gets marked complete.'}
            </Banner>
          )}

          {challenges.length === 0 ? (
            <EmptyState icon={v.status === 'upcoming' ? 'lock' : 'beer'} title={v.status === 'upcoming' && !event.challenges_visible_early ? 'Under wraps' : `No ${theme.vocab.challenges.toLowerCase()} here`}>
              {v.status === 'upcoming' && !event.challenges_visible_early ? `Revealed when this ${theme.vocab.venue.toLowerCase()} opens.` : 'Just enjoy this stop.'}
            </EmptyState>
          ) : (
            <ul className="list" style={{ gap: 'var(--s-3)' }}>
              {challenges.map((c) => renderChallenge(c))}
            </ul>
          )}

          {member?.is_player && event.allow_skip && !iSkipped && (v.status === 'upcoming' || v.status === 'active') && event.status !== 'completed' && (
            <Card className="card--muted stack-sm">
              {!skipping ? (
                <Button variant="ghost" icon="skip" onClick={() => setSkipping(true)}>
                  Skip this {theme.vocab.venue.toLowerCase()}
                </Button>
              ) : (
                <>
                  <strong>Skip {v.name}?</strong>
                  <p className="small">
                    {event.skip_policy === 'penalty'
                      ? `You’ll lose ${event.skip_penalty} ${theme.vocab.points} and its ${theme.vocab.challenges.toLowerCase()} won’t score.`
                      : hasConsequence
                        ? `Its ${theme.vocab.challenges.toLowerCase()} won’t score for you. No other penalty.`
                        : 'No penalty.'}{' '}
                    You can rejoin while it’s still open.
                  </p>
                  <TextInput label="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Grabbing food, meeting you at the next one" />
                  <div className="row">
                    <Button onClick={() => setSkipping(false)}>Cancel</Button>
                    <Button
                      variant="danger"
                      block
                      loading={busy}
                      onClick={async () => {
                        await act('skip_venue', { p_venue_id: v.id, p_reason: reason || null }, 'Skipped — see you at the next one');
                        setSkipping(false);
                        setReason('');
                      }}
                    >
                      Skip it
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}
          {member?.is_player && v.status === 'active' && !iSkipped && selected.participation?.status !== 'present' && event.status === 'in_progress' && (
            <Button variant="ghost" icon="map-pin" loading={busy} onClick={() => act('check_in_venue', { p_venue_id: v.id }, `Checked in at ${v.name}`)}>
              I’m here — check in
            </Button>
          )}
        </section>
      )}

      {eventWide.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">All-night {theme.vocab.challenges.toLowerCase()}</h2>
          <ul className="list" style={{ gap: 'var(--s-3)' }}>
            {eventWide.map((c) => renderChallenge(c, Boolean(playing)))}
          </ul>
        </section>
      )}

      <SubmitSheet challenge={open} open={Boolean(open)} onClose={() => setOpen(null)} eventId={event.id} theme={theme} latest={openState?.latest} attemptsUsed={openState?.attemptsUsed ?? 0} />
    </PlayerShell>
  );
}
