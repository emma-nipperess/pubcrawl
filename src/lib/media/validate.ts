/**
 * Client-side media checks. These give fast, friendly feedback; the Storage
 * bucket's own size/MIME limits and the submit_challenge RPC (which reads the
 * MIME type Storage recorded) are the enforcement points.
 */

export const LIMITS = {
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024, // Supabase free tier per-file cap
  maxFiles: 4,
  imageMaxEdge: 2048,
  thumbEdge: 480,
};

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export function extensionFor(mime: string): string {
  return EXT[mime] ?? 'bin';
}

/** Identify a file by its leading bytes (magic numbers), ignoring its name and claimed type. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.slice(start, start + len));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    // isom, iso2, mp41, mp42, avc1, M4V, 3gp… all play as MP4
    return 'video/mp4';
  }
  return null;
}

export type Accept = 'photo' | 'video' | 'either';

export interface FileCheck {
  ok: boolean;
  mime?: string;
  kind?: 'image' | 'video';
  error?: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Validate a file's real type (from its bytes) and size against what the challenge accepts. */
export function checkFile(head: Uint8Array, size: number, accept: Accept): FileCheck {
  const mime = sniffMime(head);
  if (!mime) return { ok: false, error: 'That file type is not supported. Use a JPEG, PNG, HEIC or WebP photo, or an MP4, MOV or WebM video.' };
  const kind = mime.startsWith('image/') ? 'image' : 'video';
  if (accept === 'photo' && kind !== 'image') return { ok: false, error: 'This challenge needs a photo, not a video.' };
  if (accept === 'video' && kind !== 'video') return { ok: false, error: 'This challenge needs a video, not a photo.' };
  const limit = kind === 'image' ? LIMITS.imageBytes : LIMITS.videoBytes;
  if (size <= 0) return { ok: false, error: 'That file is empty.' };
  if (size > limit) {
    return {
      ok: false,
      error: `That ${kind === 'image' ? 'photo' : 'video'} is ${formatBytes(size)} — the limit is ${formatBytes(limit)}.${kind === 'video' ? ' Try a shorter clip.' : ''}`,
    };
  }
  return { ok: true, mime, kind };
}

export function acceptAttr(accept: Accept): string {
  if (accept === 'photo') return 'image/*';
  if (accept === 'video') return 'video/*';
  return 'image/*,video/*';
}

/** Unique, non-guessable object path scoped to event / user / submission. */
export function proofPath(eventId: string, userId: string, submissionId: string, mime: string, suffix = ''): string {
  const rand = crypto.randomUUID().slice(0, 8);
  return `${eventId}/${userId}/${submissionId}/${rand}${suffix}.${extensionFor(mime)}`;
}
