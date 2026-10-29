# Setup & deployment

Roundhouse is a static React app (GitHub Pages) backed by Supabase (Postgres + Auth + Storage + Realtime). There is no other server.

You need: a GitHub repository, the Supabase project `https://ndmahepsqigziirzmabt.supabase.co`, and Node 20+ locally.

## 1. Supabase database

Apply the migrations in `supabase/migrations/` **in filename order**. Either:

- **Supabase CLI** (recommended): `npx supabase login`, `npx supabase link --project-ref ndmahepsqigziirzmabt`, then `npx supabase db push`.
- **Dashboard**: SQL Editor → paste and run each file in order (`…0001_core_schema.sql` → `…0007_pub_golf.sql`).

The migrations create every table, constraint, index, RLS policy, trusted RPC, both Storage buckets with their policies, and add the tables to the `supabase_realtime` publication.

Do **not** run `supabase/seed.sql` against production — it is demo data for local development (`npx supabase start && npx supabase db reset`).

## 2. Authentication (dashboard, manual)

Authentication → Sign In / Providers:

1. **Allow anonymous sign-ins: ON.** Participants join as guests with no form. Without this, joining shows "Guest sign-in is switched off".
2. **Email: ON** (magic link / OTP). Used only when someone chooses to add a recovery email or sign in on another device. Keep "Confirm email" on.
3. Recommended: Authentication → Attack Protection → enable CAPTCHA (hCaptcha/Turnstile free tiers) to rate-limit anonymous sign-ups. If you enable it you must also add the widget token to `signInAnonymously` — not wired up by default.

Authentication → URL Configuration:

- **Site URL**: your Pages URL, e.g. `https://<user>.github.io/<repo>/`
- **Redirect URLs**: add `https://<user>.github.io/<repo>/me` (and `http://localhost:5173/me` for dev).

Email template tip: to get a 6-digit code instead of only a link, include `{{ .Token }}` in the Magic Link template.

## 3. Storage

Created by migration `…0004`:

| Bucket | Public | Limit | Types | Path |
|---|---|---|---|---|
| `proof` | **No** | 50 MB | JPEG, PNG, WebP, HEIC/HEIF, MP4, MOV, WebM | `{event_id}/{user_id}/{submission_id}/{file}` |
| `event-assets` | Yes (intentional) | 5 MB | JPEG, PNG, WebP | `{event_id}/{file}` (cover images) |

Check under Storage that both exist with those settings. The free plan caps uploads at 50 MB per file; if your plan's global limit is lower (Storage → Settings), lower it on the bucket too.

Proof media is only ever served through signed URLs valid for 30 minutes. `event-assets` is public by design — organisers are warned in the UI not to upload photos of people there.

## 4. Realtime

Database → Publications → `supabase_realtime` should list: events, event_members, venues, teams, team_members, challenges, challenge_submissions, venue_participation, score_ledger, event_announcements, member_achievements (the migration adds them). Realtime respects RLS. If Realtime is unavailable the app polls every 20 s.

## 5. API key

Project Settings → API Keys: copy the **anon / publishable** key. This key is designed to be public; all protection is in RLS and the RPCs. **Never** use the `service_role` / secret key anywhere in this project.

## 6. Local development

```bash
cp .env.example .env.local   # fill in VITE_SUPABASE_ANON_KEY
npm ci
npm run dev                  # http://localhost:5173
```

Checks:

```bash
npm run typecheck && npm run lint
npm test            # unit tests + database/RLS tests (embedded Postgres, no Docker needed)
npm run test:e2e    # production build + Playwright (needs Node 20 and Chrome, or PW_CHANNEL=chromium after `npx playwright install chromium`)
```

## 7. GitHub Pages

1. Push the repository to GitHub (default branch `main`).
2. Settings → Pages → **Source: GitHub Actions**.
3. Settings → Secrets and variables → Actions → **Variables** or **Secrets** (either works; they are public values baked into the bundle):
   - `VITE_SUPABASE_URL` = `https://ndmahepsqigziirzmabt.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon/publishable key
   - optional `CUSTOM_DOMAIN` = e.g. `crawl.example.com` (builds for `/` and writes `CNAME`)
   - optional `VITE_BASE_PATH` = force a base path, e.g. `/` (repos named `<user>.github.io` get `/` automatically)
4. Push to `main` (or run the workflow manually). The workflow type-checks, lints, runs unit + DB + E2E tests, builds and deploys.

### Deep links on Pages

Pages has no SPA rewrites, so the build copies `index.html` to `404.html` (`scripts/postbuild.mjs`). Any unknown path such as `/<repo>/j/ABCD2345` returns that file (HTTP 404 status, which browsers ignore for rendering) and the client router takes over — including after refresh. `.nojekyll` is written so Pages doesn't strip files. The E2E suite verifies this against a server that mimics Pages exactly.

The base path comes from `VITE_BASE_PATH` (`/<repo>/` by default in CI, `/` with a custom domain). All asset URLs and router links derive from it, so moving to a custom domain later needs only the `CUSTOM_DOMAIN` variable and a DNS record (then update the Supabase Site/Redirect URLs).

### Verifying the deployment

After deploy: open `https://<user>.github.io/<repo>/`, create an event, publish it, open the invite link in a private window on a phone, join, and refresh on the event page. Unauthorised access check: in another private window open `https://<user>.github.io/<repo>/e/<event-id>` without joining — it must show "You're not in this crawl".
