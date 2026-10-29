import type { GolfPerson, GolfTeam } from '@/lib/supabase/types';
import type { BoardRow } from '@/features/leaderboard/LeaderboardList';
import { formatToPar } from './golf';

export function golfPersonRow(p: GolfPerson): BoardRow {
  return {
    id: p.member_id, name: p.name, color: p.avatar_color, icon: p.avatar_icon,
    score: p.to_par ?? 0, confirmed: p.to_par ?? 0, pending: p.pending, rank: p.rank ?? 0, tied: p.tied, mine: p.is_me,
    display: formatToPar(p.to_par),
    note: p.thru ? `${p.strokes} strokes` : 'not started',
    sub: p.thru ? `Thru ${p.thru}${p.adjustment ? ` · ${p.adjustment > 0 ? `${p.adjustment} off` : `${-p.adjustment} added`}` : ''}` : 'Yet to tee off',
  };
}

export function golfTeamRow(t: GolfTeam): BoardRow {
  return {
    id: t.team_id, name: t.name, color: t.color, icon: t.icon,
    score: Number(t.to_par ?? 0), confirmed: Number(t.to_par ?? 0), pending: 0, rank: t.rank ?? 0, tied: t.tied, mine: t.is_mine,
    display: formatToPar(t.to_par == null ? null : Number(t.to_par)),
    note: 'avg to par',
    sub: `${t.size} ${t.size === 1 ? 'player' : 'players'} · ${t.thru} holes played`,
  };
}
