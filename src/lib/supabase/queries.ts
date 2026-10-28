import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './client';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import type {
  AchievementDefRow,
  AdjustmentRow,
  AnnouncementRow,
  AuditRow,
  ChallengeRow,
  EventPreview,
  EventRow,
  LedgerRow,
  Leaderboard,
  MediaRow,
  MemberAchievementRow,
  MemberRow,
  ParticipationRow,
  SubmissionRow,
  TeamMemberRow,
  TeamRow,
  TemplateRow,
  VenueRow,
} from './types';

/** Throw a readable error from a Supabase response. */
function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const e = res.error as { message?: string };
    const err = new Error(friendlyError(res.error));
    (err as Error & { raw?: unknown }).raw = res.error;
    if (e.message && err.message !== e.message) err.cause = e.message;
    throw err;
  }
  return res.data as T;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return unwrap<T>(await supabase.rpc(fn, args));
}

export const keys = {
  event: (id: string) => ['event', id] as const,
  me: (id: string) => ['me', id] as const,
  venues: (id: string) => ['venues', id] as const,
  notes: (id: string) => ['notes', id] as const,
  challenges: (id: string) => ['challenges', id] as const,
  answers: (id: string) => ['answers', id] as const,
  teams: (id: string) => ['teams', id] as const,
  members: (id: string) => ['members', id] as const,
  participation: (id: string) => ['participation', id] as const,
  submissions: (id: string, scope: string) => ['submissions', id, scope] as const,
  feed: (id: string) => ['feed', id] as const,
  review: (id: string, status: string) => ['review', id, status] as const,
  ledger: (id: string, scope: string) => ['ledger', id, scope] as const,
  leaderboard: (id: string, venue?: string | null) => ['leaderboard', id, venue ?? 'all'] as const,
  announcements: (id: string) => ['announcements', id] as const,
  achievements: (id: string) => ['achievements', id] as const,
  invite: (id: string) => ['invite', id] as const,
  adjustments: (id: string) => ['adjustments', id] as const,
  audit: (id: string) => ['audit', id] as const,
  preview: (code: string) => ['preview', code] as const,
  myEvents: (uid: string) => ['myEvents', uid] as const,
  templates: (uid: string) => ['templates', uid] as const,
};

// ---------------------------------------------------------------------------
// Event-scoped reads (all filtered further by RLS)
// ---------------------------------------------------------------------------
export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.event(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () => unwrap<EventRow | null>(await supabase.from('events').select('*').eq('id', eventId!).maybeSingle()),
  });
}

export function useMyMembership(eventId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...keys.me(eventId ?? ''), user?.id ?? 'anon'],
    enabled: Boolean(eventId && user),
    queryFn: async () => {
      const member = unwrap<MemberRow | null>(
        await supabase.from('event_members').select('*').eq('event_id', eventId!).eq('user_id', user!.id).maybeSingle(),
      );
      let teamId: string | null = null;
      if (member) {
        const tm = unwrap<{ team_id: string }[]>(
          await supabase.from('team_members').select('team_id').eq('member_id', member.id).is('left_at', null),
        );
        teamId = tm[0]?.team_id ?? null;
      }
      return { member, teamId };
    },
  });
}

export function useVenues(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.venues(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () => unwrap<VenueRow[]>(await supabase.from('venues').select('*').eq('event_id', eventId!).order('position')),
  });
}

export function useVenueNotes(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.notes(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () => {
      const rows = unwrap<{ venue_id: string; notes: string }[]>(
        await supabase.from('venue_organiser_notes').select('venue_id, notes').eq('event_id', eventId!),
      );
      return Object.fromEntries(rows.map((r) => [r.venue_id, r.notes])) as Record<string, string>;
    },
  });
}

export function useChallenges(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.challenges(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () =>
      unwrap<ChallengeRow[]>(await supabase.from('challenges').select('*').eq('event_id', eventId!).order('position')),
  });
}

export function useAnswers(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.answers(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () => {
      const rows = unwrap<{ challenge_id: string; correct_choice: number | null; accepted_answers: string[] | null }[]>(
        await supabase.from('challenge_answers').select('challenge_id, correct_choice, accepted_answers').eq('event_id', eventId!),
      );
      return Object.fromEntries(rows.map((r) => [r.challenge_id, r]));
    },
  });
}

export function useTeams(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.teams(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const [teams, links] = await Promise.all([
        supabase.from('teams').select('*').eq('event_id', eventId!).order('created_at'),
        supabase.from('team_members').select('*').eq('event_id', eventId!).is('left_at', null),
      ]);
      return { teams: unwrap<TeamRow[]>(teams), links: unwrap<TeamMemberRow[]>(links) };
    },
  });
}

export function useMembers(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.members(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () =>
      unwrap<MemberRow[]>(await supabase.from('event_members').select('*').eq('event_id', eventId!).order('joined_at')),
  });
}

export function useParticipation(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.participation(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () =>
      unwrap<ParticipationRow[]>(await supabase.from('venue_participation').select('*').eq('event_id', eventId!)),
  });
}

/** My submissions plus my current team's (for team challenge state). */
export function useMySubmissions(eventId: string | undefined, memberId: string | undefined, teamId: string | null | undefined) {
  return useQuery({
    queryKey: keys.submissions(eventId ?? '', `${memberId}:${teamId ?? ''}`),
    enabled: Boolean(eventId && memberId),
    queryFn: async () => {
      let q = supabase.from('challenge_submissions').select('*, submission_media(*)').eq('event_id', eventId!);
      q = teamId ? q.or(`member_id.eq.${memberId},team_id.eq.${teamId}`) : q.eq('member_id', memberId!);
      return unwrap<(SubmissionRow & { submission_media: MediaRow[] })[]>(await q.order('created_at', { ascending: false }).limit(500));
    },
  });
}

export type FeedItem = SubmissionRow & { submission_media: MediaRow[] };

/** Recent approved, visible submissions (paged, newest first). */
export function useFeed(eventId: string | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.feed(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const size = 12;
      const rows = unwrap<FeedItem[]>(
        await supabase
          .from('challenge_submissions')
          .select('*, submission_media(*)')
          .eq('event_id', eventId!)
          .eq('status', 'approved')
          .eq('hidden', false)
          .order('created_at', { ascending: false })
          .range(pageParam * size, pageParam * size + size - 1),
      );
      return { rows, next: rows.length === size ? pageParam + 1 : undefined };
    },
    getNextPageParam: (last) => last.next,
  });
}

export function useReviewQueue(eventId: string | undefined, status: 'pending' | 'reviewed', enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.review(eventId ?? '', status),
    enabled: Boolean(eventId) && enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const size = 15;
      let q = supabase.from('challenge_submissions').select('*, submission_media(*)').eq('event_id', eventId!);
      q = status === 'pending' ? q.eq('status', 'pending').order('created_at', { ascending: true }) : q.neq('status', 'pending').order('updated_at', { ascending: false });
      const rows = unwrap<FeedItem[]>(await q.range(pageParam * size, pageParam * size + size - 1));
      return { rows, next: rows.length === size ? pageParam + 1 : undefined };
    },
    getNextPageParam: (last) => last.next,
  });
}

export function useLedger(eventId: string | undefined, memberId: string | undefined, teamId: string | null | undefined) {
  return useQuery({
    queryKey: keys.ledger(eventId ?? '', `${memberId}:${teamId ?? ''}`),
    enabled: Boolean(eventId && (memberId || teamId)),
    queryFn: async () => {
      let q = supabase.from('score_ledger').select('*').eq('event_id', eventId!);
      q = memberId && teamId ? q.or(`member_id.eq.${memberId},team_id.eq.${teamId}`) : memberId ? q.eq('member_id', memberId) : q.eq('team_id', teamId!);
      return unwrap<LedgerRow[]>(await q.limit(2000));
    },
  });
}

export function useLeaderboard(eventId: string | undefined, venueId?: string | null) {
  return useQuery({
    queryKey: keys.leaderboard(eventId ?? '', venueId),
    enabled: Boolean(eventId),
    queryFn: () => rpc<Leaderboard>('get_leaderboard', { p_event_id: eventId, p_venue_id: venueId ?? null }),
  });
}

export function useAnnouncements(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.announcements(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () =>
      unwrap<AnnouncementRow[]>(
        await supabase
          .from('event_announcements')
          .select('*')
          .eq('event_id', eventId!)
          .is('deleted_at', null)
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(30),
      ),
  });
}

export function useAchievements(eventId: string | undefined) {
  return useQuery({
    queryKey: keys.achievements(eventId ?? ''),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const [defs, awards] = await Promise.all([
        supabase.from('achievement_definitions').select('*').eq('event_id', eventId!).order('created_at'),
        supabase.from('member_achievements').select('*').eq('event_id', eventId!).order('created_at', { ascending: false }).limit(200),
      ]);
      return { defs: unwrap<AchievementDefRow[]>(defs), awards: unwrap<MemberAchievementRow[]>(awards) };
    },
  });
}

export function useInvite(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.invite(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () =>
      unwrap<{ code: string; rotated_at: string } | null>(
        await supabase.from('event_invites').select('code, rotated_at').eq('event_id', eventId!).maybeSingle(),
      ),
  });
}

export function useAdjustments(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.adjustments(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () =>
      unwrap<AdjustmentRow[]>(
        await supabase.from('score_adjustments').select('*').eq('event_id', eventId!).order('created_at', { ascending: false }).limit(100),
      ),
  });
}

export function useAudit(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.audit(eventId ?? ''),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () =>
      unwrap<AuditRow[]>(
        await supabase.from('event_audit_log').select('*').eq('event_id', eventId!).order('created_at', { ascending: false }).limit(100),
      ),
  });
}

export function usePreview(code: string | undefined) {
  return useQuery({
    queryKey: keys.preview(code ?? ''),
    enabled: Boolean(code),
    retry: 1,
    queryFn: () => rpc<EventPreview | null>('get_event_preview', { p_code: code }),
  });
}

export function useMyEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.myEvents(user?.id ?? ''),
    enabled: Boolean(user),
    queryFn: async () => {
      const rows = unwrap<(MemberRow & { events: Pick<EventRow, 'id' | 'name' | 'theme_key' | 'status' | 'event_date'> | null })[]>(
        await supabase
          .from('event_members')
          .select('*, events(id, name, theme_key, status, event_date)')
          .eq('user_id', user!.id)
          .order('joined_at', { ascending: false })
          .limit(50),
      );
      return rows.filter((r) => r.events);
    },
  });
}

export function useTemplates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.templates(user?.id ?? ''),
    enabled: Boolean(user),
    queryFn: async () =>
      unwrap<TemplateRow[]>(await supabase.from('event_templates').select('*').eq('owner_id', user!.id).order('created_at', { ascending: false })),
  });
}

export function usePublicEvents() {
  return useQuery({
    queryKey: ['publicEvents'],
    queryFn: () =>
      rpc<{ id: string; name: string; event_date: string | null; start_time: string | null; theme_key: string; status: string; organiser_name: string; member_count: number }[]>(
        'list_public_events',
      ),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
/** Small wrapper so every mutation refreshes the relevant event caches. */
export function useEventMutation<TArgs, TResult>(eventId: string | undefined, fn: (args: TArgs) => Promise<TResult>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      if (!eventId) return;
      const ks = invalidate.length ? invalidate : [['event', eventId]];
      ks.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export const db = {
  update: async <T extends object>(table: string, id: string, patch: T) => unwrap(await supabase.from(table).update(patch).eq('id', id).select().maybeSingle()),
  remove: async (table: string, id: string) => {
    unwrap(await supabase.from(table).delete().eq('id', id));
  },
  insert: async <T extends object>(table: string, row: T) => unwrap(await supabase.from(table).insert(row).select().single()),
};
