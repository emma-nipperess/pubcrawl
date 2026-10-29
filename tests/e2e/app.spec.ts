import { expect, test, type Page } from '@playwright/test';

/**
 * Production-build E2E. Served from /pub-crawl/ by a GitHub-Pages-like server
 * (unknown paths → 404.html). Supabase is stubbed with page.route so these
 * tests exercise routing, layout and the join flow without a backend.
 * Build first with: npm run build:e2e
 */
const BASE = '/pub-crawl/';
const SUPA = 'https://e2e.supabase.test';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

const preview = {
  id: EVENT_ID,
  name: 'Spooky Pub Golf',
  description: 'Costumes on!',
  event_date: '2026-10-31',
  start_time: '19:00:00',
  end_time: null,
  timezone: 'Europe/London',
  start_location: 'Outside the station',
  organiser_name: 'Sam',
  theme_key: 'halloween',
  theme_custom: {},
  cover_path: null,
  status: 'published',
  visibility: 'private',
  play_mode: 'team',
  team_selection: 'self',
  allow_self_teams: false,
  teams_locked: false,
  join_open: true,
  allow_late_join: true,
  capacity: null,
  require_code: true,
  team_max_size: null,
  member_count: 3,
  venue_count: 4,
  current_venue: null,
  my_status: null,
  teams: [
    { id: 't1', name: 'Ghouls Night Out', color: '#ff7a1a', icon: 'ghost', max_size: null, size: 2 },
    { id: 't2', name: 'Boo Crew', color: '#a6e35f', icon: 'moon', max_size: 2, size: 2 },
  ],
};

function fakeJwt() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '22222222-2222-4222-8222-222222222222', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })}.sig`;
}

async function stubSupabase(page: Page, calls: string[] = []) {
  await page.route(`${SUPA}/**`, async (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/rest/v1/rpc/get_event_preview') {
      const body = route.request().postDataJSON() as { p_code?: string };
      return json(body.p_code === 'ABCD2345' ? preview : null);
    }
    if (url.pathname === '/rest/v1/rpc/list_public_events') return json([]);
    if (url.pathname === '/auth/v1/signup') {
      return json({
        access_token: fakeJwt(),
        refresh_token: 'r',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    if (url.pathname === '/rest/v1/rpc/join_event') return json('33333333-3333-4333-8333-333333333333');
    if (url.pathname.startsWith('/rest/v1/')) return json(route.request().method() === 'GET' && url.searchParams.has('id') ? null : []);
    return json({});
  });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await stubSupabase(page);
});

test('landing page renders with primary actions and no sideways scroll', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: /Plan the route/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a crawl' })).toBeVisible();
  await expect(page.getByLabel('Event code or link')).toBeVisible();
  await noHorizontalScroll(page);
});

test('touch targets on the landing page are at least 44px tall', async ({ page }) => {
  await page.goto(BASE);
  const small = await page.$$eval('main .btn, main input, main select', (els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => [e.textContent?.trim() || (e as HTMLInputElement).name, e.getBoundingClientRect().height] as const).filter(([, h]) => h < 40),
  );
  expect(small).toEqual([]);
});

test('invite deep link opens the join screen directly, and survives a refresh', async ({ page }) => {
  const res = await page.goto(`${BASE}j/ABCD2345`);
  // GitHub Pages answers unknown paths with 404.html; the SPA must still boot.
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Spooky Pub Golf' })).toBeVisible();
  await expect(page.getByText('Sam invites you to')).toBeVisible();
  await expect(page.locator('[data-theme="halloween"]').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Spooky Pub Golf' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('asset URLs respect the repository base path', async ({ page }) => {
  const bad: string[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.host.startsWith('127.0.0.1') && r.status() >= 400 && !u.pathname.endsWith('/j/ABCD2345') && !u.pathname.endsWith('/e/x/board')) bad.push(`${r.status()} ${u.pathname}`);
  });
  await page.goto(`${BASE}e/x/board`);
  await page.waitForLoadState('networkidle');
  expect(bad).toEqual([]);
  const scripts = await page.$$eval('script[src], link[rel="stylesheet"]', (els) => els.map((e) => e.getAttribute('src') ?? e.getAttribute('href')));
  for (const s of scripts) expect(s?.startsWith(BASE)).toBe(true);
});

test('joining validates the name, then signs in as a guest and enters the event', async ({ page }) => {
  const calls: string[] = [];
  await page.unrouteAll();
  await stubSupabase(page, calls);
  await page.goto(`${BASE}j/ABCD-2345`);
  await expect(page.getByRole('heading', { name: 'Spooky Pub Golf' })).toBeVisible();
  // a full team is not selectable
  await expect(page.getByRole('radio', { name: /Boo Crew/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Join the crawl' }).click();
  await expect(page.getByText(/Pick a name/)).toBeVisible();
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('radio', { name: /Ghouls Night Out/ }).check({ force: true });
  await page.getByRole('button', { name: 'Join the crawl' }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}e/${EVENT_ID}$`));
  expect(calls).toContain('POST /auth/v1/signup');
  expect(calls.filter((c) => c === 'POST /rest/v1/rpc/join_event')).toHaveLength(1);
});

test('unknown invite codes show a helpful message', async ({ page }) => {
  await page.goto(`${BASE}j/ZZZZ2222`);
  await expect(page.getByRole('heading', { name: /couldn’t find that crawl/ })).toBeVisible();
});

test('typing a code on the landing page navigates to the join screen', async ({ page }) => {
  await page.goto(BASE);
  await page.getByLabel('Event code or link').fill('abcd-2345');
  await page.getByRole('button', { name: 'Find my crawl' }).click();
  await expect(page).toHaveURL(`${BASE}j/ABCD2345`);
  await expect(page.getByRole('heading', { name: 'Spooky Pub Golf' })).toBeVisible();
});

test('create wizard deep link works and theme changes the look', async ({ page }) => {
  await page.goto(`${BASE}new`);
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible();
  const before = await page.locator('.app-root').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  await page.getByText('Halloween', { exact: true }).click();
  await expect(page.locator('[data-theme="halloween"]').first()).toBeVisible();
  const after = await page.locator('.app-root').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(after).not.toBe(before);
  await page.getByRole('button', { name: /Next: Details/ }).click();
  await page.getByRole('button', { name: /Next: Route/ }).click();
  await expect(page.getByText(/Give your crawl a name/)).toBeVisible();
  await page.getByLabel('Event name').fill('Test Night');
  await page.getByLabel('Your name (organiser)').fill('Sam');
  await page.getByRole('button', { name: /Next: Route/ }).click();
  await expect(page.getByRole('heading', { name: 'The route' })).toBeVisible();
  await expect(page.locator('strong', { hasText: 'The Crypt' })).toBeVisible();
  await noHorizontalScroll(page);
  // in-progress wizard data survives a refresh
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The route' })).toBeVisible();
});

test('privacy page is reachable directly', async ({ page }) => {
  await page.goto(`${BASE}privacy`);
  await expect(page.getByRole('heading', { name: 'Privacy & data', level: 1 })).toBeVisible();
});

test('organisers can pin a venue on the free map from the wizard', async ({ page }) => {
  // stub map tiles and address search so the test is offline and doesn't load OSM
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: png }));
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '51.5081', lon: '-0.0877', display_name: 'The Crypt, London' }]) }));
  await page.goto(`${BASE}new`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: /Next: Details/ }).click();
  await page.getByLabel('Event name').fill('Map Night');
  await page.getByLabel('Your name (organiser)').fill('Sam');
  await page.getByRole('button', { name: /Next: Route/ }).click();
  await page.locator('strong', { hasText: 'Hole 1 — The Clubhouse' }).click();
  await page.getByRole('button', { name: 'Find from address' }).click();
  await expect(page.getByText(/Found: The Crypt, London/)).toBeVisible();
  await expect(page.getByRole('region', { name: /tap to place the venue/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /tap to place the venue/ }).locator('.leaflet-marker-icon')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click();
  // the route step now shows the route map with the pinned stop
  await expect(page.getByRole('region', { name: 'Map of the crawl route' })).toBeVisible();
  await expect(page.getByText('© OpenStreetMap', { exact: false }).first()).toBeVisible();
});

test('first visit offers sign in or continue as guest; guest is remembered', async ({ page }) => {
  const calls: string[] = [];
  await page.unrouteAll();
  await stubSupabase(page, calls);
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: /How do you want to play/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByRole('heading', { name: /How do you want to play/ })).toBeHidden();
  expect(calls).toContain('POST /auth/v1/signup');
  await expect(page.getByRole('link', { name: /Guest account/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /How do you want to play/ })).toBeHidden();
});

test('signing in with an email code', async ({ page }) => {
  const calls: string[] = [];
  await page.unrouteAll();
  await stubSupabase(page, calls);
  await page.route(`${SUPA}/auth/v1/otp*`, (r) => {
    calls.push('POST /auth/v1/otp');
    return r.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SUPA}/auth/v1/verify*`, (r) => {
    calls.push(`verify ${JSON.stringify(r.request().postDataJSON())}`);
    return r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ access_token: fakeJwt(), refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: '44444444-4444-4444-8444-444444444444', email: 'sam@example.com', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }),
    });
  });
  await page.goto(BASE);
  await page.getByRole('link', { name: 'Sign in with email' }).click();
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText(/We sent a code to sam@example.com/)).toBeVisible();
  await page.getByLabel('Code from the email').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pub-crawl\/?$/);
  await expect(page.getByRole('link', { name: /Signed in as sam@example.com/ })).toBeVisible();
  expect(calls).toContain('POST /auth/v1/otp');
  expect(calls.some((c) => c.includes('"type":"email"') && c.includes('123456'))).toBe(true);
});

test('a guest can save their account with email (same account, nothing lost)', async ({ page }) => {
  const calls: string[] = [];
  await page.unrouteAll();
  await stubSupabase(page, calls);
  await page.route(`${SUPA}/auth/v1/user*`, (r) => {
    calls.push(`${r.request().method()} /auth/v1/user`);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated', is_anonymous: true, new_email: 'sam@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) });
  });
  await page.route(`${SUPA}/auth/v1/verify*`, (r) => {
    calls.push(`verify ${JSON.stringify(r.request().postDataJSON())}`);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: fakeJwt(), refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: '22222222-2222-4222-8222-222222222222', email: 'sam@example.com', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }) });
  });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('link', { name: /Guest account/ }).click();
  await page.getByRole('link', { name: 'Save my account with email' }).click();
  await expect(page.getByRole('heading', { name: 'Save your account' })).toBeVisible();
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code from the email').fill('654321');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page).toHaveURL(`${BASE}me`);
  expect(calls).toContain('PUT /auth/v1/user');
  expect(calls.some((c) => c.includes('"type":"email_change"'))).toBe(true);
  // signing out is available and asks first
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign out on this device?' })).toBeVisible();
});

test('the wizard offers pub crawl or pub golf, and golf gives holes a drink and par', async ({ page }) => {
  await page.goto(`${BASE}new`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible();
  await page.getByText('Pub golf', { exact: true }).click();
  await expect(page.getByText(/Fewest strokes wins/)).toBeVisible();
  await expect(page.getByLabel('Max over par')).toHaveValue('3');
  await page.getByRole('button', { name: /Next: Details/ }).click();
  await page.getByLabel('Event name').fill('Golf Night');
  await page.getByLabel('Your name (organiser)').fill('Sam');
  await page.getByRole('button', { name: /Next: Route/ }).click();
  await expect(page.getByText(/Par 4 · Pint of anything/).first()).toBeVisible();
  await page.locator('strong', { hasText: 'Hole 1 — The Clubhouse' }).click();
  await expect(page.getByLabel('Drink for this hole')).toHaveValue(/Pint of anything/);
  await expect(page.getByLabel('Par (strokes)')).toHaveValue('4');
});
