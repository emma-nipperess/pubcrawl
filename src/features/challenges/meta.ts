import type { ChallengeRow, ChallengeType, SubmissionRow } from '@/lib/supabase/types';

/**
 * Registry of challenge types. To add a new type: add it to the database
 * CHECK constraint (new migration), add an entry here, and (if it needs a
 * special input) handle it in SubmitSheet.
 */
export const CHALLENGE_TYPES: Record<ChallengeType, { label: string; icon: string; hint: string; proof: 'photo' | 'video' | 'either' | 'none' }> = {
  photo: { label: 'Photo', icon: 'camera', hint: 'Snap a photo as proof', proof: 'photo' },
  video: { label: 'Video', icon: 'video', hint: 'Record a short clip', proof: 'video' },
  photo_or_video: { label: 'Photo or video', icon: 'image', hint: 'Photo or short clip', proof: 'either' },
  text: { label: 'Text answer', icon: 'message-square', hint: 'Type your answer', proof: 'none' },
  multiple_choice: { label: 'Multiple choice', icon: 'list-checks', hint: 'Pick one answer', proof: 'none' },
  checkbox: { label: 'Tick when done', icon: 'check', hint: 'Honour system', proof: 'none' },
  team: { label: 'Team challenge', icon: 'users', hint: 'One completion for the whole team', proof: 'none' },
  bonus: { label: 'Bonus', icon: 'sparkles', hint: 'Optional extra points', proof: 'none' },
  verified: { label: 'Organiser verified', icon: 'badge-check', hint: 'An organiser confirms it', proof: 'none' },
  custom: { label: 'Custom', icon: 'puzzle', hint: 'Your own rules', proof: 'none' },
};

export const SUBMISSION_STATUS: Record<SubmissionRow['status'], { label: string; tone: 'success' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  pending: { label: 'Waiting for review', tone: 'warn' },
  approved: { label: 'Completed', tone: 'success' },
  rejected: { label: 'Not accepted', tone: 'danger' },
  resubmit: { label: 'Try again', tone: 'info' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export function totalPoints(c: Pick<ChallengeRow, 'points' | 'bonus_points'>): number {
  return c.points + c.bonus_points;
}

export type ChallengeState = 'open' | 'pending' | 'done' | 'rejected' | 'resubmit' | 'locked' | 'no_attempts';

/**
 * Where does this challenge stand for me (individual) or my team?
 * Mirrors the checks in submit_challenge so the UI only offers valid actions.
 */
export function challengeState(
  c: ChallengeRow,
  mySubs: readonly SubmissionRow[],
  teamSubs: readonly SubmissionRow[],
): { state: ChallengeState; latest?: SubmissionRow; attemptsUsed: number } {
  const relevant = (c.scope === 'team' ? teamSubs : mySubs)
    .filter((s) => s.challenge_id === c.id && s.status !== 'withdrawn')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = relevant[0];
  const attemptsUsed = relevant.filter((s) => s.status !== 'resubmit').length;
  if (!c.repeatable) {
    if (relevant.some((s) => s.status === 'approved')) return { state: 'done', latest, attemptsUsed };
    if (relevant.some((s) => s.status === 'pending')) return { state: 'pending', latest, attemptsUsed };
  }
  if (attemptsUsed >= c.max_attempts) return { state: latest?.status === 'approved' ? 'done' : 'no_attempts', latest, attemptsUsed };
  if (latest?.status === 'resubmit') return { state: 'resubmit', latest, attemptsUsed };
  if (latest?.status === 'rejected') return { state: 'rejected', latest, attemptsUsed };
  return { state: 'open', latest, attemptsUsed };
}
