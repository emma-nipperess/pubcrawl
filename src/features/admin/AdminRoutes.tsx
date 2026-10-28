import { lazy, type ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useEventCtx } from '@/app/EventRoutes';
import { BottomNav, NetBanner, TopBar } from '@/components/Shell';
import { Badge, LinkButton } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { STATUS_LABEL, STATUS_TONE } from '@/features/events/status';
import { useReviewQueue } from '@/lib/supabase/queries';

const Control = lazy(() => import('./ControlPanel'));
const RouteEditor = lazy(() => import('./RouteEditor'));
const People = lazy(() => import('./PeoplePage'));
const Review = lazy(() => import('./ReviewPage'));
const More = lazy(() => import('./MorePage'));
const Share = lazy(() => import('./SharePage'));
const Settings = lazy(() => import('./SettingsPage'));
const Scores = lazy(() => import('./ScoresPage'));

export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<Control />} />
      <Route path="route" element={<RouteEditor />} />
      <Route path="people" element={<People />} />
      <Route path="review" element={<Review />} />
      <Route path="more" element={<More />} />
      <Route path="share" element={<Share />} />
      <Route path="settings" element={<Settings />} />
      <Route path="scores" element={<Scores />} />
    </Routes>
  );
}

export function AdminShell({ children, title }: { children: ReactNode; title: string }) {
  const { event, theme, live } = useEventCtx();
  const base = `/e/${event.id}/admin`;
  const pending = useReviewQueue(event.id, 'pending', true);
  const pendingCount = pending.data?.pages.reduce((a, p) => a + p.rows.length, 0) ?? 0;
  const items = [
    { to: base, label: 'Control', icon: 'play', end: true },
    { to: `${base}/route`, label: theme.vocab.venues, icon: 'route' },
    { to: `${base}/people`, label: 'People', icon: 'users' },
    { to: `${base}/review`, label: 'Review', icon: 'badge-check', badge: pendingCount },
    { to: `${base}/more`, label: 'More', icon: 'grid' },
  ];
  return (
    <>
      <TopBar
        wide
        title={
          <span className="row" style={{ gap: 8 }}>
            <span className="truncate">{title}</span>
          </span>
        }
        right={
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={STATUS_TONE[event.status] === 'neutral' ? 'neutral' : (STATUS_TONE[event.status] as 'info')} live={event.status === 'in_progress'}>
              {STATUS_LABEL[event.status]}
            </Badge>
            <LinkButton to={`/e/${event.id}`} size="sm" icon="eye">
              Player view
            </LinkButton>
          </div>
        }
      />
      <NetBanner live={live} />
      <main className="page page--wide" id="main">
        <div className="admin-layout">
          <aside className="admin-side" aria-label="Organiser sections">
            <nav>
              {[...items, { to: `${base}/share`, label: 'Invite', icon: 'share' }, { to: `${base}/scores`, label: 'Scores & export', icon: 'trophy' }, { to: `${base}/settings`, label: 'Settings', icon: 'settings' }].map((i) => (
                <NavLink key={i.to} to={i.to} end={'end' in i ? i.end : false}>
                  <Icon name={i.icon} /> {i.label}
                  {'badge' in i && i.badge ? <span className="badge badge--accent">{i.badge}</span> : null}
                </NavLink>
              ))}
            </nav>
          </aside>
          <div className="stack-lg">{children}</div>
        </div>
      </main>
      <BottomNav items={items} />
    </>
  );
}
