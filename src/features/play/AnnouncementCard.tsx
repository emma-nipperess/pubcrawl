import type { AnnouncementRow } from '@/lib/supabase/types';
import { Icon } from '@/components/Icon';
import { timeAgo } from '@/lib/format';

const KIND = {
  info: { icon: 'megaphone', cls: 'banner--info' },
  venue_change: { icon: 'map-pin', cls: 'banner--warn' },
  urgent: { icon: 'alert', cls: 'banner--danger' },
  celebration: { icon: 'party-popper', cls: 'banner--success' },
} as const;

export function AnnouncementCard({ a }: { a: AnnouncementRow }) {
  const k = KIND[a.kind] ?? KIND.info;
  return (
    <div className={`banner ${k.cls}`} role={a.kind === 'urgent' ? 'alert' : 'status'}>
      <Icon name={k.icon} />
      <div className="grow">
        <p className="prewrap" style={{ color: 'var(--c-ink)', fontWeight: 700 }}>
          {a.body}
        </p>
        <span className="xsmall">
          {a.pinned ? 'Pinned · ' : ''}
          {timeAgo(a.created_at)}
        </span>
      </div>
    </div>
  );
}
