import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './client';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** Which cached queries a change to each table makes stale. */
const TABLE_KEYS: Record<string, string[]> = {
  events: ['event', 'leaderboard', 'challenges'],
  event_members: ['members', 'me', 'leaderboard'],
  venues: ['venues', 'challenges', 'leaderboard'],
  teams: ['teams', 'leaderboard'],
  team_members: ['teams', 'me', 'leaderboard', 'submissions'],
  challenges: ['challenges'],
  challenge_submissions: ['submissions', 'feed', 'review'],
  venue_participation: ['participation'],
  score_ledger: ['leaderboard', 'ledger'],
  event_announcements: ['announcements'],
  member_achievements: ['achievements'],
  golf_scores: ['golf', 'leaderboard'],
};

/**
 * One Realtime channel per open event. Postgres Changes are filtered by
 * event_id and by RLS on the server; each change is only used as a signal to
 * refetch authoritative state (debounced). On reconnect everything for the
 * event is refetched, so a phone that dropped signal catches up. While not
 * connected, callers can fall back to polling via the returned status.
 */
export function useEventRealtime(eventId: string | undefined): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasLive = useRef(false);
  const wasLiveNow = useRef(false);

  useEffect(() => {
    if (!eventId) return;
    let channel: RealtimeChannel | null = null;
    let disposed = false;

    const flush = () => {
      timer.current = null;
      const ks = [...pending.current];
      pending.current.clear();
      ks.forEach((k) => qc.invalidateQueries({ queryKey: [k, eventId] }));
    };
    const schedule = (table: string) => {
      (TABLE_KEYS[table] ?? []).forEach((k) => pending.current.add(k));
      if (!timer.current) timer.current = setTimeout(flush, 350);
    };
    const refetchAll = () => Object.values(TABLE_KEYS).flat().forEach((k) => qc.invalidateQueries({ queryKey: [k, eventId] }));

    channel = supabase.channel(`event:${eventId}`);
    for (const table of Object.keys(TABLE_KEYS)) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: table === 'events' ? `id=eq.${eventId}` : `event_id=eq.${eventId}` },
        () => schedule(table),
      );
    }
    channel.subscribe((s) => {
      if (disposed) return;
      if (s === 'SUBSCRIBED') {
        if (wasLive.current) refetchAll();
        wasLive.current = true;
        wasLiveNow.current = true;
        setStatus('live');
      } else {
        wasLiveNow.current = false;
      }
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      } else if (s === 'CLOSED') {
        setStatus('reconnecting');
      }
    });

    const onOnline = () => {
      setStatus('reconnecting');
      refetchAll();
    };
    const onOffline = () => setStatus('offline');
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchAll();
    };
    // polling fallback: while the channel isn't live, refetch every 20 s
    const poll = setInterval(() => {
      if (!wasLiveNow.current && document.visibilityState === 'visible' && navigator.onLine) refetchAll();
    }, 20_000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      clearInterval(poll);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  return status;
}

