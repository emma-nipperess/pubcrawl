import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Button } from './ui';
import type { LiveStatus } from '@/lib/supabase/realtime';

export function Logo({ small }: { small?: boolean }) {
  return (
    <Link to="/" className="row" style={{ textDecoration: 'none', gap: 8 }} aria-label="Roundhouse home">
      <svg width={small ? 28 : 34} height={small ? 28 : 34} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="var(--c-accent-2)" stroke="var(--c-line)" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="var(--c-line)" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M14 26 V14 h7 a4 4 0 0 1 0 8 h-7 M20 22 l6 4" fill="none" stroke="var(--c-line)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!small && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>Roundhouse</span>}
    </Link>
  );
}

export function TopBar({ title, back, right, wide }: { title?: ReactNode; back?: string | true; right?: ReactNode; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <header className={['topbar', wide && 'topbar--wide'].filter(Boolean).join(' ')}>
      <div className="topbar__inner">
        {back ? (
          <Button variant="ghost" iconOnly icon="arrow-left" onClick={() => (back === true ? nav(-1) : nav(back))}>
            Back
          </Button>
        ) : (
          <Logo small={Boolean(title)} />
        )}
        <div className="topbar__title">{title}</div>
        {right}
      </div>
    </header>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: number;
}

export function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="bottom-nav" aria-label="Event">
      <ul>
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} end={i.end}>
              <Icon name={i.icon} size={24} />
              <span>{i.label}</span>
              {i.badge ? (
                <span className="nav-dot" aria-label={`${i.badge} new`}>
                  {i.badge > 9 ? '9+' : i.badge}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Online / realtime indicator. Shown only when something is wrong. */
export function NetBanner({ live }: { live?: LiveStatus }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!online)
    return (
      <div className="net-banner" role="status">
        <Icon name="wifi-off" size={16} /> You’re offline — showing the last update. Changes will need signal.
      </div>
    );
  if (live === 'reconnecting')
    return (
      <div className="net-banner" role="status">
        <Icon name="refresh" size={16} className="spin" /> Reconnecting to live updates…
      </div>
    );
  return null;
}
