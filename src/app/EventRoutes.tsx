import { createContext, lazy, useContext, useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useEvent, useMyMembership } from '@/lib/supabase/queries';
import { useEventRealtime, type LiveStatus } from '@/lib/supabase/realtime';
import type { EventRow, MemberRow } from '@/lib/supabase/types';
import { ThemeScope } from '@/features/themes/ThemeScope';
import { getTheme, type ThemeDef } from '@/features/themes/themes';
import { TopBar } from '@/components/Shell';
import { EmptyState, ErrorState, LinkButton, LoadingBlock } from '@/components/ui';
import { rememberEvent, forgetEvent } from '@/lib/recent';

const Dashboard = lazy(() => import('@/features/play/Dashboard'));
const PlayVenue = lazy(() => import('@/features/play/PlayVenue'));
const Board = lazy(() => import('@/features/leaderboard/BoardPage'));
const CardPage = lazy(() => import('@/features/play/ScorecardPage'));
const Feed = lazy(() => import('@/features/media/FeedPage'));
const Results = lazy(() => import('@/features/play/ResultsPage'));
const AdminRoutes = lazy(() => import('@/features/admin/AdminRoutes'));

export interface EventCtx {
  event: EventRow;
  member: MemberRow | null;
  teamId: string | null;
  theme: ThemeDef;
  isOrganiser: boolean;
  isOwner: boolean;
  live: LiveStatus;
}

const Ctx = createContext<EventCtx | null>(null);
export function useEventCtx(): EventCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEventCtx outside event');
  return v;
}

export default function EventRoutes() {
  const { eventId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const ev = useEvent(user ? eventId : undefined);
  const me = useMyMembership(eventId);
  const live = useEventRealtime(user && ev.data ? eventId : undefined);

  const member = me.data?.member ?? null;
  const active = member?.status === 'active' ? member : null;
  const isOwner = Boolean(ev.data && user && ev.data.owner_id === user.id);
  const isOrganiser = isOwner || active?.role === 'organiser' || active?.role === 'co_organiser';

  useEffect(() => {
    if (ev.data && active) rememberEvent({ id: ev.data.id, name: ev.data.name, theme_key: ev.data.theme_key, role: isOrganiser ? 'organiser' : 'participant' });
    if (eventId && ev.isFetched && !ev.data) forgetEvent(eventId);
  }, [ev.data, ev.isFetched, active, isOrganiser, eventId]);

  if (authLoading || (user && (ev.isLoading || me.isLoading)))
    return (
      <div className="app-root">
        <TopBar />
        <main className="page">
          <LoadingBlock />
        </main>
      </div>
    );

  if (ev.isError)
    return (
      <div className="app-root">
        <TopBar back="/" />
        <main className="page page--no-nav">
          <ErrorState error={ev.error} onRetry={() => ev.refetch()} />
        </main>
      </div>
    );

  if (!user || !ev.data || (!active && !isOwner))
    return (
      <div className="app-root">
        <TopBar back="/" />
        <main className="page page--no-nav">
          <div className="center-screen">
            <EmptyState
              icon="lock"
              title={member?.status === 'removed' ? 'You were removed from this crawl' : member?.status === 'left' ? 'You left this crawl' : 'You’re not in this crawl (yet)'}
              action={<LinkButton to="/" variant="primary">Enter an invite code</LinkButton>}
            >
              {member?.status === 'left'
                ? 'Open the invitation link again to rejoin.'
                : 'Events are private to their participants. Open the invitation link from the organiser on this device to join. If you joined on another phone or browser, use that one — or sign in with the email you linked.'}
            </EmptyState>
          </div>
        </main>
      </div>
    );

  const ctx: EventCtx = { event: ev.data, member: active, teamId: me.data?.teamId ?? null, theme: getTheme(ev.data.theme_key), isOrganiser, isOwner, live };

  return (
    <Ctx.Provider value={ctx}>
      <ThemeScope themeKey={ev.data.theme_key} custom={ev.data.theme_custom}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="play" element={<PlayVenue />} />
          <Route path="play/:venueId" element={<PlayVenue />} />
          <Route path="board" element={<Board />} />
          <Route path="card" element={<CardPage />} />
          <Route path="feed" element={<Feed />} />
          <Route path="results" element={<Results />} />
          <Route path="admin/*" element={isOrganiser ? <AdminRoutes /> : <Navigate to=".." replace />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </ThemeScope>
    </Ctx.Provider>
  );
}
