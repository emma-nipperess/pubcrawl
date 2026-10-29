import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AccountButton, TopBar } from '@/components/Shell';
import { useFeedback } from '@/components/feedback';
import { Badge, Button, Card, LinkButton } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ThemeMotif } from '@/features/themes/ThemeScope';
import { getTheme, THEME_ORDER, THEMES } from '@/features/themes/themes';
import { getRecent } from '@/lib/recent';
import { parseInvite } from '@/lib/validation/forms';
import { useAuth } from '@/lib/auth';
import { usePublicEvents } from '@/lib/supabase/queries';
import { FooterLinks } from './Misc';

export function Landing() {
  const nav = useNavigate();
  const { user, loading, ensureUser } = useAuth();
  const fb = useFeedback();
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>();
  const recent = user ? getRecent() : [];
  const publicEvents = usePublicEvents();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseInvite(code);
    if (!c) {
      setErr('That doesn’t look like an event code. Codes are 8 letters and numbers, like ABCD-2345.');
      return;
    }
    nav(`/j/${c}`);
  };

  return (
    <div className="app-root">
      <TopBar right={<AccountButton />} />
      <main className="page page--no-nav stack-lg" id="main">
        <section className="hero-band landing-hero stack">
          <ThemeMotif motif="golf" />
          <span className="eyebrow">Pub crawls · pub golf · nights out</span>
          <h1>
            Plan the route.
            <br />
            <span className="hl">Play the night.</span>
          </h1>
          <p style={{ maxWidth: 440 }}>
            Venues, challenges, photo proof, teams and a live leaderboard — on everyone’s phone, from one link. No app, no sign-up forms.
          </p>
          <div className="row-wrap">
            <LinkButton to="/new" variant="primary" size="lg" icon="plus">
              Create a crawl
            </LinkButton>
          </div>
        </section>

        {!loading && !user && (
          <Card as="section" className="stack" aria-labelledby="welcome-h">
            <h2 id="welcome-h" style={{ fontSize: 'var(--fs-lg)' }}>
              Welcome! How do you want to play?
            </h2>
            <LinkButton to="/signin" variant="primary" size="lg" block icon="badge-check">
              Sign in with email
            </LinkButton>
            <p className="small muted" style={{ marginTop: -6 }}>
              Best for organisers: run your crawls from your phone and laptop. No password — we email you a code.
            </p>
            <Button
              size="lg"
              block
              icon="users"
              loading={starting}
              onClick={async () => {
                setStarting(true);
                try {
                  await ensureUser();
                  fb.toast('You’re in as a guest on this device', 'success');
                } catch (e) {
                  fb.error(e);
                } finally {
                  setStarting(false);
                }
              }}
            >
              Continue as guest
            </Button>
            <p className="small muted" style={{ marginTop: -6 }}>
              Nothing to fill in. Saved on this browser only — you can add an email later to keep it.
            </p>
          </Card>
        )}

        <Card as="section" aria-labelledby="join-h">
          <form className="stack" onSubmit={submit} noValidate>
            <h2 id="join-h" style={{ fontSize: 'var(--fs-lg)' }}>
              Got an invite?
            </h2>
            <label className="field">
              <span className="field__label">Event code or link</span>
              <input
                className="input input--code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setErr(undefined);
                }}
                placeholder="ABCD-2345"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(err) || undefined}
                aria-describedby={err ? 'code-err' : undefined}
              />
              {err && (
                <span id="code-err" className="field__error" role="alert">
                  {err}
                </span>
              )}
            </label>
            <Button type="submit" variant="secondary" block size="lg" icon="arrow-up" disabled={!code.trim()}>
              Find my crawl
            </Button>
          </form>
        </Card>

        {recent.length > 0 && (
          <section className="stack-sm" aria-labelledby="recent-h">
            <h2 id="recent-h" className="section-title">
              Jump back in
            </h2>
            <ul className="list">
              {recent.map((r) => {
                const t = getTheme(r.theme_key);
                return (
                  <li key={r.id}>
                    <Link to={r.role === 'participant' ? `/e/${r.id}` : `/e/${r.id}/admin`} className="list-row" style={{ textDecoration: 'none' }}>
                      <span className="avatar" style={{ background: t.preview.accent, color: t.preview.bg }} aria-hidden="true">
                        <Icon name={t.icons[0]} />
                      </span>
                      <span className="grow">
                        <strong className="truncate" style={{ display: 'block' }}>
                          {r.name}
                        </strong>
                        <span className="xsmall muted">{r.role === 'participant' ? 'Playing' : 'Organising'} · {t.name}</span>
                      </span>
                      <Icon name="chevron-right" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="stack" aria-labelledby="how-h">
          <h2 id="how-h" className="section-title">
            How it works
          </h2>
          <ol className="how-steps">
            <li>
              <div>
                <strong>Build the route.</strong>
                <p className="muted small">Pick a theme, add venues (or “holes”), and drop in challenges — photos, trivia, team dares, riddles.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Share one link.</strong>
                <p className="muted small">Friends open it, pick a name, and they’re in. Shuffle them into balanced teams or let them choose.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Play it live.</strong>
                <p className="muted small">Open each venue as you arrive. Snap proof, earn points, watch the leaderboard move. Skip a stop or join late — no stress.</p>
              </div>
            </li>
          </ol>
          <Card className="card--muted">
            <div className="row">
              <Icon name="heart" />
              <p className="small">
                <strong>Drinking is never the score.</strong> Every template works with soft drinks, food, trivia and photos. Pace yourselves, look after each
                other, and get home safely.
              </p>
            </div>
          </Card>
        </section>

        <section className="stack-sm" aria-labelledby="themes-h">
          <h2 id="themes-h" className="section-title">
            Themes
          </h2>
          <div className="grid-auto">
            {THEME_ORDER.map((k) => {
              const t = THEMES[k];
              return (
                <div key={k} data-theme={k} className="theme-swatch" style={{ background: t.preview.bg, color: t.preview.ink }}>
                  <ThemeMotif motif={t.motif} />
                  <span className="theme-swatch__name">{t.name}</span>
                </div>
              );
            })}
          </div>
        </section>

        {publicEvents.data && publicEvents.data.length > 0 && (
          <section className="stack-sm" aria-labelledby="public-h">
            <h2 id="public-h" className="section-title">
              Open crawls
            </h2>
            <ul className="list">
              {publicEvents.data.map((e) => (
                <li key={e.id} className="list-row">
                  <span className="grow">
                    <strong>{e.name}</strong>
                    <span className="xsmall muted" style={{ display: 'block' }}>
                      by {e.organiser_name} · {e.event_date ?? 'date tbc'} · {e.member_count} joined
                    </span>
                  </span>
                  {e.status === 'in_progress' && <Badge tone="accent" live>Live</Badge>}
                  <LinkButton to={`/join?event=${e.id}`} size="sm">
                    View
                  </LinkButton>
                </li>
              ))}
            </ul>
          </section>
        )}
        <FooterLinks />
      </main>
    </div>
  );
}
