import { useEffect, useRef, useState } from 'react';
import { signedUrls } from '@/lib/media/upload';
import type { MediaRow } from '@/lib/supabase/types';
import { Icon } from '@/components/Icon';

/** Signed URL for a private object, fetched only once the element is near the viewport. */
function useSigned(path: string | null | undefined, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!path || !enabled) return;
    let alive = true;
    signedUrls([path])
      .then((m) => alive && setUrl(m[path] ?? null))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [path, enabled]);
  return { url, err };
}

function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return { ref, near };
}

/**
 * Private proof thumbnail. Loads a small thumbnail when available; full-size
 * photos and videos are only fetched when the user taps to open them.
 */
export function ProofMedia({ media, alt, full = false }: { media: MediaRow; alt: string; full?: boolean }) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const [expanded, setExpanded] = useState(full);
  const thumbPath = media.thumb_path ?? (media.kind === 'image' ? media.object_path : null);
  const thumb = useSigned(expanded && media.kind === 'image' ? media.object_path : thumbPath, near);
  const video = useSigned(media.kind === 'video' && expanded ? media.object_path : null, near);

  return (
    <div ref={ref} className="media-tile" style={{ aspectRatio: expanded ? 'auto' : '1' }}>
      {media.kind === 'video' && expanded ? (
        video.url ? (
          <video src={video.url} controls playsInline autoPlay={!full} preload="metadata" aria-label={alt} style={{ maxHeight: '70dvh', width: '100%', objectFit: 'contain', background: '#000' }} />
        ) : (
          <div className="skeleton" style={{ width: '100%', aspectRatio: '16/9' }} />
        )
      ) : thumb.url ? (
        <button type="button" onClick={() => setExpanded(true)} style={{ all: 'unset', cursor: 'zoom-in', display: 'block', width: '100%', height: '100%' }} aria-label={media.kind === 'video' ? `Play video: ${alt}` : `Open photo: ${alt}`}>
          <img src={thumb.url} alt={alt} loading="lazy" decoding="async" width={media.width ?? undefined} height={media.height ?? undefined} style={expanded ? { objectFit: 'contain', height: 'auto', maxHeight: '70dvh' } : undefined} />
        </button>
      ) : thumb.err ? (
        <div className="center-screen" style={{ minHeight: 0, height: '100%' }}>
          <Icon name="eye-off" label="Media unavailable" />
        </div>
      ) : media.kind === 'video' && !thumbPath ? (
        <button type="button" onClick={() => setExpanded(true)} className="btn btn--ghost" style={{ width: '100%', height: '100%', borderRadius: 0 }}>
          <Icon name="play" size={32} /> Play
        </button>
      ) : (
        <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
      )}
      {media.kind === 'video' && !expanded && thumb.url && (
        <span className="media-tile__badge badge">
          <Icon name="play" size={12} /> Video
        </span>
      )}
    </div>
  );
}
