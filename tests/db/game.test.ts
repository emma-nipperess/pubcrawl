// @vitest-environment node
/**
 * Integration tests for the Supabase schema: migrations are applied to an
 * embedded Postgres (PGlite) with a shim for auth/storage, then exercised as
 * real `authenticated` users so RLS, column grants and RPC checks all apply.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, fakeUpload, PgArray, uuid, type Db } from './harness';

let db: Db;

type Board = {
  individuals: { member_id: string; name: string; confirmed: number; pending: number; score: number; rank: number; tied: boolean; completed: number }[];
  teams: { team_id: string; name: string; confirmed: number; score: number; rank: number; tied: boolean }[];
  visible: boolean;
};

async function setupEvent(
  owner: string,
  opts: { event?: Record<string, unknown>; venues?: Record<string, unknown>[] } = {},
) {
  const venues = opts.venues ?? [
    {
      name: 'The Fox',
      challenges: [
        { title: 'Group photo', type: 'checkbox', points: 10 },
        { title: 'Team cheer', type: 'team', points: 20 },
        { title: 'Verified pose', type: 'checkbox', points: 15, requires_approval: true, penalty_points: 0 },
      ],
    },
    { name: 'The Crown', bonus_points: 5, challenges: [{ title: 'Riddle', type: 'multiple_choice', points: 8, choices: ['A', 'B', 'C'], correct_choice: 1, penalty_points: 2, max_attempts: 2 }] },
  ];
  const eventId = await db.rpc<string>(owner, 'create_event', {
    p_event: { name: 'Test Crawl', organiser_name: 'Org', play_mode: 'both', ...opts.event },
    p_venues: venues,
  });
  const [{ code }] = await db.admin<{ code: string }>(`select code from public.event_invites where event_id = $1`, [eventId]);
  const vs = await db.admin<{ id: string; name: string }>(`select id, name from public.venues where event_id = $1 order by position`, [eventId]);
  const cs = await db.admin<{ id: string; title: string }>(`select id, title from public.challenges where event_id = $1`, [eventId]);
  const ch = Object.fromEntries(cs.map((c) => [c.title, c.id]));
  return { eventId, code, venues: vs, ch };
}

async function join(uid: string, code: string, name: string, team?: string) {
  return db.rpc<string>(uid, 'join_event', { p_code: code, p_display_name: name, p_team_id: team ?? null });
}

async function submit(uid: string, challenge: string, extra: Record<string, unknown> = {}, id = uuid()) {
  return db.rpc<{ id: string; status: string; points_awarded: number }>(uid, 'submit_challenge', {
    p_submission_id: id,
    p_challenge_id: challenge,
    ...extra,
  });
}

async function board(uid: string, eventId: string) {
  return db.rpc<Board>(uid, 'get_leaderboard', { p_event_id: eventId });
}

beforeAll(async () => {
  db = await createDb();
}, 60_000);

describe('event creation and invitations', () => {
  it('creates an event with organiser membership and an 8-character invite code', async () => {
    const owner = await db.user('owner');
    const { eventId, code } = await setupEvent(owner);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const me = await db.as(owner, `select role from public.event_members where event_id = $1`, [eventId]);
    expect(me).toEqual([{ role: 'organiser' }]);
    const inv = await db.as(owner, `select code from public.event_invites where event_id = $1`, [eventId]);
    expect(inv).toHaveLength(1);
  });

  it('keeps draft and private events out of reach of strangers', async () => {
    const owner = await db.user('owner');
    const stranger = await db.user('stranger');
    const { eventId, code } = await setupEvent(owner);
    expect(await db.as(stranger, `select id from public.events where id = $1`, [eventId])).toHaveLength(0);
    expect(await db.rpc(stranger, 'get_event_preview', { p_code: code })).toBeNull();
    await expect(join(stranger, code, 'Sneaky')).rejects.toThrow(/not opened yet/);

    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    const preview = await db.rpc<{ name: string }>(stranger, 'get_event_preview', { p_code: code.toLowerCase().replace(/(....)/, '$1-') });
    expect(preview.name).toBe('Test Crawl');
    // private: knowing the event id is not enough
    expect(await db.rpc(stranger, 'get_event_preview', { p_event_id: eventId })).toBeNull();
    const list = await db.as<{ id: string }>(stranger, `select id from public.list_public_events()`);
    expect(list.map((r) => r.id)).not.toContain(eventId);
  });

  it('rotating the invite code invalidates the old link', async () => {
    const owner = await db.user('owner');
    const p = await db.user('p');
    const { eventId, code } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    const fresh = await db.rpc<string>(owner, 'rotate_invite_code', { p_event_id: eventId });
    expect(fresh).not.toBe(code);
    await expect(join(p, code, 'Late')).rejects.toThrow(/not valid/);
    expect(await join(p, fresh, 'Late')).toBeTruthy();
  });

  it('participants cannot read invite codes or answer keys', async () => {
    const owner = await db.user('owner');
    const p = await db.user('p');
    const { eventId, code } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await join(p, code, 'Pat');
    expect(await db.as(p, `select * from public.event_invites where event_id = $1`, [eventId])).toHaveLength(0);
    expect(await db.as(p, `select * from public.challenge_answers where event_id = $1`, [eventId])).toHaveLength(0);
    expect(await db.as(owner, `select * from public.challenge_answers where event_id = $1`, [eventId])).toHaveLength(1);
  });
});

describe('joining', () => {
  it('is idempotent across repeated taps and refreshes', async () => {
    const owner = await db.user('owner');
    const p = await db.user('p');
    const { eventId, code } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    const a = await join(p, code, 'Pat');
    const b = await join(p, code, 'Pat again');
    expect(a).toBe(b);
    const rows = await db.admin(`select * from public.event_members where event_id = $1 and user_id = $2`, [eventId, p]);
    expect(rows).toHaveLength(1);
  });

  it('enforces capacity, closed joining and removal', async () => {
    const owner = await db.user('owner');
    const [p1, p2, p3] = [await db.user('1'), await db.user('2'), await db.user('3')];
    const { eventId, code } = await setupEvent(owner, { event: { capacity: 2 } });
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await join(p1, code, 'One');
    const m2 = await join(p2, code, 'Two');
    await expect(join(p3, code, 'Three')).rejects.toThrow(/full/);
    await db.call(owner, 'remove_member', { p_member_id: m2, p_reason: 'test' });
    await expect(join(p2, code, 'Two')).rejects.toThrow(/removed/);
    await db.admin(`update public.events set join_open = false where id = $1`, [eventId]);
    await expect(join(p3, code, 'Three')).rejects.toThrow(/closed joining/);
  });

  it('records late joiners without touching existing scores', async () => {
    const owner = await db.user('owner');
    const [early, late] = [await db.user('e'), await db.user('l')];
    const { eventId, code, ch } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await join(early, code, 'Early');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await submit(early, ch['Group photo']);
    const before = await board(owner, eventId);
    const lateId = await join(late, code, 'Late');
    const [m] = await db.admin<{ joined_late: boolean; joined_venue_position: number }>(
      `select joined_late, joined_venue_position from public.event_members where id = $1`, [lateId]);
    expect(m).toEqual({ joined_late: true, joined_venue_position: 0 });
    const after = await board(owner, eventId);
    expect(after.individuals.find((r) => r.name === 'Early')!.confirmed).toBe(before.individuals.find((r) => r.name === 'Early')!.confirmed);
    expect(after.individuals.find((r) => r.name === 'Late')!.confirmed).toBe(0);
  });

  it('blocks late joining when switched off', async () => {
    const owner = await db.user('owner');
    const p = await db.user('p');
    const { eventId, code } = await setupEvent(owner, { event: { allow_late_join: false } });
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await expect(join(p, code, 'Late')).rejects.toThrow(/late arrivals/);
  });
});

describe('privilege escalation', () => {
  it('participants cannot make themselves organisers or edit other people', async () => {
    const owner = await db.user('owner');
    const [p, q] = [await db.user('p'), await db.user('q')];
    const { eventId, code } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await join(p, code, 'Pat');
    const qId = await join(q, code, 'Quinn');
    await expect(db.as(p, `update public.event_members set role = 'organiser' where user_id = auth.uid()`)).rejects.toThrow(/permission denied/);
    await expect(db.as(p, `update public.event_members set status = 'active' where user_id = auth.uid()`)).rejects.toThrow(/permission denied/);
    // RLS filters other people's rows out of an UPDATE
    await db.as(p, `update public.event_members set display_name = 'Hacked' where id = $1`, [qId]);
    const [row] = await db.admin<{ display_name: string }>(`select display_name from public.event_members where id = $1`, [qId]);
    expect(row.display_name).toBe('Quinn');
    // can rename yourself
    await db.as(p, `update public.event_members set display_name = 'Patricia' where user_id = auth.uid() and event_id = $1`, [eventId]);
    await expect(db.call(p, 'set_member_role', { p_member_id: qId, p_role: 'co_organiser' })).rejects.toThrow(/owner/);
  });

  it('participants cannot edit events, write scores, or change event status', async () => {
    const owner = await db.user('owner');
    const p = await db.user('p');
    const { eventId, code } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    const pid = await join(p, code, 'Pat');
    await db.as(p, `update public.events set name = 'Mine now' where id = $1`, [eventId]);
    const [e] = await db.admin<{ name: string }>(`select name from public.events where id = $1`, [eventId]);
    expect(e.name).toBe('Test Crawl');
    await expect(db.as(p, `update public.events set status = 'completed' where id = $1`, [eventId])).rejects.toThrow(/permission denied/);
    await expect(db.as(p, `update public.events set owner_id = auth.uid() where id = $1`, [eventId])).rejects.toThrow(/permission denied/);
    await expect(
      db.as(p, `insert into public.score_ledger (event_id, ledger_key, source, source_id, kind, member_id, points) values ($1, 'x', 'adjustment', $2, 'adjustment', $2, 999)`, [eventId, pid]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.call(p, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' })).rejects.toThrow(/Only organisers/);
    await expect(db.rpc(p, 'adjust_score', { p_event_id: eventId, p_member_id: pid, p_team_id: null, p_reason: 'because', p_delta: 100 })).rejects.toThrow(/Only organisers/);
    await expect(db.as(p, `insert into public.challenge_submissions (id, event_id, challenge_id, member_id, scope, attempt_no, status) select gen_random_uuid(), $1, id, $2, 'individual', 1, 'approved' from public.challenges limit 1`, [eventId, pid])).rejects.toThrow(/permission denied/);
  });

  it('cross-event data does not leak', async () => {
    const o1 = await db.user('o1');
    const o2 = await db.user('o2');
    const { eventId: e1 } = await setupEvent(o1);
    await setupEvent(o2);
    expect(await db.as(o2, `select * from public.venues where event_id = $1`, [e1])).toHaveLength(0);
    expect(await db.as(o2, `select * from public.challenges where event_id = $1`, [e1])).toHaveLength(0);
    expect(await db.as(o2, `select * from public.event_members where event_id = $1`, [e1])).toHaveLength(0);
    await expect(db.rpc(o2, 'get_leaderboard', { p_event_id: e1 })).rejects.toThrow(/Join the event/);
    await expect(db.rpc(o2, 'add_venues', { p_event_id: e1, p_venues: [{ name: 'x' }] })).rejects.toThrow(/Only organisers/);
  });
});

describe('event state transitions', () => {
  it('follows the allowed lifecycle', async () => {
    const owner = await db.user('owner');
    const { eventId, venues } = await setupEvent(owner);
    const status = (s: string) => db.rpc<{ status: string }>(owner, 'set_event_status', { p_event_id: eventId, p_status: s });
    await expect(status('in_progress')).rejects.toThrow(/cannot be changed/);
    await expect(status('completed')).rejects.toThrow(/cannot be changed/);
    expect((await status('published')).status).toBe('published');
    expect((await status('draft')).status).toBe('draft');
    await status('published');
    const started = await status('in_progress');
    expect(started.status).toBe('in_progress');
    const [v] = await db.admin<{ status: string }>(`select status from public.venues where id = $1`, [venues[0].id]);
    expect(v.status).toBe('active');
    expect((await status('paused')).status).toBe('paused');
    await expect(status('published')).rejects.toThrow(/cannot be changed/);
    await status('in_progress');
    await status('completed');
    await expect(status('in_progress')).rejects.toThrow(/cannot be changed/);
    expect((await status('archived')).status).toBe('archived');
  });

  it('requires a venue before publishing', async () => {
    const owner = await db.user('owner');
    const { eventId } = await setupEvent(owner, { venues: [] });
    await expect(db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' })).rejects.toThrow(/at least one venue/);
  });

  it('advances venues in order and refuses to go past the end', async () => {
    const owner = await db.user('owner');
    const { eventId, venues } = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'published' });
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const next = await db.rpc<{ id: string }>(owner, 'advance_venue', { p_event_id: eventId });
    expect(next.id).toBe(venues[1].id);
    const statuses = await db.admin<{ status: string }>(`select status from public.venues where event_id = $1 order by position`, [eventId]);
    expect(statuses.map((s) => s.status)).toEqual(['completed', 'active']);
    await expect(db.rpc(owner, 'advance_venue', { p_event_id: eventId })).rejects.toThrow(/last venue/);
    // reopen the previous venue
    await db.rpc(owner, 'activate_venue', { p_venue_id: venues[0].id });
    const again = await db.admin<{ status: string }>(`select status from public.venues where event_id = $1 order by position`, [eventId]);
    expect(again.map((s) => s.status)).toEqual(['active', 'completed']);
  });
});

describe('challenges and submissions', () => {
  async function running(opts: Parameters<typeof setupEvent>[1] = {}) {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, opts);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    return { owner, ...ev };
  }

  it('hides challenges until their venue opens', async () => {
    const { owner, eventId, code } = await running();
    const p = await db.user('p');
    await join(p, code, 'Pat');
    expect(await db.as(p, `select * from public.challenges where event_id = $1`, [eventId])).toHaveLength(0);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const visible = await db.as<{ title: string }>(p, `select title from public.challenges where event_id = $1`, [eventId]);
    expect(visible.map((c) => c.title).sort()).toEqual(['Group photo', 'Team cheer', 'Verified pose']);
  });

  it('auto-approves simple challenges and prevents duplicate awards', async () => {
    const { owner, eventId, code, ch } = await running();
    const p = await db.user('p');
    const pid = await join(p, code, 'Pat');
    await expect(submit(p, ch['Group photo'])).rejects.toThrow(/when the crawl starts/);
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const id = uuid();
    const first = await submit(p, ch['Group photo'], {}, id);
    expect(first.status).toBe('approved');
    // same request replayed (double tap / retry) returns the original
    const replay = await submit(p, ch['Group photo'], {}, id);
    expect(replay.id).toBe(first.id);
    // a new request for the same challenge is refused
    await expect(submit(p, ch['Group photo'])).rejects.toThrow(/already completed/);
    const rows = await db.admin(`select * from public.score_ledger where member_id = $1`, [pid]);
    expect(rows).toHaveLength(1);
    const b = await board(p, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(10);
  });

  it('approval flow: pending earns nothing, approval scores, rejection does not', async () => {
    const { owner, eventId, code, ch } = await running();
    const [p, q] = [await db.user('p'), await db.user('q')];
    const pid = await join(p, code, 'Pat');
    await join(q, code, 'Quinn');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const s = await submit(p, ch['Verified pose']);
    expect(s.status).toBe('pending');
    let b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)).toMatchObject({ confirmed: 0, pending: 0 });
    // participants cannot approve, not even someone else's
    await expect(db.rpc(q, 'review_submission', { p_submission_id: s.id, p_decision: 'approved' })).rejects.toThrow(/Only organisers/);
    await expect(db.rpc(p, 'review_submission', { p_submission_id: s.id, p_decision: 'approved' })).rejects.toThrow(/Only organisers/);
    const approved = await db.rpc<{ status: string; reviewed_by: string; reviewed_at: string }>(owner, 'review_submission', { p_submission_id: s.id, p_decision: 'approved' });
    expect(approved.status).toBe('approved');
    expect(approved.reviewed_by).toBe(owner);
    expect(approved.reviewed_at).toBeTruthy();
    b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(15);
    // overturn: reject removes the points again
    await db.rpc(owner, 'review_submission', { p_submission_id: s.id, p_decision: 'rejected', p_note: 'blurry' });
    b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(0);
  });

  it('resubmission requests free up an attempt', async () => {
    const { owner, eventId, code, ch } = await running();
    const p = await db.user('p');
    await join(p, code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const s = await submit(p, ch['Verified pose']);
    await db.rpc(owner, 'review_submission', { p_submission_id: s.id, p_decision: 'resubmit', p_note: 'try again' });
    const s2 = await submit(p, ch['Verified pose']);
    expect(s2.status).toBe('pending');
  });

  it('counts pending points provisionally only when the event allows it', async () => {
    const { owner, eventId, code, ch } = await running({ event: { provisional_scoring: true } });
    const p = await db.user('p');
    const pid = await join(p, code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await submit(p, ch['Verified pose']);
    const b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)).toMatchObject({ confirmed: 0, pending: 15, score: 15 });
  });

  it('co-organisers cannot review their own submissions', async () => {
    const { owner, eventId, code, ch } = await running();
    const co = await db.user('co');
    const coId = await join(co, code, 'Co');
    await db.call(owner, 'set_member_role', { p_member_id: coId, p_role: 'co_organiser' });
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    const s = await submit(co, ch['Verified pose']);
    await expect(db.rpc(co, 'review_submission', { p_submission_id: s.id, p_decision: 'approved' })).rejects.toThrow(/another organiser/);
  });

  it('auto-marks multiple choice, applies penalties and keeps answers secret', async () => {
    const { owner, eventId, code, ch, venues } = await running();
    const p = await db.user('p');
    const pid = await join(p, code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await db.rpc(owner, 'activate_venue', { p_venue_id: venues[1].id });
    const wrong = await submit(p, ch['Riddle'], { p_choice: 0 });
    expect(wrong.status).toBe('rejected');
    let b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(-2);
    const right = await submit(p, ch['Riddle'], { p_choice: 1 });
    expect(right.status).toBe('approved');
    await expect(submit(p, ch['Riddle'], { p_choice: 1 })).rejects.toThrow(/already completed/);
    b = await board(owner, eventId);
    // 8 points, -2 penalty, +5 venue bonus for completing every required challenge at The Crown
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(11);
  });

  it('caps attempts', async () => {
    const { owner, eventId, code, ch, venues } = await running();
    const p = await db.user('p');
    await join(p, code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await db.rpc(owner, 'activate_venue', { p_venue_id: venues[1].id });
    await submit(p, ch['Riddle'], { p_choice: 0 });
    await submit(p, ch['Riddle'], { p_choice: 2 });
    await expect(submit(p, ch['Riddle'], { p_choice: 1 })).rejects.toThrow(/No attempts left/);
  });

  it('locks challenge type once submissions exist but keeps earned points when points change', async () => {
    const { owner, eventId, code, ch, venues } = await running();
    const p = await db.user('p');
    const pid = await join(p, code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: eventId, p_status: 'in_progress' });
    await submit(p, ch['Group photo']);
    await expect(
      db.rpc(owner, 'save_challenge', { p_event_id: eventId, p_venue_id: venues[0].id, p_challenge: { id: ch['Group photo'], title: 'Group photo', type: 'team', points: 10 } }),
    ).rejects.toThrow(/locked/);
    await db.rpc(owner, 'save_challenge', { p_event_id: eventId, p_venue_id: venues[0].id, p_challenge: { id: ch['Group photo'], title: 'Group photo', type: 'checkbox', points: 50 } });
    const b = await board(owner, eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(10);
  });
});

describe('team scoring', () => {
  async function teamEvent(award: 'team_only' | 'team_and_members') {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, {
      event: { team_selection: 'self', team_names: [{ name: 'Red' }, { name: 'Blue' }] },
      venues: [{ name: 'Hole 1', challenges: [{ title: 'Cheer', type: 'team', points: 20, team_award_mode: award }, { title: 'Solo', type: 'checkbox', points: 5 }] }],
    });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const teams = await db.admin<{ id: string; name: string }>(`select id, name from public.teams where event_id = $1 order by name`, [ev.eventId]);
    const blue = teams.find((t) => t.name === 'Blue')!.id;
    const red = teams.find((t) => t.name === 'Red')!.id;
    const [a, b, c] = [await db.user('a'), await db.user('b'), await db.user('c')];
    const ids = { a: await join(a, ev.code, 'Ann', red), b: await join(b, ev.code, 'Bob', red), c: await join(c, ev.code, 'Cat', blue) };
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    return { owner, ...ev, red, blue, users: { a, b, c }, ids };
  }

  it('team_only: team credited once, members not individually', async () => {
    const t = await teamEvent('team_only');
    await submit(t.users.a, t.ch['Cheer']);
    await expect(submit(t.users.b, t.ch['Cheer'])).rejects.toThrow(/team has already completed/);
    const b = await board(t.owner, t.eventId);
    expect(b.teams.find((x) => x.team_id === t.red)!.confirmed).toBe(20);
    expect(b.individuals.find((x) => x.member_id === t.ids.a)!.confirmed).toBe(0);
    expect(b.individuals.find((x) => x.member_id === t.ids.b)!.confirmed).toBe(0);
  });

  it('team_and_members: every member credited, team total not multiplied', async () => {
    const t = await teamEvent('team_and_members');
    await submit(t.users.a, t.ch['Cheer']);
    const b = await board(t.owner, t.eventId);
    expect(b.teams.find((x) => x.team_id === t.red)!.confirmed).toBe(20);
    expect(b.individuals.find((x) => x.member_id === t.ids.a)!.confirmed).toBe(20);
    expect(b.individuals.find((x) => x.member_id === t.ids.b)!.confirmed).toBe(20);
    expect(b.individuals.find((x) => x.member_id === t.ids.c)!.confirmed).toBe(0);
  });

  it('points earned before a team change stay with the original team', async () => {
    const t = await teamEvent('team_only');
    await submit(t.users.a, t.ch['Solo']);
    await db.call(t.owner, 'assign_member_team', { p_member_id: t.ids.a, p_team_id: t.blue });
    const b = await board(t.owner, t.eventId);
    expect(b.teams.find((x) => x.team_id === t.red)!.confirmed).toBe(5);
    expect(b.teams.find((x) => x.team_id === t.blue)!.confirmed).toBe(0);
    expect(b.individuals.find((x) => x.member_id === t.ids.a)!.confirmed).toBe(5);
    // the solo challenge cannot be re-earned for the new team
    await expect(submit(t.users.a, t.ch['Solo'])).rejects.toThrow(/already completed/);
    const history = await db.admin(`select * from public.team_members where member_id = $1 order by joined_at`, [t.ids.a]);
    expect(history).toHaveLength(2);
  });

  it('enforces team size limits for self-selection', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { team_selection: 'self', team_max_size: 1, team_names: [{ name: 'Solo' }] } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [{ id }] = await db.admin<{ id: string }>(`select id from public.teams where event_id = $1`, [ev.eventId]);
    const [a, b] = [await db.user('a'), await db.user('b')];
    await join(a, ev.code, 'A', id);
    await expect(join(b, ev.code, 'B', id)).rejects.toThrow(/full/);
  });

  it('applies a shuffle plan atomically', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await join(await db.user(`u${i}`), ev.code, `P${i}`));
    await db.call(owner, 'apply_team_plan', {
      p_event_id: ev.eventId,
      p_plan: { teams: [{ name: 'Alpha', member_ids: ids.slice(0, 3) }, { name: 'Beta', member_ids: ids.slice(3) }], unassign_others: true },
    });
    const sizes = await db.admin<{ name: string; n: number }>(
      `select t.name, count(tm.*)::int as n from public.teams t left join public.team_members tm on tm.team_id = t.id and tm.left_at is null where t.event_id = $1 group by t.name order by t.name`,
      [ev.eventId],
    );
    expect(sizes).toEqual([{ name: 'Alpha', n: 3 }, { name: 'Beta', n: 2 }]);
    await expect(
      db.call(owner, 'apply_team_plan', { p_event_id: ev.eventId, p_plan: { teams: [{ name: 'Gamma', member_ids: [ids[0]] }, { name: 'Delta', member_ids: [ids[0]] }] } }),
    ).rejects.toThrow(/two teams/);
    // failed plan rolled back entirely
    expect(await db.admin(`select * from public.teams where event_id = $1 and name in ('Gamma', 'Delta')`, [ev.eventId])).toHaveLength(0);
  });
});

describe('ties', () => {
  it('shares ranks for equal scores and breaks ties when configured', async () => {
    for (const tie of ['shared', 'most_completed'] as const) {
      const owner = await db.user('owner');
      const ev = await setupEvent(owner, {
        event: { tie_break: tie, play_mode: 'individual' },
        venues: [{ name: 'V', challenges: [{ title: 'Ten', type: 'checkbox', points: 10 }, { title: 'Five A', type: 'checkbox', points: 5 }, { title: 'Five B', type: 'checkbox', points: 5 }, { title: 'One', type: 'checkbox', points: 1 }] }],
      });
      await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
      const [a, b, c] = [await db.user('a'), await db.user('b'), await db.user('c')];
      await join(a, ev.code, 'A');
      await join(b, ev.code, 'B');
      await join(c, ev.code, 'C');
      await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
      await submit(a, ev.ch['Ten']);
      await submit(b, ev.ch['Five A']);
      await submit(b, ev.ch['Five B']);
      await submit(c, ev.ch['One']);
      const brd = await board(owner, ev.eventId);
      const r = Object.fromEntries(brd.individuals.map((x) => [x.name, x]));
      if (tie === 'shared') {
        expect([r.A.rank, r.B.rank, r.C.rank]).toEqual([1, 1, 3]);
        expect(r.A.tied && r.B.tied).toBe(true);
        expect(r.C.tied).toBe(false);
      } else {
        expect([r.B.rank, r.A.rank, r.C.rank]).toEqual([1, 2, 3]);
        expect(r.A.tied).toBe(false);
      }
    }
  });
});

describe('venue skipping', () => {
  it('skipping awards nothing, blocks submissions, can be resumed and can carry a penalty', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { skip_policy: 'penalty', skip_penalty: 3, play_mode: 'individual' } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    const pid = await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await db.call(p, 'skip_venue', { p_venue_id: ev.venues[0].id, p_reason: 'Running late' });
    await expect(submit(p, ev.ch['Group photo'])).rejects.toThrow(/skipped this venue/);
    let b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(-3);
    const subs = await db.admin(`select * from public.challenge_submissions where member_id = $1`, [pid]);
    expect(subs).toHaveLength(0);
    await db.call(p, 'resume_venue', { p_venue_id: ev.venues[0].id });
    b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(0);
    expect((await submit(p, ev.ch['Group photo'])).status).toBe('approved');
  });

  it('organiser override waives the penalty; skipping can be disabled', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { skip_policy: 'penalty', skip_penalty: 3, allow_skip: false } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    const pid = await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await expect(db.call(p, 'skip_venue', { p_venue_id: ev.venues[0].id })).rejects.toThrow(/switched off/);
    await db.call(owner, 'override_participation', { p_member_id: pid, p_venue_id: ev.venues[0].id, p_status: 'skipped', p_waive_penalty: true });
    const b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(0);
  });
});

describe('score corrections', () => {
  it('records original value, new value, reason, actor and time', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    const pid = await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    const adj = await db.rpc<{ original_value: number; new_value: number; delta: number; actor_id: string; created_at: string }>(owner, 'adjust_score', {
      p_event_id: ev.eventId, p_member_id: pid, p_team_id: null, p_reason: 'Brilliant costume', p_new_total: 25,
    });
    expect(adj).toMatchObject({ original_value: 10, new_value: 25, delta: 15, actor_id: owner });
    expect(adj.created_at).toBeTruthy();
    const b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.member_id === pid)!.confirmed).toBe(25);
    await expect(db.rpc(owner, 'adjust_score', { p_event_id: ev.eventId, p_member_id: pid, p_team_id: null, p_reason: 'x', p_delta: 1 })).rejects.toThrow(/reason/);
    // participant sees their own adjustment but cannot see others' audit log
    expect(await db.as(p, `select * from public.score_adjustments where event_id = $1`, [ev.eventId])).toHaveLength(1);
    expect(await db.as(p, `select * from public.event_audit_log where event_id = $1`, [ev.eventId])).toHaveLength(0);
  });
});

describe('storage permissions', () => {
  async function storageEvent(showOthers: boolean) {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, {
      event: { show_others_submissions: showOthers, play_mode: 'individual' },
      venues: [{ name: 'V', challenges: [{ title: 'Snap', type: 'photo', points: 10 }, { title: 'Clip', type: 'video', points: 10, requires_approval: true }] }],
    });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [p, q, outsider] = [await db.user('p'), await db.user('q'), await db.user('o')];
    await join(p, ev.code, 'Pat');
    await join(q, ev.code, 'Quinn');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    return { owner, ...ev, p, q, outsider };
  }

  it('only lets members upload into their own folder', async () => {
    const t = await storageEvent(true);
    const sid = uuid();
    await expect(fakeUpload(db, t.q, `${t.eventId}/${t.p}/${sid}/a.jpg`)).rejects.toThrow(/row-level security/);
    await expect(fakeUpload(db, t.outsider, `${t.eventId}/${t.outsider}/${sid}/a.jpg`)).rejects.toThrow(/row-level security/);
    await expect(fakeUpload(db, t.p, `${t.eventId}/${t.p}/not-a-uuid/a.jpg`)).rejects.toThrow(/row-level security/);
    expect(await fakeUpload(db, t.p, `${t.eventId}/${t.p}/${sid}/a.jpg`)).toHaveLength(1);
  });

  it('requires real uploaded media and checks the stored MIME type', async () => {
    const t = await storageEvent(true);
    const sid = uuid();
    const path = `${t.eventId}/${t.p}/${sid}/a.jpg`;
    await expect(submit(t.p, t.ch['Snap'], {}, sid)).rejects.toThrow(/needs a photo/);
    await expect(submit(t.p, t.ch['Snap'], { p_media: [{ path, kind: 'image' }] }, sid)).rejects.toThrow(/Upload not found/);
    // a file the client called .jpg but Storage recorded as video
    await fakeUpload(db, t.p, path, 'video/mp4');
    await expect(submit(t.p, t.ch['Snap'], { p_media: [{ path, kind: 'image' }] }, sid)).rejects.toThrow(/needs a photo/);
    const sid2 = uuid();
    const path2 = `${t.eventId}/${t.p}/${sid2}/b.jpg`;
    await fakeUpload(db, t.p, path2, 'image/jpeg');
    const s = await submit(t.p, t.ch['Snap'], { p_media: [{ path: path2, kind: 'image' }] }, sid2);
    expect(s.status).toBe('approved');
    // the folder is sealed once the submission exists
    await expect(fakeUpload(db, t.p, `${t.eventId}/${t.p}/${sid2}/extra.jpg`)).rejects.toThrow(/row-level security/);
    // and someone else's object cannot be attached
    const sid3 = uuid();
    await expect(submit(t.q, t.ch['Snap'], { p_media: [{ path: path2, kind: 'image' }] }, sid3)).rejects.toThrow(/does not belong/);
  });

  it('proof is shared with the crawl when sharing is on (pending too), private when off', async () => {
    for (const showOthers of [true, false]) {
      const t = await storageEvent(showOthers);
      const sid = uuid();
      const path = `${t.eventId}/${t.p}/${sid}/clip.mp4`;
      await fakeUpload(db, t.p, path, 'video/mp4', 5_000_000);
      const s = await submit(t.p, t.ch['Clip'], { p_media: [{ path, kind: 'video' }] }, sid);
      expect(s.status).toBe('pending');
      const read = (uid: string) => db.as(uid, `select name from storage.objects where name = $1`, [path]);
      expect(await read(t.p)).toHaveLength(1);
      expect(await read(t.owner)).toHaveLength(1);
      expect(await read(t.q)).toHaveLength(showOthers ? 1 : 0);
      expect(await read(t.outsider)).toHaveLength(0);
      expect(await db.as(t.q, `select * from public.submission_media where submission_id = $1`, [sid])).toHaveLength(showOthers ? 1 : 0);
      expect(await db.as(t.q, `select * from public.list_event_media($1)`, [t.eventId])).toHaveLength(showOthers ? 1 : 0);
      await expect(db.as(t.outsider, `select * from public.list_event_media($1)`, [t.eventId])).rejects.toThrow(/Join the event/);
      await db.rpc(t.owner, 'review_submission', { p_submission_id: sid, p_decision: 'approved' });
      expect(await read(t.q)).toHaveLength(showOthers ? 1 : 0);
      expect(await read(t.outsider)).toHaveLength(0);
      // other participants can never delete someone else's media
      await db.as(t.q, `delete from storage.objects where name = $1`, [path]);
      expect(await db.admin(`select 1 from storage.objects where name = $1`, [path])).toHaveLength(1);
      // hidden by moderation → disappears for other participants
      await db.call(t.owner, 'moderate_submission', { p_submission_id: sid, p_hidden: true });
      expect(await read(t.q)).toHaveLength(0);
      // organisers can remove it
      await db.as(t.owner, `delete from storage.objects where name = $1`, [path]);
      expect(await db.admin(`select 1 from storage.objects where name = $1`, [path])).toHaveLength(0);
    }
  });
});

describe('event deletion and duplication', () => {
  it('owner can delete an event with submissions; others cannot', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    await db.as(p, `delete from public.events where id = $1`, [ev.eventId]);
    expect(await db.admin(`select 1 from public.events where id = $1`, [ev.eventId])).toHaveLength(1);
    // venue with submissions cannot be deleted directly (archive/disable instead)
    await db.rpc(owner, 'advance_venue', { p_event_id: ev.eventId });
    await expect(db.as(owner, `delete from public.venues where id = $1`, [ev.venues[0].id])).rejects.toThrow(/foreign key/);
    await db.as(owner, `delete from public.events where id = $1`, [ev.eventId]);
    expect(await db.admin(`select 1 from public.events where id = $1`, [ev.eventId])).toHaveLength(0);
    expect(await db.admin(`select 1 from public.challenge_submissions where event_id = $1`, [ev.eventId])).toHaveLength(0);
  });

  it('duplicates configuration but not people, submissions or scores', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    const copy = await db.rpc<string>(owner, 'duplicate_event', { p_event_id: ev.eventId, p_name: 'Round two' });
    const [e] = await db.admin<{ status: string; name: string }>(`select status, name from public.events where id = $1`, [copy]);
    expect(e).toEqual({ status: 'draft', name: 'Round two' });
    expect(await db.admin(`select 1 from public.venues where event_id = $1`, [copy])).toHaveLength(2);
    expect(await db.admin(`select 1 from public.challenges where event_id = $1`, [copy])).toHaveLength(4);
    expect(await db.admin(`select 1 from public.challenge_answers where event_id = $1`, [copy])).toHaveLength(1);
    expect(await db.admin(`select 1 from public.event_members where event_id = $1`, [copy])).toHaveLength(1);
    expect(await db.admin(`select 1 from public.challenge_submissions where event_id = $1`, [copy])).toHaveLength(0);
    expect(await db.admin(`select 1 from public.score_ledger where event_id = $1`, [copy])).toHaveLength(0);
  });

  it('reorders and duplicates venues with their challenges', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'reorder_venues', { p_event_id: ev.eventId, p_venue_ids: new PgArray([ev.venues[1].id, ev.venues[0].id]) });
    const order = await db.admin<{ name: string }>(`select name from public.venues where event_id = $1 order by position`, [ev.eventId]);
    expect(order.map((v) => v.name)).toEqual(['The Crown', 'The Fox']);
    const dup = await db.rpc<string>(owner, 'duplicate_venue', { p_venue_id: ev.venues[0].id });
    expect(await db.admin(`select 1 from public.challenges where venue_id = $1`, [dup])).toHaveLength(3);
  });
});

describe('results export', () => {
  it('contains names and scores but no ids or media paths', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    const out = await db.rpc<{ individuals: Record<string, unknown>[] }>(owner, 'get_results_export', { p_event_id: ev.eventId });
    const pat = out.individuals.find((r) => r.name === 'Pat')!;
    expect(pat).toMatchObject({ total: 10, rank: 1, challenges_completed: 1, venues_present: 1 });
    expect(JSON.stringify(out)).not.toContain(p);
    await expect(db.rpc(p, 'get_results_export', { p_event_id: ev.eventId })).rejects.toThrow(/Only organisers/);
  });
});

describe('privacy and data deletion', () => {
  it('uploaders can delete their own media; organisers can list and purge event media', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { venues: [{ name: 'V', challenges: [{ title: 'Snap', type: 'photo', points: 10 }] }] });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [p, q] = [await db.user('p'), await db.user('q')];
    await join(p, ev.code, 'Pat');
    await join(q, ev.code, 'Quinn');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    const sid = uuid();
    const path = `${ev.eventId}/${p}/${sid}/a.jpg`;
    await fakeUpload(db, p, path);
    await submit(p, ev.ch['Snap'], { p_media: [{ path, kind: 'image' }] }, sid);
    await expect(db.as(q, `select public.event_proof_objects($1)`, [ev.eventId])).rejects.toThrow(/Only organisers/);
    const listed = await db.as<{ p: string }>(owner, `select public.event_proof_objects($1) as p`, [ev.eventId]);
    expect(listed.map((r) => r.p)).toEqual([path]);
    expect((await db.as<{ p: string }>(p, `select public.my_proof_objects() as p`)).map((r) => r.p)).toEqual([path]);
    expect(await db.as(q, `select public.my_proof_objects()`)).toHaveLength(0);
    await db.as(p, `delete from storage.objects where name = $1`, [path]);
    expect(await db.admin(`select 1 from storage.objects where name = $1`, [path])).toHaveLength(0);
    // points stay after media deletion
    const b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.name === 'Pat')!.confirmed).toBe(10);
    await db.call(owner, 'forget_event_media', { p_event_id: ev.eventId });
    expect(await db.admin(`select 1 from public.submission_media where event_id = $1`, [ev.eventId])).toHaveLength(0);
  });

  it('account deletion removes a participant everywhere but refuses event owners', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    await join(p, ev.code, 'Pat');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    await expect(db.call(owner, 'delete_my_account', {})).rejects.toThrow(/Delete the events you organise/);
    await db.call(p, 'delete_my_account', {});
    expect(await db.admin(`select 1 from auth.users where id = $1`, [p])).toHaveLength(0);
    expect(await db.admin(`select 1 from public.event_members where user_id = $1`, [p])).toHaveLength(0);
    const b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.name === 'Pat')).toBeUndefined();
  });

  it('leaving keeps team history but hides you from the leaderboard', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { team_selection: 'self', team_names: [{ name: 'Red' }] } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [{ id: red }] = await db.admin<{ id: string }>(`select id from public.teams where event_id = $1`, [ev.eventId]);
    const p = await db.user('p');
    await join(p, ev.code, 'Pat', red);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    await submit(p, ev.ch['Group photo']);
    await db.call(p, 'leave_event', { p_event_id: ev.eventId });
    const b = await board(owner, ev.eventId);
    expect(b.individuals.find((r) => r.name === 'Pat')).toBeUndefined();
    expect(b.teams.find((t) => t.team_id === red)!.confirmed).toBe(10);
    // leaving revokes access to event data
    expect(await db.as(p, `select * from public.venues where event_id = $1`, [ev.eventId])).toHaveLength(0);
    // and rejoining is possible
    expect(await join(p, ev.code, 'Pat')).toBeTruthy();
  });

  it('hidden leaderboards are revealed once the event is completed', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { leaderboard_visible: false, play_mode: 'individual' } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [p, q] = [await db.user('p'), await db.user('q')];
    await join(p, ev.code, 'Pat');
    await join(q, ev.code, 'Quinn');
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'in_progress' });
    let b = await board(p, ev.eventId);
    expect(b.visible).toBe(false);
    expect(b.individuals.map((r) => r.name)).toEqual(['Pat']);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'completed' });
    b = await board(p, ev.eventId);
    expect(b.visible).toBe(true);
    expect(b.individuals).toHaveLength(2);
  });
});

describe('seed data', () => {
  it('applies cleanly and is repeatable', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'seed.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const rows = await db.admin<{ n: number }>(`select count(*)::int as n from public.events where name = 'Demo Pub Golf'`);
    expect(rows[0].n).toBe(1);
    const m = await db.admin<{ n: number }>(`select count(*)::int as n from public.event_members m join public.events e on e.id = m.event_id where e.name = 'Demo Pub Golf'`);
    expect(m[0].n).toBe(3);
  });
});

describe('player-made teams and shared gallery', () => {
  it('players can create and switch teams by default even when the organiser assigns teams', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { team_selection: 'organiser', team_max_size: 2 } });
    const [{ allow_self_teams }] = await db.admin<{ allow_self_teams: boolean }>(`select allow_self_teams from public.events where id = $1`, [ev.eventId]);
    expect(allow_self_teams).toBe(true);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const [a, b, c] = [await db.user('a'), await db.user('b'), await db.user('c')];
    const aId = await join(a, ev.code, 'Ann');
    await join(b, ev.code, 'Bob');
    await join(c, ev.code, 'Cat');
    const teamId = await db.rpc<string>(a, 'create_team', { p_event_id: ev.eventId, p_name: 'Ann’s Army', p_color: null, p_icon: null });
    const [link] = await db.admin<{ team_id: string }>(`select team_id from public.team_members where member_id = $1 and left_at is null`, [aId]);
    expect(link.team_id).toBe(teamId);
    await expect(db.rpc(b, 'create_team', { p_event_id: ev.eventId, p_name: 'ann’s army ', p_color: null, p_icon: null })).rejects.toThrow(/already a team/);
    await db.call(b, 'choose_team', { p_event_id: ev.eventId, p_team_id: teamId });
    await expect(db.call(c, 'choose_team', { p_event_id: ev.eventId, p_team_id: teamId })).rejects.toThrow(/full/);
    // organiser locks teams → no more self-service changes
    await db.admin(`update public.events set teams_locked = true where id = $1`, [ev.eventId]);
    await expect(db.call(c, 'choose_team', { p_event_id: ev.eventId, p_team_id: teamId })).rejects.toThrow(/locked/);
    await expect(db.rpc(c, 'create_team', { p_event_id: ev.eventId, p_name: 'Late team', p_color: null, p_icon: null })).rejects.toThrow(/not open/);
  });

  it('organisers can switch player-made teams off', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { team_selection: 'organiser', allow_self_teams: false, team_names: [{ name: 'Red' }] } });
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const p = await db.user('p');
    await join(p, ev.code, 'Pat');
    const [{ id }] = await db.admin<{ id: string }>(`select id from public.teams where event_id = $1`, [ev.eventId]);
    await expect(db.call(p, 'choose_team', { p_event_id: ev.eventId, p_team_id: id })).rejects.toThrow(/assigned by the organiser/);
    await expect(db.rpc(p, 'create_team', { p_event_id: ev.eventId, p_name: 'Mine', p_color: null, p_icon: null })).rejects.toThrow(/not open/);
  });

  it('the gallery lists everyone’s shared media but never rejected, hidden or other events’ media', async () => {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, { event: { play_mode: 'individual' }, venues: [{ name: 'V', challenges: [{ title: 'Snap', type: 'photo', points: 5, repeatable: true, max_attempts: 5 }, { title: 'Judge', type: 'photo', points: 5, requires_approval: true }] }] });
    const other = await setupEvent(owner, { venues: [{ name: 'W', challenges: [{ title: 'Snap', type: 'photo', points: 5 }] }] });
    for (const e of [ev, other]) {
      await db.call(owner, 'set_event_status', { p_event_id: e.eventId, p_status: 'published' });
    }
    const [p, q] = [await db.user('p'), await db.user('q')];
    await join(p, ev.code, 'Pat');
    await join(q, ev.code, 'Quinn');
    await join(p, other.code, 'Pat');
    for (const e of [ev, other]) await db.call(owner, 'set_event_status', { p_event_id: e.eventId, p_status: 'in_progress' });
    const up = async (e: typeof ev, uid: string, challenge: string) => {
      const sid = uuid();
      const path = `${e.eventId}/${uid}/${sid}/x.jpg`;
      await fakeUpload(db, uid, path);
      await submit(uid, e.ch[challenge], { p_media: [{ path, kind: 'image' }] }, sid);
      return sid;
    };
    await up(ev, p, 'Snap');
    const hiddenSid = await up(ev, p, 'Snap');
    const rejected = await up(ev, q, 'Judge');
    await up(other, p, 'Snap');
    await db.rpc(owner, 'review_submission', { p_submission_id: rejected, p_decision: 'rejected' });
    await db.call(owner, 'moderate_submission', { p_submission_id: hiddenSid, p_hidden: true });
    const seenByQ = await db.as<{ member_name: string; status: string }>(q, `select * from public.list_event_media($1)`, [ev.eventId]);
    // Pat's visible photo + Quinn's own rejected one; not Pat's hidden one or the other event's
    expect(seenByQ.map((r) => `${r.member_name}:${r.status}`).sort()).toEqual(['Pat:approved', 'Quinn:rejected']);
    const seenByP = await db.as<{ member_name: string }>(p, `select * from public.list_event_media($1)`, [ev.eventId]);
    expect(seenByP.map((r) => r.member_name).sort()).toEqual(['Pat', 'Pat']); // own hidden one is still theirs
    expect(await db.as(owner, `select * from public.list_event_media($1)`, [ev.eventId])).toHaveLength(3);
  });
});

describe('pub golf', () => {
  type GolfBoard = {
    individuals: { member_id: string; name: string; strokes: number; par: number; thru: number; to_par: number | null; rank: number | null; tied: boolean }[];
    teams: { team_id: string; name: string; to_par: number | null; rank: number | null }[];
  };
  const golfBoard = (uid: string, eventId: string) => db.rpc<GolfBoard>(uid, 'get_golf_leaderboard', { p_event_id: eventId });
  const score = (uid: string, venue: string, strokes: number | null, member?: string) =>
    db.rpc(uid, 'record_golf_score', { p_venue_id: venue, p_strokes: strokes, p_member_id: member ?? null });

  async function course(event: Record<string, unknown> = {}) {
    const owner = await db.user('owner');
    const ev = await setupEvent(owner, {
      event: { game_mode: 'golf', golf_default_par: 3, golf_max_over: 3, skip_policy: 'zero', play_mode: 'both', team_selection: 'self', team_names: [{ name: 'Red' }, { name: 'Blue' }], ...event },
      venues: [
        { name: 'Hole 1', par: 4, drink: 'Pint or pint of soft drink', challenges: [{ title: 'Birdie bonus', type: 'checkbox', points: 1 }] },
        { name: 'Hole 2', drink: 'Half or lemonade', challenges: [] },
        { name: 'Hole 3', par: 2, challenges: [] },
      ],
    });
    const [{ game_mode }] = await db.admin<{ game_mode: string }>(`select game_mode from public.events where id = $1`, [ev.eventId]);
    expect(game_mode).toBe('golf');
    const drinks = await db.admin<{ drink: string | null; par: number | null }>(`select drink, par from public.venues where event_id = $1 order by position`, [ev.eventId]);
    expect(drinks).toEqual([{ drink: 'Pint or pint of soft drink', par: 4 }, { drink: 'Half or lemonade', par: null }, { drink: null, par: 2 }]);
    await db.call(owner, 'set_event_status', { p_event_id: ev.eventId, p_status: 'published' });
    const teams = await db.admin<{ id: string; name: string }>(`select id, name from public.teams where event_id = $1`, [ev.eventId]);
    const red = teams.find((t) => t.name === 'Red')!.id;
    const blue = teams.find((t) => t.name === 'Blue')!.id;
    return { owner, ...ev, red, blue };
  }

  it('lowest to-par wins; missed holes count as par + max; challenges take strokes off', async () => {
    const c = await course();
    const [a, b] = [await db.user('a'), await db.user('b')];
    const aId = await join(a, c.code, 'Ann', c.red);
    await join(b, c.code, 'Bob', c.blue);
    await expect(score(a, c.venues[0].id, 3)).rejects.toThrow(/when the crawl starts/);
    await db.call(c.owner, 'set_event_status', { p_event_id: c.eventId, p_status: 'in_progress' });
    await score(a, c.venues[0].id, 3); // birdie on par 4
    await score(b, c.venues[0].id, 6); // +2
    await expect(score(b, c.venues[0].id, 8)).rejects.toThrow(/between 1 and 7/);
    await submit(a, c.ch['Birdie bonus']); // -1 stroke
    await score(a, c.venues[0].id, 4); // change of mind: overwrite, not duplicate
    expect(await db.admin(`select 1 from public.golf_scores where member_id = $1`, [aId])).toHaveLength(1);
    let g = await golfBoard(a, c.eventId);
    const ann = () => g.individuals.find((r) => r.name === 'Ann')!;
    const bob = () => g.individuals.find((r) => r.name === 'Bob')!;
    expect(ann()).toMatchObject({ strokes: 4, par: 4, thru: 1, to_par: -1, rank: 1 });
    expect(bob()).toMatchObject({ to_par: 2, rank: 2 });
    // hole 2 closes: Ann scores 3 (par 3 default), Bob never records → par + 3 = 6
    await db.rpc(c.owner, 'advance_venue', { p_event_id: c.eventId });
    await score(a, c.venues[1].id, 3);
    await expect(score(b, c.venues[0].id, 5)).rejects.toThrow(/closed/);
    await db.rpc(c.owner, 'advance_venue', { p_event_id: c.eventId });
    g = await golfBoard(a, c.eventId);
    expect(ann()).toMatchObject({ thru: 2, to_par: -1 });
    expect(bob()).toMatchObject({ thru: 2, strokes: 12, par: 7, to_par: 5 });
    // teams: average member to-par
    expect(g.teams.find((t) => t.team_id === c.red)!.to_par).toBe(-1);
    expect(g.teams.find((t) => t.team_id === c.blue)!.to_par).toBe(5);
    // organiser can correct a closed hole for someone (audited); players can't touch others
    await expect(score(a, c.venues[1].id, 2, (g.individuals.find((r) => r.name === 'Bob')!).member_id)).rejects.toThrow(/Only organisers/);
    await score(c.owner, c.venues[1].id, 3, bob().member_id);
    g = await golfBoard(a, c.eventId);
    expect(bob().to_par).toBe(2);
    expect(await db.admin(`select 1 from public.event_audit_log where event_id = $1 and action = 'golf.set_by_organiser'`, [c.eventId])).toHaveLength(1);
  });

  it('late joiners and "no penalty" skips are judged only on holes played', async () => {
    const c = await course({ skip_policy: 'none', play_mode: 'individual' });
    const a = await db.user('a');
    await join(a, c.code, 'Ann');
    await db.call(c.owner, 'set_event_status', { p_event_id: c.eventId, p_status: 'in_progress' });
    await score(a, c.venues[0].id, 4);
    await db.rpc(c.owner, 'advance_venue', { p_event_id: c.eventId });
    const late = await db.user('late');
    await join(late, c.code, 'Lou');
    await db.call(a, 'skip_venue', { p_venue_id: c.venues[1].id, p_reason: 'food' });
    await expect(score(a, c.venues[1].id, 2)).rejects.toThrow(/skipped/);
    await score(late, c.venues[1].id, 2); // -1 on par 3
    await db.rpc(c.owner, 'advance_venue', { p_event_id: c.eventId });
    const g = await golfBoard(a, c.eventId);
    expect(g.individuals.find((r) => r.name === 'Ann')).toMatchObject({ thru: 1, to_par: 0 });
    expect(g.individuals.find((r) => r.name === 'Lou')).toMatchObject({ thru: 1, to_par: -1, rank: 1 });
  });

  it('players who have not played are listed unranked; golf scores are private to their event', async () => {
    const c = await course({ play_mode: 'individual' });
    const [a, outsider] = [await db.user('a'), await db.user('o')];
    await join(a, c.code, 'Ann');
    await db.call(c.owner, 'set_event_status', { p_event_id: c.eventId, p_status: 'in_progress' });
    const g = await golfBoard(a, c.eventId);
    expect(g.individuals[0]).toMatchObject({ name: 'Ann', to_par: null, rank: null, thru: 0 });
    await expect(golfBoard(outsider, c.eventId)).rejects.toThrow(/Join the event/);
    await expect(score(outsider, c.venues[0].id, 3)).rejects.toThrow(/Join the event/);
    await expect(db.as(a, `insert into public.golf_scores (event_id, venue_id, member_id, strokes) select $1, $2, id, 1 from public.event_members where user_id = auth.uid()`, [c.eventId, c.venues[0].id])).rejects.toThrow(/permission denied/);
    // crawl-mode events refuse golf scores
    const crawl = await setupEvent(c.owner);
    await db.call(c.owner, 'set_event_status', { p_event_id: crawl.eventId, p_status: 'published' });
    await join(a, crawl.code, 'Ann');
    await db.call(c.owner, 'set_event_status', { p_event_id: crawl.eventId, p_status: 'in_progress' });
    await expect(score(a, crawl.venues[0].id, 3)).rejects.toThrow(/isn.t using pub golf/);
  });

  it('duplicating a golf event keeps the mode, pars and drinks', async () => {
    const c = await course();
    const copy = await db.rpc<string>(c.owner, 'duplicate_event', { p_event_id: c.eventId, p_name: 'Again' });
    expect(await db.admin(`select game_mode, golf_max_over from public.events where id = $1`, [copy])).toEqual([{ game_mode: 'golf', golf_max_over: 3 }]);
    expect((await db.admin<{ drink: string | null }>(`select drink from public.venues where event_id = $1 order by position`, [copy])).map((r) => r.drink)).toEqual(['Pint or pint of soft drink', 'Half or lemonade', null]);
  });
});
