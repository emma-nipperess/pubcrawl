import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PlayerShell } from '@/features/play/PlayerShell';
import { useEventCtx } from '@/app/EventRoutes';
import { useChallenges, useFeed, useMembers, useTeams } from '@/lib/supabase/queries';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingBlock, Segmented, Select, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { ProofMedia } from './ProofMedia';
import { supabase } from '@/lib/supabase/client';
import { downloadAllMedia, listEventMedia, saveBlob, zipEntryName, type DownloadProgress, type EventMediaItem } from './downloadAll';
import { formatBytes } from '@/lib/media/validate';
import { timeAgo } from '@/lib/format';
import type { MediaRow } from '@/lib/supabase/types';

const asMediaRow = (m: EventMediaItem): MediaRow =>
  ({ id: m.media_id, submission_id: m.submission_id, object_path: m.object_path, thumb_path: m.thumb_path, kind: m.kind, mime_type: m.mime_type, size_bytes: m.size_bytes, width: m.width, height: m.height }) as MediaRow;

export default function FeedPage() {
  const { event, theme } = useEventCtx();
  const [view, setView] = useState<'gallery' | 'feed'>('gallery');
  return (
    <PlayerShell title="Moments">
      <h1 className="deco-title">Moments</h1>
      {!event.show_others_submissions && <Banner tone="info" icon="eye-off">The organiser keeps other players’ photos private. You’ll see your own and your {theme.vocab.team.toLowerCase()}’s.</Banner>}
      <Segmented
        legend="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'gallery', label: 'All photos & videos', icon: 'grid' },
          { value: 'feed', label: 'Feed', icon: 'image' },
        ]}
      />
      {view === 'gallery' ? <Gallery /> : <Feed />}
    </PlayerShell>
  );
}

function Gallery() {
  const { event } = useEventCtx();
  const fb = useFeedback();
  const media = useQuery({ queryKey: ['feed', event.id, 'gallery'], queryFn: () => listEventMedia(event.id) });
  const [who, setWho] = useState('');
  const [open, setOpen] = useState<EventMediaItem | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const abort = useRef<AbortController | null>(null);

  const all = useMemo(() => media.data ?? [], [media.data]);
  const people = useMemo(() => [...new Set(all.map((m) => m.team_name ?? m.member_name))].sort(), [all]);
  const shown = who ? all.filter((m) => (m.team_name ?? m.member_name) === who) : all;
  const bytes = shown.reduce((a, m) => a + Number(m.size_bytes || 0), 0);

  const downloadAll = async () => {
    if (!shown.length || progress) return;
    const ok = await fb.confirm({
      title: `Download ${shown.length} ${shown.length === 1 ? 'file' : 'files'}?`,
      body: `About ${formatBytes(bytes)} as one zip file. ${bytes > 200 * 1024 * 1024 ? 'That’s a lot — use Wi-Fi and keep this screen open.' : 'Keep this screen open until it finishes.'} Please only share other people’s photos with their permission.`,
      confirmLabel: 'Download',
    });
    if (!ok) return;
    abort.current = new AbortController();
    try {
      const { blob, filename, failed } = await downloadAllMedia(event.name, shown, setProgress, abort.current.signal);
      saveBlob(blob, filename);
      fb.toast(failed ? `Downloaded, but ${failed} file(s) couldn’t be fetched` : 'Download ready', failed ? 'error' : 'success');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fb.error(e);
      else fb.toast('Download cancelled');
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  if (media.isLoading) return <LoadingBlock />;
  if (media.isError) return <ErrorState error={media.error} onRetry={() => media.refetch()} />;
  if (all.length === 0) return <EmptyState icon="camera" title="No photos yet">Photos and videos from every {event.play_mode === 'individual' ? 'player' : 'team'} appear here as they’re submitted.</EmptyState>;

  return (
    <section className="stack">
      <div className="row-wrap">
        {people.length > 1 && (
          <div className="grow" style={{ minWidth: 180 }}>
            <Select label="Show" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone ({all.length})</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {p} ({all.filter((m) => (m.team_name ?? m.member_name) === p).length})
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {progress ? (
        <Card className="stack-sm" role="status" aria-live="polite">
          <div className="row-between small">
            <strong>
              Downloading {progress.done} of {progress.total}
            </strong>
            <span className="muted">
              {formatBytes(progress.bytes)} / {formatBytes(progress.totalBytes)}
            </span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Download progress">
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <Button size="sm" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        </Card>
      ) : (
        <Button variant="secondary" icon="download" block onClick={downloadAll}>
          Download all{who ? ` from ${who}` : ''} ({shown.length} · {formatBytes(bytes)})
        </Button>
      )}
      <ul className="media-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((m) => (
          <li key={m.media_id} style={{ position: 'relative' }}>
            <button type="button" onClick={() => setOpen(m)} style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }} aria-label={`Open ${m.kind === 'video' ? 'video' : 'photo'} by ${m.member_name}: ${m.challenge_title}`}>
              <div style={{ pointerEvents: 'none' }}>
                <ProofMedia media={asMediaRow(m)} alt={`${m.challenge_title} by ${m.member_name}`} />
              </div>
            </button>
            {m.status === 'pending' && (
              <span className="badge badge--warn" style={{ position: 'absolute', top: 4, left: 4, minHeight: 20, padding: '0 6px' }}>
                <Icon name="hourglass" size={12} />
                <span className="sr-only">Awaiting review</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.challenge_title ?? ''}>
        {open && (
          <div className="stack-sm">
            <ProofMedia key={open.media_id} media={asMediaRow(open)} alt={`${open.challenge_title} by ${open.member_name}`} full />
            <p>
              <strong>{open.member_name}</strong>
              {open.team_name ? ` · ${open.team_name}` : ''}
              {open.venue_name ? ` · ${open.venue_name}` : ''}
            </p>
            {open.caption && <p className="prewrap">{open.caption}</p>}
            <div className="row-wrap">
              <span className="xsmall muted">{timeAgo(open.created_at)}</span>
              {open.status === 'pending' && <Badge tone="warn">Awaiting review</Badge>}
            </div>
            <SingleDownload item={open} />
          </div>
        )}
      </Sheet>
    </section>
  );
}

function SingleDownload({ item }: { item: EventMediaItem }) {
  const fb = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon="download"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { data, error } = await supabase.storage.from('proof').download(item.object_path);
          if (error || !data) throw error ?? new Error('Download failed');
          saveBlob(data, zipEntryName(item, 0).replace(/^\d{3} /, ''));
        } catch (e) {
          fb.error(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      Download this
    </Button>
  );
}

function Feed() {
  const { event, theme } = useEventCtx();
  const feed = useFeed(event.id);
  const members = useMembers(event.id);
  const challenges = useChallenges(event.id);
  const teams = useTeams(event.id);
  const rows = feed.data?.pages.flatMap((p) => p.rows) ?? [];
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';
  const titleOf = (id: string) => challenges.data?.find((c) => c.id === id)?.title ?? theme.vocab.challenge;
  const teamOf = (id: string | null) => teams.data?.teams.find((t) => t.id === id);

  if (feed.isLoading) return <LoadingBlock />;
  if (feed.isError) return <ErrorState error={feed.error} onRetry={() => feed.refetch()} />;
  if (rows.length === 0) return <EmptyState icon="camera" title="Nothing yet">Completed {theme.vocab.challenges.toLowerCase()} show up here.</EmptyState>;

  return (
    <>
      <ul className="list" style={{ gap: 'var(--s-4)' }}>
        {rows.map((s) => {
          const t = teamOf(s.team_id);
          return (
            <li key={s.id}>
              <Card className="stack-sm" style={{ padding: 'var(--s-3)' }}>
                <div className="row-between">
                  <div style={{ minWidth: 0 }}>
                    <strong className="truncate" style={{ display: 'block' }}>
                      {s.scope === 'team' && t ? t.name : nameOf(s.member_id)}
                    </strong>
                    <span className="xsmall muted">
                      {titleOf(s.challenge_id)} · {timeAgo(s.created_at)}
                    </span>
                  </div>
                  {s.status === 'pending' ? <Badge tone="warn" icon="hourglass">Awaiting review</Badge> : <span className="badge badge--brass">+{s.points_awarded + s.bonus_awarded}</span>}
                </div>
                {s.submission_media.length > 0 && (
                  <div className={s.submission_media.length > 1 ? 'media-grid' : ''}>
                    {s.submission_media.map((m) => (
                      <ProofMedia key={m.id} media={m} alt={`${titleOf(s.challenge_id)} by ${nameOf(s.member_id)}`} />
                    ))}
                  </div>
                )}
                {s.caption && <p className="prewrap">{s.caption}</p>}
                {s.text_response && !s.submission_media.length && (
                  <p className="prewrap small">
                    <Icon name="message-square" size={14} /> {s.text_response}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {feed.hasNextPage && (
        <Button block loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
          Load more
        </Button>
      )}
    </>
  );
}
