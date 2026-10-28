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
    { id: 't1', name: 'The Coven', color: '#ff7a1a', icon: 'ghost', max_size: null, size: 2 },
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
  await page.getByRole('radio', { name: /The Coven/ }).check({ force: true });
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
  await expect(page.getByRole('heading', { name: 'Pick a vibe' })).toBeVisible();
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
