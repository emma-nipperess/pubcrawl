import { expect, test, type Page } from '@playwright/test';

/**
 * Signed-in participant views with a mocked Supabase backend: Home shows the
 * route map by default, and maps actually render tiles (not blank grey) —
 * including in dev mode, where React StrictMode mounts components twice.
 */
const BASE = process.env.E2E_BASE ?? '/pub-crawl/';
const SUPA = 'https://e2e.supabase.test';
const EVENT = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const now = new Date().toISOString();
const event = {
  id: EVENT, owner_id: 'owner', name: 'Map Night', description: null, event_date: null, start_time: null, end_time: null, timezone: 'Europe/London',
  start_location: null, meeting_instructions: null, theme_key: 'classic', theme_custom: {}, cover_path: null, organiser_name: 'Sam', capacity: null,
  visibility: 'private', require_code: true, allow_late_join: true, join_open: true, play_mode: 'individual', team_selection: 'organiser', allow_self_teams: true,
  team_max_size: null, teams_locked: false, allow_skip: true, skip_policy: 'none', skip_penalty: 0, allow_any_venue: false, challenges_visible_early: false,
  default_requires_approval: false, show_others_submissions: true, leaderboard_visible: true, provisional_scoring: false, allow_partial_points: false,
  tie_break: 'shared', media_retention_days: 30, status: 'in_progress', current_venue_id: 'v2', published_at: now, started_at: now, completed_at: null, created_at: now, updated_at: now,
};
const member = { id: MEMBER, event_id: EVENT, user_id: UID, role: 'participant', display_name: 'Alex', avatar_color: '#2A9D8F', avatar_icon: 'star', status: 'active', is_player: true, joined_late: false, joined_venue_position: null, joined_at: now, left_at: null };
const venue = (id: string, position: number, status: string, lat: string | null, lng: string | null) => ({
  id, event_id: EVENT, position, name: `Pub ${position + 1}`, address: `${position + 1} High St`, maps_url: null, latitude: lat, longitude: lng, description: null,
  meeting_instructions: null, arrive_at: null, depart_at: null, duration_minutes: null, accent_color: null, image_path: null, par: null, bonus_points: 0,
  time_limit_minutes: null, disabled: false, status, activated_at: now, closed_at: null,
});
// Postgres numeric columns arrive as strings — the map must cope.
const venues = [venue('v1', 0, 'completed', '51.5081', '-0.0877'), venue('v2', 1, 'active', '51.5101', '-0.0840'), venue('v3', 2, 'upcoming', '51.5125', '-0.0890')];

function jwt() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })}.sig`;
}

async function setup(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route(`${SUPA}/**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const one = /vnd\.pgrst\.object/.test(req.headers()['accept'] ?? '');
    const send = (rows: unknown[]) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(one ? rows[0] ?? null : rows) });
    const table = url.pathname.replace('/rest/v1/', '');
    if (table === 'rpc/get_leaderboard') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ visible: true, provisional_scoring: false, tie_break: 'shared', individuals: [], teams: [] }) });
    if (table === 'events') return send([event]);
    if (table === 'event_members') return send([member]);
    if (table === 'venues') return send(venues);
    if (url.pathname.startsWith('/auth/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return send([]);
  });
  await page.goto(`${BASE}privacy`);
  await page.evaluate(
    ({ token, uid }) =>
      localStorage.setItem(
        'roundhouse-auth',
        JSON.stringify({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }),
      ),
    { token: jwt(), uid: UID },
  );
}

async function expectTiles(page: Page, region: string) {
  const map = page.getByRole('region', { name: region });
  await expect(map).toBeVisible();
  // a blank grey map has no loaded tiles
  await expect.poll(() => map.locator('img.leaflet-tile-loaded').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(map.locator('.map-stop')).toHaveCount(3);
}

test('players see the route map on Home by default, and it has tiles', async ({ page }) => {
  await setup(page);
  await page.goto(`${BASE}e/${EVENT}`);
  await expect(page.getByRole('heading', { name: 'Map Night' })).toBeVisible();
  await expectTiles(page, 'Map of the crawl route');
  await expect(page.getByText(/Next: Pub 3/)).toBeVisible();
  // Home preview doesn't trap scrolling and opens the full map
  await page.getByRole('link', { name: 'Open the full route map' }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${EVENT}/route$`));
  await expect(page.getByRole('heading', { name: 'The route' })).toBeVisible();
  await expectTiles(page, 'Map of the crawl route');
});

test('the map still renders after a refresh on the route page', async ({ page }) => {
  await setup(page);
  await page.goto(`${BASE}e/${EVENT}/route`);
  await expectTiles(page, 'Map of the crawl route');
  await page.reload();
  await expectTiles(page, 'Map of the crawl route');
});
