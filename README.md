# Roundhouse — pub crawls & pub golf

A mobile-first web app for running pub crawls and pub golf with friends: build a route of venues, add challenges (photos, videos, trivia, riddles, team dares), share one link, and play live with teams, photo proof, organiser review and real-time leaderboards. No app to install; participants join as guests in the browser.

Static site on **GitHub Pages**, backend entirely on **Supabase** (Postgres + RLS, Auth, Storage, Realtime). Free tiers only.

- **Organisers**: 5-step wizard with 7 themes (Classic Pub Golf, Halloween, Birthday, Hens, Christmas, Retro, Custom) and editable starter content; venue editor with drag-and-drop (plus accessible up/down), duplicate, disable, quick-add; challenge builder with 10 types; teams with random balanced shuffle, manual moves, self-selection; live control room (start/pause/advance/reopen/finish), announcements, proof review, audited score corrections, invite link/code/QR, CSV export, duplicate event, templates, media purge.
- **Participants**: join from an invite link, pick a name/avatar/team, see the current venue with directions, complete challenges with camera/library upload and progress, skip or rejoin venues, join late without penalty, personal + team scorecards (golf card for pub golf), live leaderboards with tie indicators, moments feed, badges, final results.
- **Safety**: no challenge requires alcohol; safety notes per challenge; no location tracking or contacts access.

## Quick start

```bash
cp .env.example .env.local      # add the public anon key
npm ci
npm run dev
```

Full setup (database migrations, Auth settings, Storage, GitHub Pages): **[docs/SETUP.md](docs/SETUP.md)**. Design and security decisions: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (+ `404.html` deep-link fallback) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Unit tests + database tests (all migrations applied to embedded Postgres; RLS, RPCs, storage policies) |
| `npm run test:e2e` | Production build behind a GitHub-Pages-like server, Playwright on iPhone/Pixel/desktop viewports |

Requires Node 20+.

## Security notes

Only the public anon/publishable key is shipped. All authorisation is enforced in Postgres (RLS + `SECURITY DEFINER` RPCs with fixed `search_path`); the client's role checks are cosmetic. Never put a `service_role` key in this repo or in GitHub variables.
