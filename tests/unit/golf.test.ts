import { describe, expect, it } from 'vitest';
import { formatToPar, GOLF_HOLES, holePar, holeResult } from '@/features/golf/golf';
import { golfPersonRow, golfTeamRow } from '@/features/golf/golfRows';
import type { GolfPerson, GolfTeam } from '@/lib/supabase/types';

describe('pub golf display', () => {
  it('formats scores relative to par', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(-2)).toBe('−2');
    expect(formatToPar(3)).toBe('+3');
    expect(formatToPar(1.5)).toBe('+1.5');
    expect(formatToPar(-0.04)).toBe('E');
    expect(formatToPar(null)).toBe('–');
  });
  it('names hole results', () => {
    expect(holeResult(1, 3).label).toBe('Hole in one!');
    expect(holeResult(2, 4).label).toBe('Eagle');
    expect(holeResult(2, 3).label).toBe('Birdie');
    expect(holeResult(3, 3).label).toBe('Par');
    expect(holeResult(4, 3).label).toBe('Bogey');
    expect(holeResult(5, 3).label).toBe('Double bogey');
    expect(holeResult(7, 3).label).toBe('+4');
  });
  it('falls back to the event default par', () => {
    expect(holePar(null, 3)).toBe(3);
    expect(holePar(5, 3)).toBe(5);
  });
  it('starter course always offers a soft-drink or water option and never shots', () => {
    for (const h of GOLF_HOLES) {
      expect(h.par).toBeGreaterThanOrEqual(1);
      expect(h.drink).not.toMatch(/\bshots?\b|chug|down it/i);
    }
    expect(GOLF_HOLES.some((h) => /water/i.test(h.drink))).toBe(true);
    expect(GOLF_HOLES.filter((h) => /soft|water|juice|lemonade|mocktail|hot drink|anything|choice/i.test(h.drink))).toHaveLength(GOLF_HOLES.length);
  });
  it('maps leaderboard rows; unplayed players are unranked', () => {
    const p = { member_id: 'm', name: 'Ann', avatar_color: '#fff', avatar_icon: 'star', team_id: null, strokes: 9, par: 10, thru: 3, adjustment: 1, pending: 0, to_par: -2, rank: 1, tied: false, is_me: true } as GolfPerson;
    expect(golfPersonRow(p)).toMatchObject({ display: '−2', rank: 1, sub: 'Thru 3 · 1 off', mine: true });
    expect(golfPersonRow({ ...p, thru: 0, to_par: null, rank: null, adjustment: 0 })).toMatchObject({ display: '–', rank: 0, sub: 'Yet to tee off' });
    const t = { team_id: 't', name: 'Red', color: '#f00', icon: 'flag', size: 2, thru: 5, to_par: '1.5' as unknown as number, adjustment: 0, rank: 2, tied: true, is_mine: false } as GolfTeam;
    expect(golfTeamRow(t)).toMatchObject({ display: '+1.5', rank: 2, tied: true });
  });
});
