import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { FeedbackProvider } from '@/components/feedback';
import { supabaseConfigured } from '@/lib/supabase/client';
import { LoadingBlock } from '@/components/ui';
import { Landing } from './pages/Landing';
import { JoinPage } from './pages/JoinPage';
import { NotFound, SetupMissing } from './pages/Misc';
import { ScrollToTop } from './ScrollToTop';

// Organiser + in-event screens are split out so the landing/join path stays small.
const CreateWizard = lazy(() => import('@/features/events/CreateWizard'));
const MyPage = lazy(() => import('./pages/MyPage'));
const Privacy = lazy(() => import('./pages/Privacy'));
const SignIn = lazy(() => import('./pages/SignIn'));
const EventRoutes = lazy(() => import('./EventRoutes'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => count < 3 && !/permission|not found|Join the event/i.test(String((err as Error)?.message)),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      refetchOnWindowFocus: true,
      networkMode: 'online',
    },
    mutations: { retry: 0, networkMode: 'online' },
  },
});

/** Strip the trailing slash Vite adds so BrowserRouter gets "/repo" or "". */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

export function App() {
  if (!supabaseConfigured) return <SetupMissing />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <FeedbackProvider>
          <BrowserRouter basename={basename}>
            <ScrollToTop />
            <Suspense
              fallback={
                <div className="app-root">
                  <main className="page">
                    <LoadingBlock />
                  </main>
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/j/:code" element={<JoinPage />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="/new" element={<CreateWizard />} />
                <Route path="/me" element={<MyPage />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/signin" element={<SignIn />} />
                <Route path="/e/:eventId/*" element={<EventRoutes />} />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </FeedbackProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
