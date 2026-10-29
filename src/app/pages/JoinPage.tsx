import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '@/components/Shell';
import { Avatar, Banner, Button, EmptyState, ErrorState, LinkButton, LoadingBlock, TextInput } from '@/components/ui';
import { Icon, AVATAR_ICONS, TEAM_ICONS } from '@/components/Icon';
import { TEAMS_NAMES_FOR } from '@/features/admin/teamNames';
import { useFeedback } from '@/components/feedback';
import { ThemeMotif, ThemeScope } from '@/features/themes/ThemeScope';
import { getTheme } from '@/features/themes/themes';
import { AVATAR_COLORS, TEAM_COLORS } from '@/features/templates/content';
import { useAuth } from '@/lib/auth';
import { rpc } from '@/lib/supabase/queries';
import type { EventPreview } from '@/lib/supabase/types';
import { formatCode, normaliseCode, validateDisplayName } from '@/lib/validation/forms';
import { rememberEvent } from '@/lib/recent';
import { formatEventWhen } from '@/lib/format';
import { STATUS_LABEL } from '@/features/events/status';

const DRAFT_KEY = 'roundhouse-join-draft';

export function JoinPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const code = params.code ? normaliseCode(params.code) : undefined;
  const eventIdParam = search.get('event') ?? undefined;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading, ensureUser } = useAuth();
  const fb = useFeedback();

  const preview = useQuery({
    queryKey: ['preview', code ?? eventIdParam ?? '', user?.id ?? 'anon'],
    enabled: Boolean(code || eventIdParam) && !authLoading,
    retry: 1,
    queryFn: () => rpc<EventPreview | null>('get_event_preview', code ? { p_code: code } : { p_event_id: eventIdParam }),
  });

  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as { name?: string; color?: string; icon?: string };
    } catch {
      return {};
    }
  })();
  const [name, setName] = useState(saved.name ?? '');
  const [color, setColor] = useState(saved.color ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  const [icon, setIcon] = useState(saved.icon ?? 'pint');
  const [team, setTeam] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState('');
  const [teamErr, setTeamErr] = useState<string>();
  const [nameErr, setNameErr] = useState<string>();
  const [joining, setJoining] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, color, icon }));
    } catch {
      /* ignore */
    }
  }, [name, color, icon]);

  if (!code && !eventIdParam) return <Navigate to="/" replace />;

  const p = preview.data;
  if (p && p.my_status === 'active') return <Navigate to={`/e/${p.id}`} replace />;

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current || !p) return;
    const err = validateDisplayName(name);
    setNameErr(err);
    if (err) return;
    if (team === 'new' && !newTeam.trim()) {
      setTeamErr('Name your new team, or pick another option.');
      return;
    }
    inFlight.current = true;
    setJoining(true);
    try {
      await ensureUser();
      const memberId = await rpc<string>('join_event', {
        p_code: code ?? null,
        p_event_id: code ? null : p.id,
        p_display_name: name.trim(),
        p_avatar_color: color,
        p_avatar_icon: icon,
        p_team_id: team && team !== 'new' && p.team_selection === 'self' ? team : null,
      });
      if (!memberId) throw new Error('Could not join');
      // You're in the event at this point; a team problem shouldn't undo that.
      try {
        if (team === 'new') {
          await rpc('create_team', { p_event_id: p.id, p_name: newTeam.trim(), p_color: TEAM_COLORS[p.teams.length % TEAM_COLORS.length], p_icon: TEAM_ICONS[p.teams.length % TEAM_ICONS.length] });
        } else if (team && p.team_selection !== 'self') {
          await rpc('choose_team', { p_event_id: p.id, p_team_id: team });
        }
      } catch (teamError) {
        fb.toast(`Joined, but the team didn’t work out: ${(teamError as Error).message} You can pick one on the Card tab.`, 'error');
      }
      rememberEvent({ id: p.id, name: p.name, theme_key: p.theme_key, role: 'participant' });
      sessionStorage.removeItem(DRAFT_KEY);
      await qc.invalidateQueries();
      fb.toast(`You’re in, ${name.trim()}!`, 'success');
      nav(`/e/${p.id}`, { replace: true });
    } catch (ex) {
      fb.error(ex);
    } finally {
      inFlight.current = false;
      setJoining(false);
    }
  };

  if (preview.isLoading || authLoading)
    return (
      <div className="app-root">
        <TopBar />
        <main className="page page--no-nav">
          <LoadingBlock label="Finding your crawl…" />
        </main>
      </div>
    );

  if (preview.isError)
    return (
      <div className="app-root">
        <TopBar back="/" />
        <main className="page page--no-nav">
          <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
        </main>
      </div>
    );

  if (!p)
    return (
      <div className="app-root">
        <TopBar back="/" />
        <main className="page page--no-nav">
          <div className="center-screen">
            <EmptyState icon="lock" title="We couldn’t find that crawl" action={<LinkButton to="/">Try another code</LinkButton>}>
              {code ? (
                <>
                  The code <span className="mono">{formatCode(code)}</span> isn’t valid. It may have been changed by the organiser, or the event isn’t published yet.
                </>
              ) : (
                'This event is private or no longer available.'
              )}
            </EmptyState>
          </div>
        </main>
      </div>
    );

  const theme = getTheme(p.theme_key);
  const closedReason =
    p.my_status === 'removed'
      ? 'The organiser removed you from this crawl.'
      : !['published', 'in_progress', 'paused'].includes(p.status)
        ? p.status === 'draft'
          ? 'The organiser hasn’t opened this crawl yet. Check back soon.'
          : `This crawl is ${STATUS_LABEL[p.status].toLowerCase()}.`
        : !p.join_open
          ? 'The organiser has closed joining for now.'
          : p.status !== 'published' && !p.allow_late_join
            ? 'This crawl has started and isn’t taking late arrivals.'
            : p.capacity != null && p.member_count >= p.capacity
              ? 'This crawl is full.'
              : !code && p.require_code
                ? 'You need the invitation link or code from the organiser to join.'
                : null;
  const late = p.status === 'in_progress' || p.status === 'paused';
  const canChooseTeam = p.play_mode !== 'individual' && !p.teams_locked && (p.team_selection === 'self' || p.allow_self_teams);
  const canPickTeam = canChooseTeam && (p.teams.length > 0 || p.allow_self_teams);

  return (
    <ThemeScope themeKey={p.theme_key} custom={p.theme_custom}>
      <TopBar back="/" title="Join the crawl" />
      <main className="page page--no-nav stack-lg" id="main">
        <section className="hero-band" style={{ padding: 'var(--s-6) var(--s-5)' }}>
          <ThemeMotif motif={theme.motif} />
          <div className="stack-sm" style={{ maxWidth: '80%' }}>
            <span className="eyebrow">{p.organiser_name} invites you to</span>
            <h1 className="deco-title" style={{ fontSize: 'var(--fs-3xl)' }}>
              {p.name}
            </h1>
            <div className="row-wrap">
              {formatEventWhen(p) && <Badge icon="calendar">{formatEventWhen(p)}</Badge>}
              <Badge icon="route">
                {p.venue_count} {p.venue_count === 1 ? theme.vocab.venue.toLowerCase() : theme.vocab.venues.toLowerCase()}
              </Badge>
              <Badge icon="users">{p.member_count} joined</Badge>
              {late && <Badge tone="accent" live>Live now</Badge>}
            </div>
            {p.start_location && (
              <p className="small row" style={{ gap: 6 }}>
                <Icon name="map-pin" size={16} /> {p.start_location}
              </p>
            )}
          </div>
        </section>
        {p.description && <p className="prewrap">{p.description}</p>}

        {closedReason ? (
          <Banner tone="warn" title="Can’t join right now">
            {closedReason}
          </Banner>
        ) : (
          <form className="card stack" onSubmit={join} noValidate>
            {late && (
              <Banner tone="info" title="You’re joining mid-crawl">
                {p.current_venue ? `The group is at ${p.current_venue}. ` : ''}Earlier venues won’t count against you — you’ll start from where everyone is now.
              </Banner>
            )}
            <TextInput
              label="Your name"
              hint="A first name or nickname is perfect. Everyone in the event will see it."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameErr(undefined);
              }}
              maxLength={40}
              autoComplete="nickname"
              autoCapitalize="words"
              enterKeyHint="go"
              error={nameErr}
              required
            />
            <fieldset>
              <legend>Pick a look</legend>
              <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
                <Avatar name={name || '?'} color={color} icon={icon} size="lg" />
                <div className="avatar-pick grow" role="radiogroup" aria-label="Colour" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                  {AVATAR_COLORS.map((c) => (
                    <label key={c} style={{ background: c }}>
                      <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} aria-label={`Colour ${c}`} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="avatar-pick" role="radiogroup" aria-label="Icon">
                {[...theme.icons, ...AVATAR_ICONS.filter((i) => !theme.icons.includes(i))].slice(0, 12).map((i) => (
                  <label key={i} style={{ background: 'var(--c-surface-2)' }}>
                    <input type="radio" name="icon" value={i} checked={icon === i} onChange={() => setIcon(i)} aria-label={i} />
                    <Icon name={i} />
                  </label>
                ))}
              </div>
            </fieldset>

            {canPickTeam && (
              <fieldset>
                <legend>Choose your {theme.vocab.team.toLowerCase()}</legend>
                <div className="stack-sm">
                  {p.teams.map((t) => {
                    const full = t.max_size != null && t.size >= t.max_size;
                    return (
                      <label key={t.id} className="option-card">
                        <input type="radio" name="team" value={t.id} checked={team === t.id} disabled={full} onChange={() => setTeam(t.id)} />
                        <div className="card card--tight row" style={{ opacity: full ? 0.5 : 1 }}>
                          <span className="avatar" style={{ background: t.color }}>
                            <Icon name={t.icon} />
                          </span>
                          <span className="grow">
                            <strong>{t.name}</strong>
                            <span className="xsmall muted" style={{ display: 'block' }}>
                              {t.size}
                              {t.max_size ? ` / ${t.max_size}` : ''} players{full ? ' · full' : ''}
                            </span>
                          </span>
                        </div>
                      </label>
                    );
                  })}
                  {p.allow_self_teams && (
                    <label className="option-card">
                      <input type="radio" name="team" value="new" checked={team === 'new'} onChange={() => setTeam('new')} />
                      <div className="card card--tight row">
                        <span className="avatar" style={{ background: 'var(--c-accent-2)' }}>
                          <Icon name="plus" />
                        </span>
                        <strong className="grow">Start a new {theme.vocab.team.toLowerCase()}</strong>
                      </div>
                    </label>
                  )}
                  {team === 'new' && (
                    <TextInput
                      label={`${theme.vocab.team} name`}
                      value={newTeam}
                      maxLength={40}
                      autoFocus
                      onChange={(e) => {
                        setNewTeam(e.target.value);
                        setTeamErr(undefined);
                      }}
                      error={teamErr}
                      placeholder={TEAMS_NAMES_FOR(p.theme_key).find((n) => !p.teams.some((t) => t.name === n))}
                    />
                  )}
                  <label className="option-card">
                    <input type="radio" name="team" value="" checked={team === null} onChange={() => setTeam(null)} />
                    <div className="card card--tight card--flat">Decide later</div>
                  </label>
                </div>
              </fieldset>
            )}
            {p.play_mode !== 'individual' && p.team_selection === 'organiser' && !canChooseTeam && (
              <p className="small muted row" style={{ gap: 6 }}>
                <Icon name="shuffle" size={16} /> The organiser will put you in a {theme.vocab.team.toLowerCase()}.
              </p>
            )}
            {p.play_mode !== 'individual' && p.team_selection === 'auto' && !canChooseTeam && (
              <p className="small muted row" style={{ gap: 6 }}>
                <Icon name="shuffle" size={16} /> You’ll be placed in the smallest {theme.vocab.team.toLowerCase()} automatically.
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" block loading={joining} icon="arrow-up">
              {late ? 'Join the crawl now' : 'Join the crawl'}
            </Button>
            {!user && (
              <p className="small">
                Already have an account? <Link to={`/signin?next=${encodeURIComponent(`/j/${code ?? ''}`)}`}>Sign in first</Link> to join with it.
              </p>
            )}
            <p className="xsmall muted">
              No account needed — we create a private guest login on this device. Use the same phone and browser to come back. You can add an email later
              to recover it on another device. <Link to="/privacy">What we store</Link>.
            </p>
          </form>
        )}
      </main>
    </ThemeScope>
  );
}

function Badge({ children, icon, tone, live }: { children: React.ReactNode; icon?: string; tone?: 'accent'; live?: boolean }) {
  return (
    <span className={['badge', tone && `badge--${tone}`, live && 'badge--live'].filter(Boolean).join(' ')}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
