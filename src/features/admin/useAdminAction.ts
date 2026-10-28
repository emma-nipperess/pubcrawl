import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFeedback } from '@/components/feedback';

/**
 * Run an organiser action with a busy flag, an optional confirmation,
 * error toasts and cache refresh for the event.
 */
export function useAdminAction(eventId: string) {
  const qc = useQueryClient();
  const fb = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async <T>(
    id: string,
    fn: () => Promise<T>,
    opts: { success?: string; confirm?: Parameters<typeof fb.confirm>[0]; refresh?: string[] } = {},
  ): Promise<T | undefined> => {
    if (busy) return;
    if (opts.confirm && !(await fb.confirm(opts.confirm))) return;
    setBusy(id);
    try {
      const r = await fn();
      if (opts.success) fb.toast(opts.success, 'success');
      return r;
    } catch (e) {
      fb.error(e);
      return undefined;
    } finally {
      setBusy(null);
      const keys = opts.refresh ?? ['event', 'venues', 'challenges', 'members', 'teams', 'leaderboard', 'review', 'submissions', 'participation', 'announcements', 'ledger', 'notes', 'answers', 'adjustments', 'audit', 'invite', 'me', 'feed', 'achievements'];
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, eventId] }));
    }
  };
  return { run, busy, fb };
}
