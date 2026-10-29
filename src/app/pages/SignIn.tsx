import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '@/components/Shell';
import { Banner, Button, Card, Segmented, TextInput } from '@/components/ui';
import { useFeedback } from '@/components/feedback';
import { useAuth } from '@/lib/auth';

/** Only allow in-app redirects (no open redirects to other sites). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function authMessage(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/already been registered|already registered|email_exists/i.test(m))
    return 'That email already has an account. Choose “Sign in to my account” instead.';
  if (/Token has expired|invalid|otp/i.test(m)) return 'That code didn’t work — it may have expired. Send a new one.';
  if (/rate limit|security purposes|seconds/i.test(m)) return 'Too many emails — wait a minute before asking for another code.';
  if (/Signups not allowed|signup is disabled/i.test(m)) return 'Email sign-up is switched off for this site.';
  return m;
}

export default function SignIn() {
  const { user, isAnonymous, sendEmailCode, verifyEmailCode, linkEmail, verifyLinkCode } = useAuth();
  const [search] = useSearchParams();
  const next = safeNext(search.get('next'));
  const nav = useNavigate();
  const qc = useQueryClient();
  const fb = useFeedback();
  // A guest saving their account keeps the same id (and every event they made or joined).
  const [mode, setMode] = useState<'save' | 'signin'>(isAnonymous ? 'save' : 'signin');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (user && !isAnonymous && !sent) return <Navigate to={next} replace />;

  const saving = mode === 'save' && isAnonymous;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(undefined);
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setErr('Enter a valid email address.');
    setBusy(true);
    try {
      if (!sent) {
        if (saving) await linkEmail(addr);
        else await sendEmailCode(addr);
        setSent(true);
      } else {
        const token = code.replace(/\s/g, '');
        if (saving) await verifyLinkCode(addr, token);
        else await verifyEmailCode(addr, token);
        await qc.invalidateQueries();
        fb.toast(saving ? 'Account saved — sign in with this email on any device' : 'Signed in', 'success');
        nav(next, { replace: true });
      }
    } catch (ex) {
      setErr(authMessage(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-root">
      <TopBar back={next} title="Sign in" />
      <main className="page page--no-nav stack-lg" id="main">
        <div className="stack-sm">
          <h1>{saving ? 'Save your account' : 'Sign in'}</h1>
          <p className="muted">
            {saving
              ? 'Add your email to keep everything you’ve made or joined on this device, and open it on your phone or laptop.'
              : 'Use the same email on every device to see and run your crawls. No password — we email you a code.'}
          </p>
        </div>

        {isAnonymous && !sent && (
          <Segmented
            legend="You’re using a guest login on this device"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErr(undefined);
            }}
            options={[
              { value: 'save', label: 'Save this guest account' },
              { value: 'signin', label: 'Sign in to my account' },
            ]}
          />
        )}
        {isAnonymous && mode === 'signin' && !sent && (
          <Banner tone="warn" title="Guest events stay behind">
            Anything you made or joined as a guest on this device won’t move to that account. To keep it, choose “Save this guest account” instead.
          </Banner>
        )}

        <Card as="section">
          <form className="stack" onSubmit={submit} noValidate>
            <TextInput
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              disabled={sent}
              onChange={(e) => setEmail(e.target.value)}
              hint="Only used to sign you in. Never shown to other players."
            />
            {sent && (
              <>
                <Banner tone="success" title="Check your email">
                  We sent a code to {email.trim()}. Enter it below — or tap the link in the email <strong>on this device</strong>.
                </Banner>
                <TextInput
                  label="Code from the email"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  maxLength={10}
                  autoFocus
                  onChange={(e) => setCode(e.target.value)}
                />
              </>
            )}
            {err && (
              <p className="field__error" role="alert">
                {err}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={sent && code.replace(/\s/g, '').length < 6}>
              {!sent ? 'Email me a code' : saving ? 'Save account' : 'Sign in'}
            </Button>
            {sent && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSent(false);
                  setCode('');
                  setErr(undefined);
                }}
              >
                Use a different email / send again
              </Button>
            )}
          </form>
        </Card>
        <p className="xsmall muted">Emails can take a minute. Check spam if it doesn’t arrive.</p>
      </main>
    </div>
  );
}
