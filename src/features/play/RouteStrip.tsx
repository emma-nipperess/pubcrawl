import { Fragment } from 'react';
import type { VenueProgressItem } from '@/features/venues/progress';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

const STATE_LABEL: Record<VenueProgressItem['state'], string> = {
  upcoming: 'Up next',
  active: 'Now',
  active_skipped: 'Now — skipping',
  done: 'Done',
  skipped: 'Skipped',
  missed: 'Missed',
  before_join: 'Before you joined',
  group_skipped: 'Skipped by the group',
  disabled: 'Off the route',
};

export function stateLabel(s: VenueProgressItem['state']) {
  return STATE_LABEL[s];
}

/** Compact horizontal route with a progress bar. */
export function RouteStrip({ progress, vocab, mapHref }: { progress: VenueProgressItem[]; vocab: { venues: string }; mapHref?: string }) {
  const items = progress.filter((p) => p.state !== 'disabled');
  if (items.length === 0) return null;
  const done = items.filter((i) => !['upcoming', 'active', 'active_skipped'].includes(i.state)).length;
  return (
    <section aria-label={`Route progress: ${done} of ${items.length} ${vocab.venues.toLowerCase()} finished`} className="stack-sm">
      <div className="row-between small">
        <strong>Progress</strong>
        <span className="row" style={{ gap: 10 }}>
          <span className="muted">
            {done}/{items.length}
          </span>
          {mapHref && (
            <Link to={mapHref} className="btn btn--sm">
              <Icon name="map-pin" size={16} /> Map
            </Link>
          )}
        </span>
      </div>
      <div className="route">{stopsList()}</div>
    </section>
  );

  function stopsList() {
    return (
      <>
        {items.map((p, i) => {
          const cls =
            p.state === 'active' || p.state === 'active_skipped'
              ? 'route__stop--active'
              : p.state === 'done'
                ? 'route__stop--done'
                : ['skipped', 'missed', 'group_skipped', 'before_join'].includes(p.state)
                  ? 'route__stop--skipped'
                  : '';
          return (
            <Fragment key={p.venue.id}>
              {i > 0 && <span className="route__line" aria-hidden="true" />}
              <span className={`route__stop ${cls}`} title={`${p.venue.name}: ${STATE_LABEL[p.state]}`}>
                {p.state === 'done' ? <Icon name="check" size={16} /> : i + 1}
                <span className="sr-only">
                  {p.venue.name}, {STATE_LABEL[p.state]}
                </span>
              </span>
            </Fragment>
          );
        })}
      </>
    );
  }
}
