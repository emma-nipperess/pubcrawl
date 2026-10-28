import { TopBar } from '@/components/Shell';
import { Card } from '@/components/ui';

export default function Privacy() {
  return (
    <div className="app-root">
      <TopBar back="/" title="Privacy & data" />
      <main className="page page--no-nav stack" id="main">
        <h1>Privacy & data</h1>
        <p className="muted small">Plain-English summary of what this site stores. The organiser of each event decides how it is run; contact them about their event.</p>

        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>What we collect</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>A guest login</strong> created on your device when you join (an anonymous Supabase Auth account). We don’t ask for your real name, phone number
              or contacts.
            </li>
            <li>
              <strong>The display name, colour and icon</strong> you choose, visible to everyone in that event.
            </li>
            <li>
              <strong>Your activity in each event</strong>: team, venues attended or skipped, challenge answers, captions, scores and badges.
            </li>
            <li>
              <strong>Photos and videos you upload as proof.</strong> Stored privately. Only the event’s organisers and — if the organiser allows it — other
              members of that event can view them, through links that expire after 30 minutes. Photos are re-encoded on your phone before upload, which removes
              embedded location data where the browser supports it.
            </li>
            <li>
              <strong>An email address</strong> only if you choose to add one for account recovery or to sign in. It is never shown to other players or included
              in exports.
            </li>
          </ul>
        </Card>

        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>What we don’t do</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>No analytics, advertising or tracking scripts. Fonts are served from this site, not a third party.</li>
            <li>
              No location tracking. Directions open your own maps app. “Show me on the map” asks your browser for your position once; it stays on your
              phone and is never sent to us or saved.
            </li>
            <li>
              No selling or sharing of data. Supabase hosts the database, logins and files. When you open a route map, map images load from OpenStreetMap’s
              tile servers (which see your IP address, like any website). When an organiser uses “Find from address”, the venue address is looked up with
              OpenStreetMap Nominatim.
            </li>
          </ul>
        </Card>

        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>On this device</h2>
          <p className="small">
            Your login session and a short list of recently opened events (name and link only) are kept in this browser’s storage. Signing out clears both. The
            app shell may be cached for faster loading; event data and photos are never cached offline. On a shared device, sign out when you’re done.
          </p>
        </Card>

        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Keeping and deleting data</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>Leave an event</strong> from its Card tab. You disappear from the leaderboard; points already earned for your team stay with the team.
            </li>
            <li>
              <strong>Delete your photos</strong>: you can always delete media you uploaded. Organisers can delete any media in their event and are asked to purge
              all media after the retention period they set (7–90 days).
            </li>
            <li>
              <strong>Delete everything</strong>: “My events” → Delete my data removes your uploads, memberships, submissions, scores, templates and login.
            </li>
            <li>
              <strong>Event deletion</strong> by its owner permanently removes the event, its players’ memberships, submissions, scores and media.
            </li>
            <li>Organisers can remove participants. Removed participants can’t rejoin unless the organiser lets them back in.</li>
            <li>Exports for organisers contain names, teams, attendance and scores — no emails, account IDs or media links.</li>
          </ul>
        </Card>

        <Card className="stack-sm">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Play safe</h2>
          <p className="small">
            Every challenge can be completed without alcohol. Look after each other, respect venues and other people, ask before photographing anyone, and never
            drink and drive.
          </p>
        </Card>
      </main>
    </div>
  );
}
