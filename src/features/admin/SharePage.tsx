import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { rpc, useInvite } from '@/lib/supabase/queries';
import { Banner, Button, Card, LoadingBlock, TextArea } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { formatCode } from '@/lib/validation/forms';
import { formatEventWhen } from '@/lib/format';

/** Absolute invite URL on whatever origin/base path this build is served from. */
export function inviteUrl(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}j/${code}`;
}

export default function SharePage() {
  const { event, theme } = useEventCtx();
  const invite = useInvite(event.id, true);
  const { run, busy, fb } = useAdminAction(event.id);
  const [qr, setQr] = useState<string>();
  const code = invite.data?.code;
  const url = code ? inviteUrl(code) : '';
  const when = formatEventWhen(event);
  const defaultText = `You're invited to ${event.name}${when ? ` (${when})` : ''}!\nJoin on your phone — no app needed: ${url}\nOr enter code ${code ? formatCode(code) : ''} at ${window.location.origin}${import.meta.env.BASE_URL}`;
  const [text, setText] = useState('');
  useEffect(() => setText(defaultText), [defaultText]);

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(undefined));
  }, [url]);

  const copy = async (s: string, what: string) => {
    try {
      await navigator.clipboard.writeText(s);
      fb.toast(`${what} copied`, 'success');
    } catch {
      fb.toast('Copy failed — long-press to copy instead', 'error');
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: event.name, text: `Join ${event.name} on Roundhouse`, url });
      } catch {
        /* cancelled */
      }
    } else copy(url, 'Link');
  };

  return (
    <AdminShell title="Invite">
      <h1 className="deco-title">Invite your crew</h1>
      {event.status === 'draft' && (
        <Banner tone="warn" title="Not published yet">
          The link won’t work until you publish from the Control tab. You can still copy it now.
        </Banner>
      )}
      {!event.join_open && <Banner tone="warn">Joining is closed. Re-open it in Settings.</Banner>}
      {invite.isLoading || !code ? (
        <LoadingBlock rows={2} />
      ) : (
        <>
          <Card className="stack center">
            <span className="eyebrow">Event code</span>
            <span className="code-chip" aria-label={`Event code ${code.split('').join(' ')}`}>
              {formatCode(code)}
            </span>
            {qr && (
              <div className="qr-box" style={{ margin: '0 auto' }}>
                <img src={qr} alt={`QR code that opens ${url}`} width={240} height={240} />
              </div>
            )}
            <p className="xsmall muted" style={{ wordBreak: 'break-all' }}>
              {url}
            </p>
            <div className="grid-2">
              <Button variant="primary" icon="share" onClick={share}>
                Share
              </Button>
              <Button icon="copy" onClick={() => copy(url, 'Link')}>
                Copy link
              </Button>
            </div>
            <Button variant="ghost" icon="copy" onClick={() => copy(formatCode(code), 'Code')}>
              Copy code
            </Button>
            {qr && (
              <a className="btn btn--ghost btn--sm" href={qr} download={`${event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.png`}>
                <Icon name="download" /> Download QR for printing
              </a>
            )}
          </Card>

          <section className="stack-sm">
            <h2 className="section-title">Group chat message</h2>
            <TextArea label="Edit before sending" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
            <Button icon="copy" onClick={() => copy(text, 'Message')}>
              Copy message
            </Button>
          </section>

          <section className="stack-sm">
            <h2 className="section-title">Security</h2>
            <p className="small muted">
              The link only lets people join as players — it never gives organiser access. If it leaks, make a new one: the old link and code stop working
              immediately, and people already in the {theme.vocab.team.toLowerCase()}s are unaffected.
            </p>
            <Button
              icon="refresh"
              loading={busy === 'rotate'}
              onClick={() =>
                run('rotate', () => rpc('rotate_invite_code', { p_event_id: event.id }), {
                  confirm: { title: 'Make a new invite link?', body: 'The current link, code and QR stop working straight away.', danger: true, confirmLabel: 'Make new link' },
                  success: 'New link ready',
                  refresh: ['invite'],
                })
              }
            >
              Make a new link & code
            </Button>
          </section>
        </>
      )}
    </AdminShell>
  );
}
