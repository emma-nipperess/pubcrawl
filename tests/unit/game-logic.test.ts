import { describe, expect, it } from 'vitest';
import { routeSummary, venueProgress, directionsUrl } from '@/features/venues/progress';
import { challengeState } from '@/features/challenges/meta';
import { buildScorecard } from '@/features/challenges/scorecard';
import { canTransition, statusActions, TRANSITIONS } from '@/features/events/status';
import { competitionRank, rankLabel, rankMovements, ordinal } from '@/features/leaderboard/rank';
import type { ChallengeRow, LedgerRow, ParticipationRow, SubmissionRow, VenueRow } from '@/lib/supabase/types';

const venue = (id: string, position: number, status: VenueRow['status'], extra: Partial<VenueRow> = {}): VenueRow =>
  ({ id, event_id: 'e', position, name: `V${position}`, status, disabled: false, bonus_points: 0, par: null, address: null, maps_url: null, latitude: null, longitude: null, ...extra }) as VenueRow;
const part = (venue_id: string, status: 'present' | 'skipped', member_id = 'm'): ParticipationRow =>
  ({ id: `${venue_id}-${member_id}`, event_id: 'e', venue_id, member_id, team_id: null, status, skip_reason: null, overridden_by: null, created_at: '' }) as ParticipationRow;
const ch = (id: string, venue_id: string | null, extra: Partial<ChallengeRow> = {}): ChallengeRow =>
  ({ id, event_id: 'e', venue_id, title: id, type: 'checkbox', scope: 'individual', required: true, points: 10, bonus_points: 0, max_attempts: 1, repeatable: false, archived: false, ...extra }) as ChallengeRow;
const sub = (challenge_id: string, status: SubmissionRow['status'], created_at = '2026-01-01T00:00:00Z', extra: Partial<SubmissionRow> = {}): SubmissionRow =>
  ({ id: `${challenge_id}-${created_at}-${status}`, challenge_id, status, created_at, member_id: 'm', team_id: null, scope: 'individual', ...extra }) as SubmissionRow;
const led = (points: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({ id: String(Math.random()), event_id: 'e', source: 'submission', source_id: 's', kind: 'points', member_id: 'm', team_id: null, venue_id: null, challenge_id: null, points, provisional: false, created_at: '', ...extra });

describe('venue progress, late joining and skipping', () => {
  const venues = [venue('a', 0, 'completed'), venue('b', 1, 'completed'), venue('c', 2, 'active'), venue('d', 3, 'upcoming')];

  it('late joiners are not marked as missing venues before they arrived', () => {
    const p = venueProgress(venues, [], { id: 'm', joined_late: true, joined_venue_position: 2 });
    expect(p.map((x) => x.state)).toEqual(['before_join', 'before_join', 'active', 'upcoming']);
  });

  it('on-time players who did not attend are marked as missed', () => {
    const p = venueProgress(venues, [part('a', 'present')], { id: 'm', joined_late: false, joined_venue_position: null });
    expect(p.map((x) => x.state)).toEqual(['done', 'missed', 'active', 'upcoming']);
  });

  it('tracks skipped, active-but-skipped and pre-skipped upcoming venues', () => {
    const p = venueProgress(venues, [part('b', 'skipped'), part('c', 'skipped'), part('d', 'skipped')], { id: 'm', joined_late: false, joined_venue_position: null });
    expect(p.map((x) => x.state)).toEqual(['missed', 'skipped', 'active_skipped', 'skipped']);
  });

  it('ignores other people’s participation', () => {
    const p = venueProgress(venues, [part('a', 'skipped', 'someone-else')], { id: 'm', joined_late: false, joined_venue_position: null });
    expect(p[0].state).toBe('missed');
  });

  it('handles disabled and group-skipped venues', () => {
    const p = venueProgress([venue('a', 0, 'skipped'), venue('b', 1, 'upcoming', { disabled: true })], [], null);
    expect(p.map((x) => x.state)).toEqual(['group_skipped', 'disabled']);
    expect(routeSummary(p).total).toBe(1);
  });

  it('summarises the route', () => {
    const s = routeSummary(venueProgress(venues, [], { id: 'm', joined_late: false, joined_venue_position: null }));
    expect(s).toMatchObject({ total: 4, finished: 2 });
    expect(s.current?.venue.id).toBe('c');
    expect(s.next?.venue.id).toBe('d');
  });

  it('builds directions links without any maps API', () => {
    expect(directionsUrl({ maps_url: 'https://maps.app.goo.gl/x', latitude: null, longitude: null, address: null, name: 'x' })).toBe('https://maps.app.goo.gl/x');
    expect(directionsUrl({ maps_url: 'javascript:alert(1)', latitude: 1, longitude: 2, address: null, name: 'x' })).toContain('destination=1,2');
    expect(directionsUrl({ maps_url: null, latitude: null, longitude: null, address: '1 High St', name: 'The Fox' })).toContain(encodeURIComponent('The Fox, 1 High St'));
    expect(directionsUrl({ maps_url: null, latitude: null, longitude: null, address: null, name: 'x' })).toBeNull();
  });
});

describe('challenge state (duplicate submission prevention in the UI)', () => {
  it('is open with no submissions', () => {
    expect(challengeState(ch('c', 'v'), [], []).state).toBe('open');
  });
  it('is done once approved and cannot be redone', () => {
    expect(challengeState(ch('c', 'v'), [sub('c', 'approved')], []).state).toBe('done');
  });
  it('is pending while waiting for review', () => {
    expect(challengeState(ch('c', 'v'), [sub('c', 'pending')], []).state).toBe('pending');
  });
  it('allows a retry after rejection when attempts remain', () => {
    expect(challengeState(ch('c', 'v', { max_attempts: 2 }), [sub('c', 'rejected')], []).state).toBe('rejected');
    expect(challengeState(ch('c', 'v', { max_attempts: 1 }), [sub('c', 'rejected')], []).state).toBe('no_attempts');
  });
  it('resubmission requests do not use up an attempt', () => {
    const r = challengeState(ch('c', 'v'), [sub('c', 'resubmit')], []);
    expect(r).toMatchObject({ state: 'resubmit', attemptsUsed: 0 });
  });
  it('team challenges use the team’s submissions, not just mine', () => {
    const c = ch('c', 'v', { scope: 'team' });
    expect(challengeState(c, [], [sub('c', 'approved', undefined, { member_id: 'teammate', scope: 'team' })]).state).toBe('done');
    expect(challengeState(c, [sub('c', 'approved')], []).state).toBe('open');
  });
  it('withdrawn submissions are ignored', () => {
    expect(challengeState(ch('c', 'v'), [sub('c', 'withdrawn')], []).state).toBe('open');
  });
});

describe('scorecards', () => {
  const venues = [venue('a', 0, 'completed', { bonus_points: 5 }), venue('b', 1, 'completed'), venue('c', 2, 'active')];
  const challenges = [ch('a1', 'a'), ch('a2', 'a', { required: false, points: 5 }), ch('b1', 'b'), ch('c1', 'c'), ch('x', 'c', { archived: true })];

  it('totals come from the ledger, statuses from submissions', () => {
    const progress = venueProgress(venues, [part('a', 'present'), part('b', 'skipped')], { id: 'm', joined_late: false, joined_venue_position: null });
    const card = buildScorecard({
      progress,
      challenges,
      submissions: [sub('a1', 'approved'), sub('a2', 'rejected'), sub('c1', 'pending')],
      ledger: [led(10, { venue_id: 'a' }), led(5, { venue_id: 'a', kind: 'bonus', source: 'venue_bonus' }), led(-2, { venue_id: 'a', kind: 'penalty' }), led(3, { kind: 'adjustment', source: 'adjustment' }), led(7, { provisional: true, venue_id: 'c' })],
    });
    expect(card.total).toBe(16);
    expect(card.provisional).toBe(7);
    expect(card.bonus).toBe(5);
    expect(card.penalties).toBe(-2);
    expect(card.adjustments).toBe(3);
    expect(card.completed).toBe(1);
    expect(card.pending).toBe(1);
    expect(card.rejected).toBe(1);
    // b1 missed at a skipped venue; c1 is pending at the active venue → not missed
    expect(card.missed).toBe(1);
    expect(card.rows.find((r) => r.venue.id === 'a')).toMatchObject({ earned: 13, available: 20, completed: 1 });
    // required: a1, b1, c1 → 1 of 3 done
    expect(card.completionPercent).toBe(33);
  });

  it('venues before a late join do not count against completion', () => {
    const progress = venueProgress(venues, [], { id: 'm', joined_late: true, joined_venue_position: 2 });
    const card = buildScorecard({ progress, challenges, submissions: [sub('c1', 'approved')], ledger: [led(10, { venue_id: 'c' })] });
    expect(card.missed).toBe(0);
    expect(card.completionPercent).toBe(100);
  });

  it('skipping awards nothing', () => {
    const progress = venueProgress(venues, [part('a', 'skipped'), part('b', 'skipped')], { id: 'm', joined_late: false, joined_venue_position: null });
    const card = buildScorecard({ progress, challenges, submissions: [], ledger: [] });
    expect(card.total).toBe(0);
    expect(card.completed).toBe(0);
  });
});

describe('event state transitions', () => {
  it('only allows the documented lifecycle', () => {
    expect(canTransition('draft', 'published')).toBe(true);
    expect(canTransition('draft', 'in_progress')).toBe(false);
    expect(canTransition('published', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'paused')).toBe(true);
    expect(canTransition('paused', 'in_progress')).toBe(true);
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('archived', 'draft')).toBe(false);
    expect(TRANSITIONS.archived).toEqual([]);
  });
  it('asks for confirmation before major changes', () => {
    const live = statusActions('in_progress');
    expect(live.find((a) => a.to === 'completed')?.confirm?.danger).toBe(true);
    expect(live.find((a) => a.to === 'cancelled')?.confirm).toBeTruthy();
    expect(statusActions('published').find((a) => a.to === 'in_progress')?.confirm).toBeTruthy();
    expect(statusActions('paused').find((a) => a.to === 'in_progress')?.label).toMatch(/Resume/);
  });
});

describe('ranking and ties', () => {
  it('uses standard competition ranking with shared positions', () => {
    const r = competitionRank([{ n: 'a', s: 10 }, { n: 'b', s: 10 }, { n: 'c', s: 5 }, { n: 'd', s: 5 }, { n: 'e', s: 1 }], (x) => x.s);
    expect(r.map((x) => [x.n, x.rank, x.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, true],
      ['d', 3, true],
      ['e', 5, false],
    ]);
  });
  it('applies a secondary tie-break', () => {
    const r = competitionRank([{ n: 'a', s: 10, c: 1 }, { n: 'b', s: 10, c: 3 }], (x) => x.s, (x, y) => y.c - x.c);
    expect(r.map((x) => [x.n, x.rank, x.tied])).toEqual([
      ['b', 1, false],
      ['a', 2, false],
    ]);
  });
  it('labels and movement', () => {
    expect(rankLabel(2, true)).toBe('=2');
    expect(rankLabel(2, false)).toBe('2');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
    const m = rankMovements(new Map([['a', 2], ['b', 1]]), [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }]);
    expect(m.get('a')).toEqual({ kind: 'up', by: 1 });
    expect(m.get('b')).toEqual({ kind: 'down', by: 1 });
    expect(m.get('c')?.kind).toBe('new');
  });
});
