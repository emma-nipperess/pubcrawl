# Roundhouse — pub crawls & pub golf

A mobile-first web app for running nights out with friends. Two game types:

- **Pub crawl**: venues with challenges (photos, videos, trivia, riddles, team dares). Points add up and the highest score wins.
- **Pub golf**: each venue is a hole with a drink and a par. Players record strokes (sips), scores show to par (−2, E, +3) and the lowest wins. Any drink counts, including soft drinks or water at the same par.

Organisers build the route, share one link and run the night live: teams, photo/video proof and review, announcements, a route map, live leaderboards, CSV export. Players join from the link in their phone's browser with no app install, as a guest or with an email sign-in.

It's a static site on **GitHub Pages**, with everything else on **Supabase** (database with Row Level Security, Auth, Storage, Realtime). The free tiers of both are enough.

Contents: [What you need](#what-you-need) · [1. Supabase](#1-set-up-supabase) · [2. Run locally](#2-run-it-locally) · [3. Publish on GitHub Pages](#3-publish-on-github-pages) · [Base path](#the-base-path-explained) · [Troubleshooting](#troubleshooting) · [Moving machines](#moving-to-another-machine)

---

## What you need

- **Node.js 20 or newer** (22 recommended): `node -v`.
- A **Supabase project**, e.g. `https://ndmahepsqigziirzmabt.supabase.co`.
- A **GitHub account** (for publishing).

## Which keys go where

| Value | Where to find it | Safe in the browser? | Where it goes |
|---|---|---|---|
| Project URL | Supabase → Project Settings → API | Yes | `.env.local` and GitHub (`VITE_SUPABASE_URL`) |
| **Publishable / anon key** (`sb_publishable_…`) | Supabase → Project Settings → API Keys | **Yes**, it's designed to be public; the database rules protect the data | `.env.local` and GitHub (`VITE_SUPABASE_ANON_KEY`) |
| **Secret / service_role key** (`sb_secret_…`) | Supabase → API Keys | **NO** | **Nowhere in this project.** Never commit it, never add it to GitHub. |

`.env.local` is ignored by git, so it is never committed.

---

## 1. Set up Supabase

1. **Database:** run every file in `supabase/migrations/` **in filename order** (`…0001_core_schema.sql` up to `…0007_pub_golf.sql`). Either:
   - Dashboard → **SQL Editor** → paste a file → **Run**, then repeat for each file; or
   - CLI: `npx supabase login && npx supabase link --project-ref <your-ref> && npx supabase db push`.
2. **Auth** (Authentication → Sign In / Providers): turn on **Allow anonymous sign-ins** (needed for guests) and **Email**.
3. **Email codes** (Authentication → Email Templates): in **Magic Link** and **Change Email Address**, add `{{ .Token }}` so emails include a 6-digit code.
4. **Sending email to other people:** Supabase's built-in sender only sends to members of your Supabase organisation, a few per hour. For friends to sign in with email, add free SMTP under Authentication → Emails → SMTP Settings (e.g. Resend or Brevo). Guests don't need email.
5. **Storage:** check that the buckets `proof` (private) and `event-assets` (public) exist. The migrations create them.

There is more detail in [docs/SETUP.md](docs/SETUP.md).

## 2. Run it locally

```bash
cp .env.example .env.local
# edit .env.local:
#   VITE_SUPABASE_URL=https://<your-project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=sb_publishable_...
#   VITE_BASE_PATH=/
npm ci
npm run dev        # http://127.0.0.1:5173
```

In Supabase → Authentication → **URL Configuration**, add `http://127.0.0.1:5173/me` to **Redirect URLs**.

---

## 3. Publish on GitHub Pages

The repository already contains the deploy workflow (`.github/workflows/deploy.yml`). On every push to `main` it type-checks, lints, runs the tests, builds and publishes.

### Step 1: put the code on GitHub

Create an **empty** repository on github.com (e.g. `pub-crawl`), then:

```bash
cd pub-crawl
git remote add origin https://github.com/<your-username>/pub-crawl.git
git push -u origin main
```

The first run will fail at "Build" until you finish steps 2 and 3. That's expected.

### Step 2: turn on Pages

Repository → **Settings → Pages** → **Build and deployment → Source: GitHub Actions**.

### Step 3: add your Supabase URL and key

Repository → **Settings → Secrets and variables → Actions**.

Add these two. Either the **Variables** tab or the **Secrets** tab works; the workflow checks both. They're public values, so Variables is fine and easier to check later.

| Name (exactly) | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ndmahepsqigziirzmabt.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your `sb_publishable_…` key |

Optional (Variables tab), only if you need them; see [The base path](#the-base-path-explained):

| Name | When to use it | Example |
|---|---|---|
| `CUSTOM_DOMAIN` | You'll serve the site on your own domain | `crawl.example.com` |
| `VITE_BASE_PATH` | Force a specific base path | `/` or `/my-repo/` |

> Do **not** add the secret/service_role key here or anywhere else.

### Step 4: deploy

Repository → **Actions** → **Test & deploy to GitHub Pages** → **Run workflow** (or just push a commit). When it's green, the site is at:

```
https://<your-username>.github.io/<repo-name>/
```

### Step 5: tell Supabase the new address

Supabase → Authentication → **URL Configuration**:

- **Site URL**: `https://<your-username>.github.io/<repo-name>/`
- **Redirect URLs**: add `https://<your-username>.github.io/<repo-name>/me` and `https://<your-username>.github.io/<repo-name>/signin`

Without this, email sign-in links send people to the wrong place.

### Step 6: check it

Open the site, create a crawl, publish it, and open its invite link on your phone. Refresh on the join page and on an event page: both must still load (see deep links below).

---

## The base path, explained

GitHub Pages serves a normal ("project") repository from a **sub-folder** of your domain, e.g. `https://sam.github.io/pub-crawl/`. The app needs to know that folder (`/pub-crawl/`) so its scripts, styles and links resolve. This is the **base path**, set at build time with `VITE_BASE_PATH`.

The workflow picks it for you:

| Your setup | Site address | Base path used |
|---|---|---|
| Normal repo, e.g. `pub-crawl` | `https://sam.github.io/pub-crawl/` | `/pub-crawl/` (automatic, from the repo name) |
| Repo named `<username>.github.io` | `https://sam.github.io/` | `/` (automatic) |
| Custom domain (`CUSTOM_DOMAIN` variable set) | `https://crawl.example.com/` | `/` (automatic; also writes the `CNAME` file) |
| Anything else | | set the `VITE_BASE_PATH` variable, e.g. `/something/` (leading and trailing slash) |

**Renaming the repository** changes the address. The next deploy picks up the new name automatically. Then update the Supabase URLs from step 5.

**Using a custom domain later:**
1. Add the `CUSTOM_DOMAIN` variable (e.g. `crawl.example.com`).
2. At your DNS provider, add a `CNAME` record pointing `crawl` to `<your-username>.github.io`.
3. In Settings → Pages, enter the domain and tick **Enforce HTTPS** once it's available.
4. Re-run the workflow, then update the Supabase Site/Redirect URLs.

Locally you normally use `VITE_BASE_PATH=/`. To test a sub-folder build: `VITE_BASE_PATH=/pub-crawl/ npm run build && npm run preview`.

### Deep links and refresh

GitHub Pages can't route `/pub-crawl/j/ABCD2345` to the app by itself. The build copies `index.html` to `404.html`, so any unknown path loads the app and the app shows the right screen. That's why invite links and refreshes work. A browser dev tool may show a "404" status for these pages; that's normal and harmless.

---

## Troubleshooting

| You see | Fix |
|---|---|
| "Almost there… no Supabase connection" | The URL/key weren't set when the site was built. Add them (step 3) and re-run the workflow. |
| Blank page, or scripts 404 in the browser console | Wrong base path. Check the "Building with base path" line in the Actions log matches your site address; set `VITE_BASE_PATH` if needed. |
| "Anonymous sign-ins are disabled" | Supabase → Authentication → Providers → turn on anonymous sign-ins. |
| Email sign-in link opens the wrong site | Update Site URL / Redirect URLs (step 5). Or type the 6-digit code instead of tapping the link. |
| Friends don't get sign-in emails | Set up custom SMTP (Supabase step 4). |
| "Could not find the function…" errors | A migration hasn't been run. Run the missing files from `supabase/migrations/` in order. |
| Workflow fails at "E2E" | Open the job log; the test report names the failing check. To deploy urgently, re-run after fixing, or temporarily remove that step. |

## Scripts

| Command | |
|---|---|
| `npm run dev` | Local dev server (127.0.0.1 only) |
| `npm run build` | Production build (+ `404.html` fallback) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Unit tests + database tests (migrations applied to embedded Postgres; checks permissions, scoring, golf) |
| `npm run test:e2e` | Builds, then browser tests on iPhone/Pixel/desktop sizes behind a GitHub-Pages-like server. Needs Chrome, or run `npx playwright install chromium` and set `PW_CHANNEL=chromium` |

## Moving to another machine

1. Unzip the project.
2. Install Node 20+ (22 recommended).
3. Run `npm ci`. `node_modules` is not included in the zip.
4. Recreate `.env.local` from `.env.example`. The zip leaves it out, so keys never travel in the archive.
5. Run `npm run dev`.

The zip includes the git history (`.git`), so `git log` and `git push` keep working. Re-add the GitHub remote if needed: `git remote add origin …`.

## More docs

- [docs/SETUP.md](docs/SETUP.md): detailed Supabase and Pages setup.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data model, security model, scoring (crawl and golf), media, realtime.
- In-app **Privacy & data** page: what's stored and how to delete it.
