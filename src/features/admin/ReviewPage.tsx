import { useState } from 'react';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { rpc, useAchievements, useChallenges, useMembers, useReviewQueue, useTeams, type FeedItem } from '@/lib/supabase/queries';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, NumberInput, Segmented, Select, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { ProofMedia } from '@/features/media/ProofMedia';
import { SUBMISSION_STATUS } from '@/features/challenges/meta';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/lib/auth';

export default function ReviewPage() {
  const { event } = useEventCtx();
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const q = useReviewQueue(event.id, tab, true);
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <AdminShell title="Review">
      <h1 className="deco-title">Review proof</h1>
      <Segmented
        legend="Show"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pending', label: 'Waiting', icon: 'hourglass' },
          { value: 'reviewed', label: 'All reviewed', icon: 'check' },
        ]}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="badge-check" title={tab === 'pending' ? 'All caught up' : 'Nothing reviewed yet'}>
          {tab === 'pending' ? 'New proof that needs approval appears here instantly.' : undefined}
        </EmptyState>
      ) : (
        <ul className="list" style={{ gap: 'var(--s-4)' }}>
          {rows.map((s) => (
            <ReviewItem key={s.id} s={s} />
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button block loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </AdminShell>
  );
}

function ReviewItem({ s }: { s: FeedItem }) {
  const { event, theme, member, isOwner } = useEventCtx();
  const { user } = useAuth();
  const members = useMembers(event.id);
  const challenges = useChallenges(event.id);
  const teams = useTeams(event.id);
  const ach = useAchievements(event.id);
  const { run, busy } = useAdminAction(event.id);
  const [note, setNote] = useState('');
  const [points, setPoints] = useState<number | null>(s.points_snapshot);
  const [award, setAward] = useState('');
  const who = members.data?.find((m) => m.id === s.member_id);
  const c = challenges.data?.find((x) => x.id === s.challenge_id);
  const t = teams.data?.teams.find((x) => x.id === s.team_id);
  const own = member?.id === s.member_id || who?.user_id === user?.id;
  const st = SUBMISSION_STATUS[s.status];
  const manualDefs = (ach.data?.defs ?? []).filter((d) => d.rule === 'manual' && d.enabled);

  const decide = (decision: 'approved' | 'rejected' | 'resubmit') =>
    run(`${decision}-${s.id}`, () => rpc('review_submission', { p_submission_id: s.id, p_decision: decision, p_note: note || null, p_points: decision === 'approved' && event.allow_partial_points ? points : null }), {
      success: decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Asked to resubmit',
      confirm: s.status === 'approved' && decision !== 'approved' ? { title: 'Overturn an approval?', body: 'Points from this submission will be removed.', danger: true } : undefined,
    });

  return (
    <li>
      <Card className="stack-sm">
        <div className="row-between">
          <div style={{ minWidth: 0 }}>
            <strong className="truncate" style={{ display: 'block' }}>
              {c?.title ?? theme.vocab.challenge}
            </strong>
            <span className="xsmall muted">
              {who?.display_name ?? 'Someone'}
              {s.scope === 'team' && t ? ` for ${t.name}` : ''} · attempt {s.attempt_no} · {timeAgo(s.created_at)}
            </span>
          </div>
          <Badge tone={st.tone === 'neutral' ? 'neutral' : st.tone}>{st.label}</Badge>
        </div>
        {c?.description && <p className="xsmall muted">{c.description}</p>}
        {s.submission_media.length > 0 && (
          <div className={s.submission_media.length > 1 ? 'media-grid' : ''}>
            {s.submission_media.map((m) => (
              <ProofMedia key={m.id} media={m} alt={`Proof from ${who?.display_name ?? 'participant'}`} full={s.submission_media.length === 1 && m.kind === 'image'} />
            ))}
          </div>
        )}
        {s.text_response && <p className="prewrap card card--muted card--tight">{s.text_response}</p>}
        {s.choice_index != null && c?.choices && (
          <p className="small">
            Answered: <strong>{c.choices[s.choice_index]}</strong>
          </p>
        )}
        {s.caption && <p className="small prewrap">“{s.caption}”</p>}
        {s.review_note && <p className="xsmall muted">Note: {s.review_note}</p>}
        {s.hidden && <Badge tone="warn" icon="eye-off">Hidden from players</Badge>}

        {own && !isOwner ? (
          <p className="small muted">This is your own submission — another organiser needs to review it.</p>
        ) : (
          <>
            {s.status !== 'withdrawn' && (
              <>
                <TextInput label="Note to player (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We need to see the whole team" />
                {event.allow_partial_points && s.status !== 'approved' && (
                  <NumberInput label={`Points to award (max ${s.points_snapshot})`} min={0} max={s.points_snapshot} value={points} onValue={setPoints} />
                )}
                <div className="grid-2">
                  {s.status !== 'approved' && (
                    <Button variant="primary" icon="check" loading={busy === `approved-${s.id}`} onClick={() => decide('approved')}>
                      Approve
                    </Button>
                  )}
                  {s.status !== 'rejected' && (
                    <Button variant="danger" icon="x" loading={busy === `rejected-${s.id}`} onClick={() => decide('rejected')}>
                      Reject
                    </Button>
                  )}
                  {s.status === 'pending' && (
                    <Button icon="undo" loading={busy === `resubmit-${s.id}`} onClick={() => decide('resubmit')}>
                      Ask to redo
                    </Button>
                  )}
                </div>
              </>
            )}
            <div className="row-wrap">
              <Button size="sm" variant="ghost" icon={s.hidden ? 'eye' : 'eye-off'} onClick={() => run(`hide-${s.id}`, () => rpc('moderate_submission', { p_submission_id: s.id, p_hidden: !s.hidden }), { success: s.hidden ? 'Visible again' : 'Hidden from other players' })}>
                {s.hidden ? 'Unhide' : 'Hide from feed'}
              </Button>
              {s.submission_media.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() =>
                    run(
                      `delmedia-${s.id}`,
                      async () => {
                        const { supabase } = await import('@/lib/supabase/client');
                        const paths = s.submission_media.flatMap((m) => [m.object_path, m.thumb_path]).filter((p): p is string => Boolean(p));
                        const { error } = await supabase.storage.from('proof').remove(paths);
                        if (error) throw error;
                        await rpc('moderate_submission', { p_submission_id: s.id, p_hidden: true });
                      },
                      { confirm: { title: 'Delete this media?', body: 'The photo/video is permanently deleted. The score decision is unchanged.', danger: true, confirmLabel: 'Delete' }, success: 'Media deleted' },
                    )
                  }
                >
                  Delete media
                </Button>
              )}
            </div>
            {s.status === 'approved' && manualDefs.length > 0 && (
              <div className="row">
                <div className="grow">
                  <Select label="Award a badge" value={award} onChange={(e) => setAward(e.target.value)}>
                    <option value="">Choose…</option>
                    {manualDefs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  style={{ alignSelf: 'flex-end' }}
                  icon="star"
                  disabled={!award}
                  onClick={() => run(`award-${s.id}`, () => rpc('award_achievement', { p_member_id: s.member_id, p_achievement_id: award, p_note: null, p_submission_id: s.id }), { success: 'Badge awarded' }).then(() => setAward(''))}
                >
                  Award
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <span className="sr-only">
        <Icon name="check" />
      </span>
    </li>
  );
}
