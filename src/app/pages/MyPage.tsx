import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/Shell';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LinkButton, LoadingBlock, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { useAuth } from '@/lib/auth';
import { rpc, useMyEvents, useTemplates, db } from '@/lib/supabase/queries';
import { supabase } from '@/lib/supabase/client';
import { getTheme } from '@/features/themes/themes';
import { STATUS_LABEL } from '@/features/events/status';
import { formatDate } from '@/lib/format';
import { FooterLinks } from './Misc';

export default function MyPage() {
  const { user, isAnonymous, loading } = useAuth();
  const events = useMyEvents();
  const templates = useTemplates();
  const fb = useFeedback();

  return (
    <div className="app-root">
      <TopBar back="/" title="My events" />
      <main className="page page--no-nav stack-lg" id="main">
        {loading ? (
          <LoadingBlock />
        ) : !user ? (
          <>
            <EmptyState icon="users" title="No events on this device" action={<LinkButton to="/" variant="primary">Join or create one</LinkButton>}>
              Joined on another device and linked an email? Sign in below to get back in.
            </EmptyState>
            <SignInCard />
          </>
        ) : (
          <>
            {events.isLoading ? (
              <LoadingBlock />
            ) : events.isError ? (
              <ErrorState error={events.error} onRetry={() => events.refetch()} />
            ) : events.data!.length === 0 ? (
              <EmptyState icon="route" title="No events yet" action={<LinkButton to="/new" variant="primary" icon="plus">Create a crawl</LinkButton>} />
            ) : (
              <ul className="list">
                {events.data!.map((m) => {
                  const e = m.events!;
                  const t = getTheme(e.theme_key);
                  const org = m.role !== 'participant';
                  return (
                    <li key={m.id}>
                      <Link to={org ? `/e/${e.id}/admin` : `/e/${e.id}`} className="list-row" style={{ textDecoration: 'none' }}>
                        <span className="avatar" style={{ background: t.preview.accent, color: t.preview.bg }}>
                          <Icon name={t.icons[0]} />
                        </span>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <strong className="truncate" style={{ display: 'block' }}>
                            {e.name}
                          </strong>
                          <span className="xsmall muted">
                            {org ? 'Organising' : 'Playing'} · {formatDate(e.event_date) || 'No date'} · {m.status !== 'active' ? m.status : STATUS_LABEL[e.status]}
                          </span>
                        </span>
                        <Icon name="chevron-right" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <LinkButton to="/new" variant="primary" icon="plus">
              Create a crawl
            </LinkButton>

            {(templates.data?.length ?? 0) > 0 && (
              <section className="stack-sm">
                <h2 className="section-title">My templates</h2>
                <ul className="list">
                  {templates.data!.map((t) => (
                    <li key={t.id} className="list-row">
                      <span className="grow">
                        <strong>{t.name}</strong>
                        <span className="xsmall muted" style={{ display: 'block' }}>
                          {getTheme(t.theme_key).name} · {t.payload.venues.length} venues
                        </span>
                      </span>
                      <LinkButton to={`/new?template=${t.id}`} size="sm">
                        Use
                      </LinkButton>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="trash"
                        onClick={async () => {
                          if (!(await fb.confirm({ title: `Delete template “${t.name}”?`, danger: true, confirmLabel: 'Delete' }))) return;
                          try {
                            await db.remove('event_templates', t.id);
                            templates.refetch();
                          } catch (e) {
                            fb.error(e);
                          }
                        }}
                      >
                        Delete {t.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <AccountCard isAnonymous={isAnonymous} />
          </>
        )}
        <FooterLinks />
      </main>
    </div>
  );
}

function SignInCard() {
  const { sendEmailCode, verifyEmailCode } = useAuth();
  const fb = useFeedback();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="stack-sm">
      <h2 style={{ fontSize: 'var(--fs-lg)' }}>Sign in with email</h2>
      <p className="small muted">Only works if you linked this email earlier. We send a one-time code — no password.</p>
      <form
        className="stack-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (!sent) {
              await sendEmailCode(email.trim());
              setSent(true);
              fb.toast('Check your email for a code or link');
            } else {
              await verifyEmailCode(email.trim(), code.trim());
              fb.toast('Signed in', 'success');
            }
          } catch (ex) {
            fb.error(ex);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} required />
        {sent && <TextInput label="Code from the email" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} />}
        <Button type="submit" loading={busy} disabled={!email.includes('@')}>
          {sent ? 'Sign in' : 'Email me a code'}
        </Button>
      </form>
    </Card>
  );
}

function AccountCard({ isAnonymous }: { isAnonymous: boolean }) {
  const { user, linkEmail, signOut } = useAuth();
  const fb = useFeedback();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card className="stack-sm">
      <h2 style={{ fontSize: 'var(--fs-lg)' }}>Your account</h2>
      {isAnonymous ? (
        <>
          <Banner tone="info" title="Guest login on this device">
            Your events are tied to this browser. If you clear its data or switch phones, you can’t get back in — unless you add an email.
          </Banner>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await linkEmail(email.trim());
                fb.toast('Check your inbox to confirm the email', 'success');
              } catch (ex) {
                fb.error(ex);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grow">
              <TextInput label="Add an email for recovery (optional)" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Never shown to other players." />
            </div>
            <Button type="submit" loading={busy} disabled={!email.includes('@')} style={{ alignSelf: 'center' }}>
              Add
            </Button>
          </form>
        </>
      ) : (
        <p className="small">
          Signed in{user?.email ? ` as ${user.email}` : ''}. <Badge tone="success">Recoverable</Badge>
        </p>
      )}
      <div className="row-wrap">
        <Button
          icon="log-out"
          onClick={async () => {
            const ok = await fb.confirm({
              title: 'Sign out on this device?',
              body: isAnonymous ? 'You’re using a guest login without an email. If you sign out you will lose access to your events for good.' : 'You can sign back in with your email.',
              danger: isAnonymous,
              confirmLabel: 'Sign out',
            });
            if (!ok) return;
            await signOut();
            nav('/', { replace: true });
          }}
        >
          Sign out
        </Button>
        <Button
          variant="danger"
          icon="trash"
          loading={busy}
          onClick={async () => {
            const ok = await fb.confirm({
              title: 'Delete my data everywhere?',
              body: 'Deletes your photos/videos, memberships, submissions and scores in every event, plus your templates and login. Events you organise must be deleted first.',
              danger: true,
              confirmLabel: 'Delete everything',
              typeToConfirm: 'DELETE',
            });
            if (!ok) return;
            setBusy(true);
            try {
              const paths = await rpc<string[]>('my_proof_objects');
              for (let i = 0; i < paths.length; i += 100) {
                const { error } = await supabase.storage.from('proof').remove(paths.slice(i, i + 100));
                if (error) throw error;
              }
              await rpc('delete_my_account');
              await signOut();
              fb.toast('Your data has been deleted', 'success');
              nav('/', { replace: true });
            } catch (ex) {
              fb.error(ex);
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete my data
        </Button>
      </div>
    </Card>
  );
}
