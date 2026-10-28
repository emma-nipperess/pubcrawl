import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { db, rpc, useAnnouncements, useMembers, useReviewQueue, useVenues } from '@/lib/supabase/queries';
import { Badge, Banner, Button, Card, EmptyState, LinkButton, LoadingBlock, Segmented, TextArea } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { statusActions, isLive } from '@/features/events/status';
import { AnnouncementCard } from '@/features/play/AnnouncementCard';
import { useAuth } from '@/lib/auth';
import type { AnnouncementRow } from '@/lib/supabase/types';

export default function ControlPanel() {
  const { event, theme } = useEventCtx();
  const { user } = useAuth();
  const venues = useVenues(event.id);
  const members = useMembers(event.id);
  const pending = useReviewQueue(event.id, 'pending', true);
  const ann = useAnnouncements(event.id);
  const { run, busy } = useAdminAction(event.id);
  const [msg, setMsg] = useState('');
  const [kind, setKind] = useState<AnnouncementRow['kind']>('info');
  const [pin, setPin] = useState(false);

  const vs = (venues.data ?? []).filter((v) => !v.disabled);
  const current = vs.find((v) => v.status === 'active');
  const next = vs.find((v) => v.status === 'upcoming' && (!current || v.position > current.position));
  const players = (members.data ?? []).filter((m) => m.status === 'active' && m.role === 'participant');
  const pendingCount = pending.data?.pages.reduce((a, p) => a + p.rows.length, 0) ?? 0;

  return (
    <AdminShell title={event.name}>
      <section className="stack">
        <h1 className="deco-title">Control room</h1>
        <div className="grid-2">
          <Card className="card--tight">
            <span className="eyebrow">Players</span>
            <div className="score-big">{players.length}</div>
            <Link to="people" className="small">
              Manage
            </Link>
          </Card>
          <Card className="card--tight">
            <span className="eyebrow">To review</span>
            <div className="score-big">{pendingCount}</div>
            <Link to="review" className="small">
              Review proof
            </Link>
          </Card>
        </div>
        {event.status === 'draft' && (
          <Banner tone="info" title="Draft — only you can see this">
            Check the route, then preview it as a player (top right). Publish to open joining and get your invite link.
          </Banner>
        )}
        {event.status === 'published' && (
          <Banner tone="success" title="Open for joining" action={<LinkButton to="share" size="sm" icon="share">Invite</LinkButton>}>
            People can join now. Start the crawl when you reach the first {theme.vocab.venue.toLowerCase()}.
          </Banner>
        )}
        <div className="row-wrap">
          {statusActions(event.status).map((a) => (
            <Button
              key={a.to}
              variant={a.primary ? 'primary' : a.confirm?.danger ? 'danger' : 'default'}
              size={a.primary ? 'lg' : 'md'}
              loading={busy === a.to}
              icon={a.to === 'paused' ? 'pause' : a.to === 'in_progress' ? 'play' : a.to === 'published' ? 'share' : undefined}
              onClick={() =>
                run(a.to, () => rpc('set_event_status', { p_event_id: event.id, p_status: a.to }), {
                  confirm: a.confirm ? { title: a.confirm.title, body: a.confirm.body, danger: a.confirm.danger, confirmLabel: a.label, typeToConfirm: a.to === 'cancelled' ? 'CANCEL' : undefined } : undefined,
                  success: a.to === 'published' ? 'Published! Share the invite link.' : `Done: ${a.label.toLowerCase()}`,
                })
              }
            >
              {a.label}
            </Button>
          ))}
        </div>
      </section>

      {isLive(event.status) && (
        <section className="stack">
          <h2 className="section-title">The route</h2>
          {venues.isLoading ? (
            <LoadingBlock rows={1} />
          ) : (
            <>
              {current ? (
                <Card className="card--accent stack-sm">
                  <span className="card__ribbon">Now</span>
                  <span className="eyebrow" style={{ color: 'inherit' }}>
                    {theme.vocab.venue} {current.position + 1}
                  </span>
                  <h3 className="deco-title" style={{ fontSize: 'var(--fs-xl)' }}>
                    {current.name}
                  </h3>
                  {current.activated_at && <p className="small">Opened {new Date(current.activated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
                </Card>
              ) : (
                <Banner tone="info">No {theme.vocab.venue.toLowerCase()} is open right now.</Banner>
              )}
              {next ? (
                <Button
                  variant="secondary"
                  size="lg"
                  block
                  icon="skip"
                  loading={busy === 'advance'}
                  onClick={() =>
                    run('advance', () => rpc('advance_venue', { p_event_id: event.id }), {
                      confirm: { title: `Move everyone to ${next.name}?`, body: current ? `${current.name} closes and ${next.name}’s ${theme.vocab.challenges.toLowerCase()} are revealed.` : undefined, confirmLabel: 'Move on' },
                      success: `Now at ${next.name}`,
                    })
                  }
                >
                  Next: {next.name}
                </Button>
              ) : (
                <p className="small muted">That’s the last {theme.vocab.venue.toLowerCase()}. Finish the crawl above when you’re done.</p>
              )}
              <details>
                <summary className="btn btn--ghost btn--sm" style={{ display: 'inline-flex' }}>
                  <Icon name="route" /> Jump to any {theme.vocab.venue.toLowerCase()}
                </summary>
                <ul className="list" style={{ marginTop: 8 }}>
                  {vs.map((v) => (
                    <li key={v.id} className="list-row">
                      <span className="rank" style={{ fontSize: 'var(--fs-md)' }}>
                        {v.position + 1}
                      </span>
                      <span className="grow">
                        <strong>{v.name}</strong>
                        <span className="xsmall muted" style={{ display: 'block' }}>
                          {v.status}
                        </span>
                      </span>
                      {v.status !== 'active' && (
                        <Button
                          size="sm"
                          loading={busy === `act-${v.id}`}
                          onClick={() =>
                            run(`act-${v.id}`, () => rpc('activate_venue', { p_venue_id: v.id }), {
                              confirm: {
                                title: v.status === 'completed' ? `Reopen ${v.name}?` : `Open ${v.name}?`,
                                body: v.position < (current?.position ?? -1) ? 'Players can submit there again. Points already earned are unchanged.' : 'Any upcoming venues before it will be marked as skipped by the group.',
                              },
                              success: `${v.name} is open`,
                            })
                          }
                        >
                          {v.status === 'completed' ? 'Reopen' : 'Open'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>
      )}

      <section className="stack" aria-labelledby="ann-h">
        <h2 id="ann-h" className="section-title">
          Announcements
        </h2>
        <form
          className="card stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!msg.trim() || !user) return;
            const ok = await run('announce', () => db.insert('event_announcements', { event_id: event.id, author_id: user.id, body: msg.trim(), kind, pinned: pin }), { success: 'Sent to everyone', refresh: ['announcements'] });
            if (ok) {
              setMsg('');
              setPin(false);
            }
          }}
        >
          <TextArea label="Message everyone" rows={2} maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="We’re moving to The Crown early — 5 minutes!" />
          <Segmented
            legend="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'info', label: 'Info', icon: 'megaphone' },
              { value: 'venue_change', label: 'Venue change', icon: 'map-pin' },
              { value: 'urgent', label: 'Urgent', icon: 'alert' },
              { value: 'celebration', label: 'Shout-out', icon: 'party-popper' },
            ]}
          />
          <label className="row small">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} style={{ width: 20, height: 20 }} /> Pin to the top
          </label>
          <Button type="submit" variant="primary" icon="megaphone" disabled={!msg.trim()} loading={busy === 'announce'}>
            Send
          </Button>
        </form>
        {(ann.data ?? []).length === 0 ? (
          <EmptyState icon="megaphone" title="No announcements yet" />
        ) : (
          <ul className="list">
            {ann.data!.map((a) => (
              <li key={a.id} className="stack-sm">
                <AnnouncementCard a={a} />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" onClick={() => run(`pin-${a.id}`, () => db.update('event_announcements', a.id, { pinned: !a.pinned }), { refresh: ['announcements'] })}>
                    {a.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() =>
                      run(`del-${a.id}`, () => db.update('event_announcements', a.id, { deleted_at: new Date().toISOString() }), {
                        confirm: { title: 'Delete announcement?', danger: true, confirmLabel: 'Delete' },
                        refresh: ['announcements'],
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="small muted">
        <Badge icon="shield">Safety</Badge> Keep an eye on your group: plan transport home, keep water and soft drinks in every round, and never pressure anyone to drink.
      </p>
    </AdminShell>
  );
}
