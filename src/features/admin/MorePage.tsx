import { Link } from 'react-router-dom';
import { AdminShell } from './AdminRoutes';
import { Icon } from '@/components/Icon';

const ITEMS = [
  { to: '../share', icon: 'share', title: 'Invite', body: 'Link, code, QR and group-chat message' },
  { to: '../scores', icon: 'trophy', title: 'Scores & export', body: 'Corrections with audit trail, CSV results' },
  { to: '../settings', icon: 'settings', title: 'Settings', body: 'Details, theme, rules, duplicate, delete' },
];

export default function MorePage() {
  return (
    <AdminShell title="More">
      <h1 className="deco-title">More</h1>
      <ul className="list">
        {ITEMS.map((i) => (
          <li key={i.to}>
            <Link to={i.to} relative="path" className="list-row" style={{ textDecoration: 'none' }}>
              <span className="avatar" style={{ background: 'var(--c-accent-2)' }}>
                <Icon name={i.icon} />
              </span>
              <span className="grow">
                <strong>{i.title}</strong>
                <span className="xsmall muted" style={{ display: 'block' }}>
                  {i.body}
                </span>
              </span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}
