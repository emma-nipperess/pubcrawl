import { describe, expect, it } from 'vitest';
import { fisherYates, imbalance, pickTeamForLateJoiner, resolveTeamCount, shuffleIntoTeams } from '@/features/teams/shuffle';

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('team shuffling', () => {
  it('keeps every member exactly once', () => {
    const teams = shuffleIntoTeams(people(23), { teamCount: 4, rng: seeded(1) });
    const flat = teams.flat().sort();
    expect(flat).toEqual(people(23).sort());
  });

  it('balances team sizes to within one', () => {
    for (let n = 1; n <= 40; n++) {
      for (const k of [2, 3, 4, 5, 7]) {
        const teams = shuffleIntoTeams(people(n), { teamCount: k, rng: seeded(n * 31 + k) });
        expect(imbalance(teams)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('respects a target team size', () => {
    const teams = shuffleIntoTeams(people(10), { teamSize: 4, rng: seeded(3) });
    expect(teams).toHaveLength(3);
    expect(Math.max(...teams.map((t) => t.length))).toBeLessThanOrEqual(4);
    expect(imbalance(teams)).toBeLessThanOrEqual(1);
  });

  it('never creates more teams than people', () => {
    expect(resolveTeamCount(3, { teamCount: 8 })).toBe(3);
    expect(shuffleIntoTeams(people(3), { teamCount: 8 }).every((t) => t.length === 1)).toBe(true);
  });

  it('does not always put the same people first (actually random)', () => {
    const firsts = new Set<string>();
    for (let s = 0; s < 50; s++) firsts.add(shuffleIntoTeams(people(12), { teamCount: 3, rng: seeded(s) })[0][0]);
    expect(firsts.size).toBeGreaterThan(5);
  });

  it('randomises which teams get the extra members', () => {
    const bigFirst = new Set<number>();
    for (let s = 0; s < 40; s++) {
      const teams = shuffleIntoTeams(people(7), { teamCount: 3, rng: seeded(s) });
      bigFirst.add(teams.findIndex((t) => t.length === 3));
    }
    expect(bigFirst.size).toBeGreaterThan(1);
  });

  it('Fisher–Yates is unbiased enough over many runs', () => {
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const rng = seeded(42);
    const N = 20000;
    for (let i = 0; i < N; i++) fisherYates([0, 1, 2, 3], rng).forEach((v, pos) => counts[v][pos]++);
    for (const row of counts) for (const c of row) expect(Math.abs(c / N - 0.25)).toBeLessThan(0.02);
  });

  it('uses crypto randomness by default', () => {
    const teams = shuffleIntoTeams(people(9), { teamCount: 3 });
    expect(teams.flat()).toHaveLength(9);
  });
});

describe('late joiner placement', () => {
  it('picks the smallest team with room', () => {
    const t = pickTeamForLateJoiner(
      [
        { id: 'a', size: 4 },
        { id: 'b', size: 2 },
        { id: 'c', size: 3 },
      ],
      seeded(1),
    );
    expect(t?.id).toBe('b');
  });

  it('skips full teams and returns null when all are full', () => {
    expect(pickTeamForLateJoiner([{ id: 'a', size: 2, maxSize: 2 }, { id: 'b', size: 3, maxSize: 4 }])?.id).toBe('b');
    expect(pickTeamForLateJoiner([{ id: 'a', size: 2, maxSize: 2 }])).toBeNull();
  });

  it('spreads ties between equally small teams', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) seen.add(pickTeamForLateJoiner([{ id: 'a', size: 1 }, { id: 'b', size: 1 }], seeded(s))!.id);
    expect(seen).toEqual(new Set(['a', 'b']));
  });
});
