import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase/client';
import { clearRecent } from './recent';
import { clearSignedUrlCache } from './media/upload';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
  /** Returns the signed-in user, creating a guest (anonymous) session if needed. */
  ensureUser: () => Promise<User>;
  sendEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, token: string) => Promise<void>;
  /** Attach an email to the current (guest) account so it can be recovered on another device. */
  linkEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      setLoading(false);
      // keep Realtime authorised as the token refreshes
      if (s?.access_token) supabase.realtime.setAuth(s.access_token);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const ensureUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error || !anon.user) throw error ?? new Error('Could not start a guest session');
    return anon.user;
  }, []);

  const sendEmailCode = useCallback(async (email: string) => {
    const redirect = `${window.location.origin}${import.meta.env.BASE_URL}me`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirect } });
    if (error) throw error;
  }, []);

  const verifyEmailCode = useCallback(async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  }, []);

  const linkEmail = useCallback(async (email: string) => {
    const redirect = `${window.location.origin}${import.meta.env.BASE_URL}me`;
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirect });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearRecent();
    clearSignedUrlCache();
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isAnonymous: Boolean(session?.user?.is_anonymous),
      ensureUser,
      sendEmailCode,
      verifyEmailCode,
      linkEmail,
      signOut,
    }),
    [session, loading, ensureUser, sendEmailCode, verifyEmailCode, linkEmail, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
