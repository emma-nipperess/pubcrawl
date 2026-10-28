import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase/client';

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Upload one object to Supabase Storage with progress events.
 * supabase-js doesn't expose upload progress, so this talks to the same REST
 * endpoint with XMLHttpRequest using the user's own access token (RLS applies).
 * x-upsert is false: existing objects can never be overwritten.
 */
export async function uploadObject(
  bucket: string,
  path: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError('Your session has expired — refresh and try again.', 401, false);
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        message = body.message || body.error || message;
      } catch {
        /* ignore */
      }
      // 409: already uploaded on a previous attempt — treat as success
      if (xhr.status === 409 || /already exists|Duplicate/i.test(message)) {
        onProgress?.(1);
        resolve();
        return;
      }
      if (xhr.status === 413 || /maximum allowed size/i.test(message)) message = 'That file is too large for the server.';
      if (/mime/i.test(message)) message = 'The server rejected that file type.';
      if (xhr.status === 403 || /row-level security/i.test(message)) message = 'Uploads are only open while the crawl is live and you are a participant.';
      reject(new UploadError(message, xhr.status, xhr.status >= 500 || xhr.status === 0 || xhr.status === 429));
    };
    xhr.onerror = () => reject(new UploadError('Connection lost during upload.', 0, true));
    xhr.ontimeout = () => reject(new UploadError('The upload timed out.', 0, true));
    xhr.timeout = 10 * 60 * 1000;
    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new UploadError('Upload cancelled.', 0, false));
    });
    xhr.send(blob);
  });
}

/** Retry transient failures with backoff. */
export async function uploadWithRetry(
  bucket: string,
  path: string,
  blob: Blob,
  contentType: string,
  onProgress?: (f: number) => void,
  attempts = 3,
  signal?: AbortSignal,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await uploadObject(bucket, path, blob, contentType, onProgress, signal);
      return;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof UploadError) || !e.retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

/** Short-lived signed URLs for private proof (cached until shortly before expiry). */
const signedCache = new Map<string, { url: string; expires: number }>();
const SIGNED_TTL = 60 * 30;

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const need: string[] = [];
  for (const p of paths) {
    const hit = signedCache.get(p);
    if (hit && hit.expires > now + 60_000) out[p] = hit.url;
    else need.push(p);
  }
  if (need.length) {
    const { data, error } = await supabase.storage.from('proof').createSignedUrls(need, SIGNED_TTL);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) {
        signedCache.set(row.path, { url: row.signedUrl, expires: now + SIGNED_TTL * 1000 });
        out[row.path] = row.signedUrl;
      }
    }
  }
  return out;
}

export function clearSignedUrlCache() {
  signedCache.clear();
}

export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('event-assets').getPublicUrl(path).data.publicUrl;
}
