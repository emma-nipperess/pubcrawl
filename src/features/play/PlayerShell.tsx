import type { ReactNode } from 'react';
import { BottomNav, NetBanner, TopBar } from '@/components/Shell';
import { Badge, LinkButton } from '@/components/ui';
import { useEventCtx } from '@/app/EventRoutes';
import { STATUS_LABEL, STATUS_TONE } from '@/features/events/status';

/** Layout for participant screens: themed top bar, status, bottom nav. */
export function PlayerShell({ children, title }: { children: ReactNode; title?: ReactNode }) {
  const { event, theme, isOrganiser, live, member } = useEventCtx();
  const base = `/e/${event.id}`;
  return (
    <>
      <TopBar
        title={title ?? event.name}
        right={
          <div className="row" style={{ gap: 6 }}>
            {event.status !== 'in_progress' && <Badge tone={STATUS_TONE[event.status] === 'neutral' ? 'neutral' : (STATUS_TONE[event.status] as 'info')}>{STATUS_LABEL[event.status]}</Badge>}
            {isOrganiser && (
              <LinkButton to={`${base}/admin`} size="sm" variant="secondary" icon="settings">
                Admin
              </LinkButton>
            )}
          </div>
        }
      />
      <NetBanner live={live} />
      {isOrganiser && !member?.is_player && (
        <div className="net-banner" style={{ background: 'var(--c-info-bg)', color: 'var(--c-info)' }}>
          Organiser preview — you see every {theme.vocab.challenge.toLowerCase()}, including hidden ones.
        </div>
      )}
      <main className="page stack-lg" id="main">
        {children}
      </main>
      <BottomNav
        items={[
          { to: base, label: 'Home', icon: 'home', end: true },
          { to: `${base}/play`, label: theme.vocab.challenges, icon: 'target' },
          { to: `${base}/board`, label: 'Board', icon: 'trophy' },
          { to: `${base}/card`, label: 'Card', icon: 'list-checks' },
          { to: `${base}/feed`, label: 'Moments', icon: 'image' },
        ]}
      />
    </>
  );
}
