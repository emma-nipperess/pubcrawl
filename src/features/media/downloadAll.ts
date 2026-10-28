import { rpc } from '@/lib/supabase/queries';
import { supabase } from '@/lib/supabase/client';
import { ZipWriter, ZIP_MAX_BYTES, safeFileName } from '@/lib/zip';
import { extensionFor } from '@/lib/media/validate';

export interface EventMediaItem {
  media_id: string;
  submission_id: string;
  object_path: string;
  thumb_path: string | null;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
  status: 'approved' | 'pending' | 'rejected' | 'resubmit' | 'withdrawn';
  member_name: string;
  team_name: string | null;
  challenge_title: string;
  venue_name: string | null;
  caption: string | null;
}

/** Every photo/video the current user is allowed to see in this event (server-filtered). */
export async function listEventMedia(eventId: string): Promise<EventMediaItem[]> {
  const out: EventMediaItem[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rpc<EventMediaItem[]>('list_event_media', { p_event_id: eventId, p_limit: 1000, p_offset: offset });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export function zipEntryName(m: EventMediaItem, index: number): string {
  const when = new Date(m.created_at);
  const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}-${String(when.getHours()).padStart(2, '0')}${String(when.getMinutes()).padStart(2, '0')}`;
  const who = m.team_name ? `${m.team_name} - ${m.member_name}` : m.member_name;
  const base = safeFileName(`${String(index + 1).padStart(3, '0')} ${stamp} ${who} - ${m.challenge_title}`, 140);
  return `${base}.${extensionFor(m.mime_type)}`;
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  failed: number;
}

/**
 * Fetch every visible original file via short-lived signed URLs and build a
 * zip on the device. Nothing is uploaded anywhere; access is re-checked by
 * Storage for every file.
 */
export async function downloadAllMedia(
  eventName: string,
  items: EventMediaItem[],
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; filename: string; failed: number }> {
  const totalBytes = items.reduce((a, m) => a + Number(m.size_bytes || 0), 0);
  if (totalBytes > ZIP_MAX_BYTES) throw new Error('That’s more than 4 GB of media — download from a computer in smaller batches.');
  const zip = new ZipWriter();
  const p: DownloadProgress = { done: 0, total: items.length, bytes: 0, totalBytes, failed: 0 };
  onProgress({ ...p });

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const { data, error } = await supabase.storage.from('proof').createSignedUrls(batch.map((m) => m.object_path), 600);
    if (error) throw error;
    const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
    for (let j = 0; j < batch.length; j++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const m = batch[j];
      const url = urls.get(m.object_path);
      try {
        if (!url) throw new Error('No access');
        const res = await fetch(url, { signal, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const bytes = new Uint8Array(await res.arrayBuffer());
        zip.add(zipEntryName(m, i + j), bytes, new Date(m.created_at));
        p.bytes += bytes.length;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        p.failed++;
      }
      p.done++;
      onProgress({ ...p });
    }
  }
  const slug = safeFileName(eventName).replace(/\s+/g, '-').toLowerCase();
  return { blob: zip.toBlob(), filename: `${slug}-photos.zip`, failed: p.failed };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
