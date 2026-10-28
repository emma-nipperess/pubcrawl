import { Link } from 'react-router-dom';
import { TopBar } from '@/components/Shell';
import { EmptyState, LinkButton } from '@/components/ui';

export function NotFound() {
  return (
    <div className="app-root">
      <TopBar />
      <main className="page page--no-nav" id="main">
        <div className="center-screen">
          <EmptyState icon="map-pin" title="Wrong turn" action={<LinkButton to="/" variant="primary">Back to the start</LinkButton>}>
            We couldn’t find that page. If someone sent you an invite, check the link or ask them for the event code.
          </EmptyState>
        </div>
      </main>
    </div>
  );
}

export function SetupMissing() {
  return (
    <div className="app-root">
      <main className="page page--no-nav">
        <div className="center-screen">
          <div className="card stack" style={{ maxWidth: 520, textAlign: 'left' }}>
            <h1>Almost there</h1>
            <p>
              This build of Roundhouse has no Supabase connection. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (the
              public anon / publishable key — never the service role key) and rebuild.
            </p>
            <p className="muted small">
              For GitHub Pages, add them as repository variables named <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. See{' '}
              <code>docs/SETUP.md</code>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export function FooterLinks() {
  return (
    <footer className="center small muted" style={{ padding: 'var(--s-6) 0' }}>
      <Link to="/privacy">Privacy & data</Link> · <Link to="/me">My events</Link>
      <p className="xsmall" style={{ marginTop: 8 }}>
        Play responsibly. Every challenge works without alcohol. Never drink and drive.
      </p>
    </footer>
  );
}
