import type { EventStatus } from '@/lib/supabase/types';

/**
 * Mirror of public.event_status_transition_allowed() in the database. The
 * database is authoritative; this copy only decides which buttons to show.
 */
export const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['draft', 'in_progress', 'cancelled'],
  in_progress: ['paused', 'completed', 'cancelled'],
  paused: ['in_progress', 'completed', 'cancelled'],
  completed: ['archived'],
  cancelled: ['archived'],
  archived: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Draft',
  published: 'Open to join',
  in_progress: 'Live',
  paused: 'Paused',
  completed: 'Finished',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<EventStatus, 'info' | 'success' | 'warn' | 'danger' | 'accent' | 'neutral'> = {
  draft: 'neutral',
  published: 'info',
  in_progress: 'accent',
  paused: 'warn',
  completed: 'success',
  archived: 'neutral',
  cancelled: 'danger',
};

export interface StatusAction {
  to: EventStatus;
  label: string;
  confirm?: { title: string; body: string; danger?: boolean };
  primary?: boolean;
}

/** Actions offered on the control panel for the current status. */
export function statusActions(status: EventStatus): StatusAction[] {
  const all: Record<EventStatus, StatusAction> = {
    published: { to: 'published', label: 'Publish & open joining', primary: true },
    draft: { to: 'draft', label: 'Back to draft', confirm: { title: 'Unpublish?', body: 'The invitation link stops working until you publish again.' } },
    in_progress: {
      to: 'in_progress',
      label: status === 'paused' ? 'Resume the crawl' : 'Start the crawl',
      primary: true,
      confirm: status === 'paused' ? undefined : { title: 'Start the crawl?', body: 'The first venue opens and its challenges are revealed to everyone.' },
    },
    paused: { to: 'paused', label: 'Pause', confirm: { title: 'Pause the crawl?', body: 'Nobody can submit until you resume.' } },
    completed: { to: 'completed', label: 'Finish the crawl', confirm: { title: 'Finish the crawl?', body: 'Submissions close and final results are shown to everyone. This cannot be undone.', danger: true } },
    cancelled: { to: 'cancelled', label: 'Cancel event', confirm: { title: 'Cancel this event?', body: 'Participants will see it as cancelled and can no longer play. This cannot be undone.', danger: true } },
    archived: { to: 'archived', label: 'Archive', confirm: { title: 'Archive this event?', body: 'It becomes read-only. You can still view results and export them.' } },
  };
  return TRANSITIONS[status].map((to) => all[to]);
}

export const isLive = (s: EventStatus) => s === 'in_progress' || s === 'paused';
export const isOver = (s: EventStatus) => s === 'completed' || s === 'archived' || s === 'cancelled';
