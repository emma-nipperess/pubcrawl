/** Turn Supabase / Postgres / network errors into something a person can act on. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.';
  const e = err as { message?: string; code?: string; details?: string; status?: number; name?: string };
  const msg = e.message ?? String(err);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You are offline. We will retry when you are back online.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Could not reach the server. Check your signal and try again.';
  if (e.code === '23503' || /foreign key/i.test(msg)) return 'This has submissions or scores attached, so it cannot be deleted. Disable or archive it instead.';
  if (e.code === '42501' && /permission denied|row-level security/i.test(msg)) return 'You do not have permission to do that.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Your session expired. Refresh the page to continue.';
  if (/Anonymous sign-ins are disabled/i.test(msg))
    return 'Guest sign-in is switched off for this site. The organiser needs to enable Anonymous sign-ins in Supabase.';
  if (/rate limit/i.test(msg)) return 'Too many attempts — wait a minute and try again.';
  if (/payload too large|exceeded the maximum allowed size|413/i.test(msg)) return 'That file is too large.';
  if (/mime type .* is not supported|invalid_mime_type/i.test(msg)) return 'That file type is not supported.';
  // our RPCs raise human-readable messages already
  return msg.length < 240 ? msg : 'Something went wrong. Please try again.';
}
