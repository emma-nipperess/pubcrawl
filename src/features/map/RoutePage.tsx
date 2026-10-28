import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayerShell } from '@/features/play/PlayerShell';
import { useGame } from '@/features/play/useGame';
import { useAnnouncements } from '@/lib/supabase/queries';
import { Badge, Button, EmptyState, ErrorState, LoadingBlock } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { directionsUrl } from '@/features/venues/progress';
import { stateLabel } from '@/features/play/RouteStrip';
import { formatTime, timeAgo } from '@/lib/format';
import { RouteMap, MapCredit } from './LazyMap';
import { stopsFromProgress } from './stops';
import { formatDistance, haversine, legs, venueLatLng, walkingMinutes, type LatLng } from './geo';

/** The crawl's pathway: map + ordered timeline of venues and announcements. */
export default function RoutePage() {
  const g = useGame();
  const { event, theme } = g;
  const fb = useFeedback();
  const ann = useAnnouncements(event.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  const items = useMemo(() => g.progress.filter((p) => p.state !== 'disabled'), [g.progress]);
  const stops = useMemo(() => stopsFromProgress(items), [items]);
  const points = items.map((i) => venueLatLng(i.venue));
  const legDistances = legs(points);
  const mapped = points.filter(Boolean).length;
  const total = legDistances.reduce<number>((a, d) => a + (d ?? 0), 0);
  const current = g.summary.current;

  if (g.loading)
    return (
      <PlayerShell title="Route">
        <LoadingBlock />
      </PlayerShell>
    );
  if (g.error)
    return (
      <PlayerShell title="Route">
        <ErrorState error={g.error} onRetry={g.refetch} />
      </PlayerShell>
    );

  // Location is optional, one-off, and stays on this device (never sent anywhere).
  const locate = () => {
    if (!navigator.geolocation) return fb.toast('Location isn’t available in this browser', 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        fb.toast('Couldn’t get your location', 'error');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const nextTarget = current ?? g.summary.next;
  const nextAt = nextTarget ? venueLatLng(nextTarget.venue) : null;

  return (
    <PlayerShell title="Route">
      <div className="row-between">
        <h1 className="deco-title">The route</h1>
        {mapped > 1 && <Badge icon="footprints">{formatDistance(total)} · ~{walkingMinutes(total)} min walk</Badge>}
      </div>

      {items.length === 0 ? (
        <EmptyState icon="route" title="No route yet">The organiser is still planning.</EmptyState>
      ) : (
        <>
          {mapped > 0 ? (
            <>
              <RouteMap stops={stops} dark={theme.dark} onSelect={setSelected} selectedId={selected} meLocation={me} height={340} />
              <div className="row-wrap">
                <Button size="sm" icon="navigation" loading={locating} onClick={locate}>
                  {me ? 'Update my location' : 'Show me on the map'}
                </Button>
                {me && nextAt && nextTarget && (
                  <span className="small">
                    {formatDistance(haversine(me, nextAt))} to {nextTarget.venue.name} · ~{walkingMinutes(haversine(me, nextAt))} min
                  </span>
                )}
              </div>
              <MapCredit />
            </>
          ) : (
            <EmptyState icon="map-pin" title="Map coming soon">The organiser hasn’t pinned the venues yet. Directions links still work below.</EmptyState>
          )}
          {mapped > 0 && mapped < items.length && <p className="xsmall muted">{items.length - mapped} venue(s) aren’t on the map yet.</p>}

          <ol className="timeline" aria-label="Route timeline">
            {items.map((p, i) => {
              const dir = directionsUrl(p.venue);
              const d = legDistances[i];
              const data = p.state === 'active' || p.state === 'active_skipped' ? 'active' : p.state === 'done' ? 'done' : ['upcoming'].includes(p.state) ? undefined : 'skipped';
              const notes = (ann.data ?? []).filter((a) => a.kind === 'venue_change' && p.venue.activated_at && new Date(a.created_at) >= new Date(p.venue.activated_at) && (!p.venue.closed_at || new Date(a.created_at) <= new Date(p.venue.closed_at)));
              return (
                <Fragment key={p.venue.id}>
                  <li data-state={data} id={`stop-${p.venue.id}`}>
                    <button
                      type="button"
                      onClick={() => setSelected(p.venue.id)}
                      className={`card card--tight ${selected === p.venue.id ? '' : 'card--flat'}`}
                      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                      aria-pressed={selected === p.venue.id}
                    >
                      <span className="eyebrow">
                        {theme.vocab.venue} {i + 1} · {stateLabel(p.state)}
                      </span>
                      <strong style={{ display: 'block', fontSize: 'var(--fs-md)' }}>{p.venue.name}</strong>
                      {p.venue.address && <span className="xsmall muted" style={{ display: 'block' }}>{p.venue.address}</span>}
                      {(p.venue.arrive_at || p.venue.depart_at) && (
                        <span className="xsmall" style={{ display: 'block' }}>
                          <Icon name="clock" size={12} /> {formatTime(p.venue.arrive_at)}
                          {p.venue.depart_at ? ` – ${formatTime(p.venue.depart_at)}` : ''}
                        </span>
                      )}
                    </button>
                    <div className="row-wrap" style={{ marginTop: 6 }}>
                      {dir && (
                        <a className="btn btn--sm" href={dir} target="_blank" rel="noopener noreferrer">
                          <Icon name="navigation" /> Directions
                        </a>
                      )}
                      <Link className="btn btn--sm btn--ghost" to={`/e/${event.id}/play/${p.venue.id}`}>
                        {theme.vocab.challenges}
                      </Link>
                    </div>
                    {notes.map((a) => (
                      <p key={a.id} className="xsmall" style={{ marginTop: 6 }}>
                        <Icon name="megaphone" size={12} /> {a.body} · {timeAgo(a.created_at)}
                      </p>
                    ))}
                  </li>
                  {i < items.length - 1 && d != null && (
                    <li className="leg" aria-label={`${formatDistance(d)} to the next stop`} style={{ paddingBottom: 'var(--s-3)' }}>
                      <Icon name="footprints" size={14} /> {formatDistance(d)} · ~{walkingMinutes(d)} min
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        </>
      )}
    </PlayerShell>
  );
}
